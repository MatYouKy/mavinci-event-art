import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Marketing → „Realizacje” → karta realizacji — 1:1 z CRM (`PortfolioEditor`): podstawy i wydarzenie, zdjęcie główne
// i galeria (z Findera — także HEIC, z plików wydarzenia, Materiałów i biblioteki social media; kolejność przeciąganiem, opisy
// alt), opisy, elementy realizacji, SEO i miasta, lista kontrolna, podgląd w Google i asystent AI. „Zapisz” (⌘S) — kopia
// robocza, „Opublikuj” — strona (przy zmianie także na stronie: wybór wersji), „Utwórz post” — szkic posta social media
// z karuzelą zdjęć realizacji. Dwie kolumny na szerokim ekranie (MacBook Pro 16"), jedna na MacBooku Air 13".

@MainActor struct PortfolioEditorView: View {
    @ObservedObject var store: PortfolioStore
    let id: String
    let cities: [PortfolioCity]
    let categories: [String]
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var picker: PortfolioPhotoSource?
    @State private var eventPickerShown = false
    @State private var confirmOverwrite = false
    @State private var confirmDiscard = false
    @State private var confirmUnpublish = false
    @State private var confirmDelete = false
    @State private var socialShown = false
    @State private var cityQuery = ""
    @State private var dropping = false
    @State private var dropIndex: Int?
    @FocusState private var slugFocused: Bool

    private static let dragPrefix = "mavinci-portfolio-gallery:"

    private var detail: PortfolioDetail? { store.details[id] }

    /// Treść kopii roboczej (zmiany zostają w `PortfolioStore.drafts` do zapisu).
    private var content: Binding<PortfolioContent> {
        Binding(get: { store.drafts[id]?.content ?? PortfolioContent() }, set: { store.drafts[id]?.content = $0 })
    }

    private func limited(_ binding: Binding<String>, _ max: Int) -> Binding<String> {
        Binding(get: { binding.wrappedValue }, set: { binding.wrappedValue = String($0.prefix(max)) })
    }

    var body: some View {
        Group {
            if let detail, let draft = store.drafts[id] {
                editor(detail, draft)
            } else if let error = store.detailErrors[id] {
                ContentUnavailableView {
                    Label("Realizacja", systemImage: "rosette")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadDetail(id) } }
                    Button("Zamknij") { store.openedID = nil }
                }
            } else {
                ProgressView("Ładowanie realizacji...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: id) { await store.loadDetail(id) }
    }

    private func editor(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        VStack(spacing: 10) {
            toolbar(detail, draft)
            if store.stale(id) { staleBanner(detail) }
            if detail.item.status == .conflict { conflictBanner }
            GeometryReader { geometry in
                let wide = geometry.size.width >= 1080
                ScrollView {
                    if wide {
                        HStack(alignment: .top, spacing: 14) {
                            mainColumn(detail, draft).frame(maxWidth: .infinity)
                            aside(detail, draft).frame(width: 340)
                        }
                        .padding(.bottom, 16)
                    } else {
                        VStack(spacing: 14) {
                            mainColumn(detail, draft)
                            aside(detail, draft)
                        }
                        .padding(.bottom, 16)
                    }
                }
            }
        }
        .sheet(item: $picker) { source in
            PortfolioPhotoPickerSheet(store: store, eventID: draft.eventID, eventName: draft.event?.name,
                                      onPick: { chosen, options in Task { await importPhotos(options, source: chosen) } }, source: source)
                .environmentObject(state).environment(\.crmTheme, theme)
        }
        .sheet(isPresented: $socialShown) {
            PortfolioSocialSheet(photos: draft.content.photos) { photos, channels in
                Task { await store.createSocialPost(id, photos: photos, channels: channels) }
            }
            .environmentObject(state).environment(\.crmTheme, theme)
        }
        .sheet(isPresented: $eventPickerShown) {
            PortfolioEventPickerSheet(store: store) { event in
                store.drafts[id]?.eventID = event.id
                store.drafts[id]?.event = event
            }
            .environmentObject(state).environment(\.crmTheme, theme)
        }
        .confirmationDialog("Zastąpić wersję na stronie?", isPresented: $confirmOverwrite, titleVisibility: .visible) {
            Button("Opublikuj moją wersję") { Task { if let current = store.detail(id) { await store.publish(current, overwrite: true) } } }
            Button("Wróć", role: .cancel) {}
        } message: { Text("Tę realizację zmieniono także bezpośrednio na stronie. Publikacja zastąpi tamte zmiany Twoją wersją.") }
        .confirmationDialog("Pobrać wersję ze strony?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Pobierz ze strony") { Task { await store.discard(id) } }
            Button("Wróć", role: .cancel) {}
        } message: { Text("Niezapisane i niepublikowane zmiany w kopii roboczej zostaną zastąpione wersją, która jest teraz na stronie.") }
        .confirmationDialog("Usunąć realizację ze strony?", isPresented: $confirmUnpublish, titleVisibility: .visible) {
            Button("Usuń ze strony", role: .destructive) { Task { if let current = store.detail(id) { await store.unpublish(current) } } }
            Button("Wróć", role: .cancel) {}
        } message: { Text("Strona realizacji przestanie działać (link i pozycja w Google). Kopia robocza zostanie jako szkic — możesz ją opublikować ponownie.") }
        .confirmationDialog("Usunąć realizację?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { Task { if let current = store.detail(id) { await store.delete(current) } } }
            Button("Wróć", role: .cancel) {}
        } message: {
            let message: String = detail.item.status.onSite
                ? "Realizacja zostanie usunięta ze strony i z „Realizacji”. Zdjęcia zostają w źródłach (Materiały, pliki wydarzenia). Tej operacji nie można cofnąć."
                : "Kopia robocza zostanie usunięta. Tej operacji nie można cofnąć."
            Text(message)
        }
    }

    // MARK: Pasek
    private func toolbar(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        let dirty = store.dirty(id)
        let missing = portfolioPublishProblems(draft.content)
        let onSite = detail.item.status.onSite
        let title: String = draft.content.title.isEmpty ? "Realizacja bez tytułu" : draft.content.title
        let saved: String = dirty ? "niezapisane zmiany" : "zapisano" + (detail.item.updatedByName.map { " · \($0)" } ?? "")
        let publishTitle: String = onSite ? "Opublikuj zmiany" : "Opublikuj na stronie"
        let publishHelp: String = missing.isEmpty ? "Publikacja na stronie mavinci.pl" : "Uzupełnij: " + missing.map(\.label).joined(separator: ", ")
        return HStack(spacing: 8) {
            Text(title).font(.title3.weight(.light)).lineLimit(1).truncationMode(.tail)
            PortfolioStatusBadge(status: detail.item.status)
            Text(saved).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 8)
            Button { Task { await save() } } label: { Label("Zapisz", systemImage: "square.and.arrow.down") }
                .buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command).disabled(!dirty)
            Button { Task { await publish() } } label: { Label(publishTitle, systemImage: "paperplane") }
                .buttonStyle(.borderedProminent)
                .disabled(!missing.isEmpty || (!dirty && detail.item.status == .published))
                .help(publishHelp)
            if let link = detail.item.siteUrl, let url = URL(string: link) {
                Button { NSWorkspace.shared.open(url) } label: { Label("Zobacz na stronie", systemImage: "arrow.up.right.square") }.help(link)
            }
            if detail.item.status == .changed || detail.item.status == .conflict {
                Button { confirmDiscard = true } label: { Label("Wersja ze strony", systemImage: "arrow.uturn.backward") }
            }
            Button { socialShown = true } label: { Label("Utwórz post", systemImage: "square.and.pencil") }
                .disabled(draft.content.photos.isEmpty).help("Szkic posta social media z karuzelą zdjęć realizacji")
            Menu {
                if dirty { Button { store.discardDraft(id) } label: { Label("Odrzuć niezapisane zmiany", systemImage: "xmark.circle") } }
                if onSite { Button { confirmUnpublish = true } label: { Label("Usuń ze strony", systemImage: "eye.slash") } }
                Divider()
                Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń realizację", systemImage: "trash") }
            } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                .menuStyle(.borderlessButton).fixedSize()
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func staleBanner(_ detail: PortfolioDetail) -> some View {
        let who: String = detail.item.updatedByName.map { " (\($0))" } ?? ""
        return HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text("Realizację zapisano w innym oknie lub na innym urządzeniu\(who). Twoje zmiany nie są zapisane — odrzuć je albo zachowaj i zapisz swoją wersję.")
                .font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            Button("Odrzuć moje zmiany") { store.discardDraft(id) }
            Button("Zachowaj moje zmiany") { store.keepDraft(id) }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.orange.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.35)))
    }

    private var conflictBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            Text("Tę realizację zmieniono także bezpośrednio na stronie (tryb edycji strony). Wybierz: pobierz wersję ze strony albo opublikuj swoją.")
                .font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            Button("Pobierz ze strony") { confirmDiscard = true }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.red.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.red.opacity(0.35)))
    }

    // MARK: Czynności
    private func normalizeSlug() {
        guard let slug = store.drafts[id]?.content.slug, !isPortfolioSlug(slug) else { return }
        store.drafts[id]?.content.slug = portfolioSlug(slug)
    }

    @discardableResult private func save(quiet: Bool = false) async -> PortfolioDetail? {
        normalizeSlug()
        return await store.save(id, quiet: quiet)
    }

    /// Publikacja: najpierw zapis niezapisanych zmian; przy zmianach także na stronie — pytanie o zastąpienie.
    private func publish() async {
        guard var current = store.detail(id) else { return }
        if store.dirty(id) {
            guard let saved = await save(quiet: true) else { return }
            current = saved
        }
        if current.item.status == .conflict { confirmOverwrite = true; return }
        await store.publish(current, overwrite: false)
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP, .heic, .heif, .tiff]
        panel.prompt = "Dodaj do realizacji"
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        Task { await upload(urls) }
    }

    private func accept(_ providers: [NSItemProvider]) {
        Task {
            var urls: [URL] = []
            for provider in providers {
                if let url = await SocialLibraryView.fileURL(provider) { urls.append(url) }
            }
            guard !urls.isEmpty else { return }
            await upload(urls)
        }
    }

    private func upload(_ urls: [URL]) async {
        let added = await store.upload(urls, itemID: id)
        if !added.isEmpty { store.drafts[id]?.content.add(added) }
    }

    private func importPhotos(_ options: [PortfolioPhotoOption], source: PortfolioPhotoSource) async {
        guard !options.isEmpty else { return }
        let added = await store.importPhotos(options, source: source, itemID: id)
        if !added.isEmpty { store.drafts[id]?.content.add(added) }
    }

    private func moveGallery(from: Int, to: Int) {
        var gallery = content.wrappedValue.gallery
        guard from != to, gallery.indices.contains(from), gallery.indices.contains(to) else { return }
        let moved = gallery.remove(at: from)
        gallery.insert(moved, at: to)
        content.wrappedValue.gallery = gallery
    }

    private func makeMain(_ index: Int) {
        var value = content.wrappedValue
        guard value.gallery.indices.contains(index) else { return }
        let photo = value.gallery.remove(at: index)
        if let image = value.image { value.gallery.insert(image, at: index) }
        value.image = photo
        content.wrappedValue = value
    }

    private func removeGallery(_ index: Int) {
        guard content.wrappedValue.gallery.indices.contains(index) else { return }
        content.wrappedValue.gallery.remove(at: index)
    }

    private func openLink(_ link: String) {
        if let url = URL(string: link) { NSWorkspace.shared.open(url) }
    }

    // MARK: Układ
    private func card<Inner: View>(_ title: String?, @ViewBuilder _ inner: () -> Inner) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { Text(title).font(.headline) }
            inner()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func field<Inner: View>(_ label: String, hint: String? = nil, @ViewBuilder _ inner: () -> Inner) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(label).font(.callout)
                if let hint { Text(hint).font(.caption).foregroundStyle(.secondary) }
            }
            inner()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func textBox(_ text: Binding<String>, height: CGFloat, placeholder: String = "") -> some View {
        TextEditor(text: text)
            .font(.body).frame(height: height).scrollContentBackground(.hidden)
            .padding(6).background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
            .overlay(alignment: .topLeading) {
                if text.wrappedValue.isEmpty && !placeholder.isEmpty {
                    Text(placeholder).foregroundStyle(.tertiary).padding(.horizontal, 11).padding(.vertical, 6).allowsHitTesting(false)
                }
            }
    }

    private func overlayButton(_ symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.caption.weight(.semibold)).foregroundStyle(.white)
                .frame(width: 22, height: 22).background(Circle().fill(Color.black.opacity(0.6)))
        }
        .buttonStyle(.plain).help(help)
    }

    private func mainColumn(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        VStack(spacing: 14) {
            basics(detail, draft)
            photos(draft)
            descriptions(draft)
            features(draft)
            seo(draft)
        }
    }

    // MARK: Podstawy
    private func basics(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        card("Podstawy") {
            field("Tytuł") {
                TextField("Jubileusz 30 lat marki", text: limited(content.title, PortfolioLimits.title)).textFieldStyle(.roundedBorder)
            }
            slugField(detail, draft)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)],
                      alignment: .leading, spacing: 10) {
                field("Kategoria") { categoryField }
                field("Data wydarzenia") { dateField(draft) }
                field("Miejsce (obiekt, miasto)") {
                    TextField("Hotel Omega, Olsztyn", text: limited(content.location, PortfolioLimits.location)).textFieldStyle(.roundedBorder)
                }
                field("Klient", hint: "(opcjonalnie, do opisów)") {
                    TextField("", text: limited(content.client, PortfolioLimits.client)).textFieldStyle(.roundedBorder)
                }
            }
            eventField(draft)
            HStack(spacing: 24) {
                Toggle("Wyróżniona realizacja", isOn: content.isFeatured).toggleStyle(.checkbox)
                HStack(spacing: 6) {
                    Text("Kolejność na stronie")
                    TextField("", value: content.orderIndex, format: .number).textFieldStyle(.roundedBorder).frame(width: 70)
                    Stepper("", value: content.orderIndex, in: -9999...9999).labelsHidden()
                }
                Spacer()
            }
        }
    }

    private func slugField(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        let onSite = detail.item.status.onSite
        let slug = Binding<String>(get: { content.wrappedValue.slug },
                                   set: { content.wrappedValue.slug = String($0.lowercased().prefix(PortfolioLimits.slug)) })
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("Adres strony").font(.callout)
                if onSite { Label("opublikowany adres się nie zmienia", systemImage: "lock").font(.caption).foregroundStyle(.secondary) }
            }
            HStack(spacing: 6) {
                Text("mavinci.pl/portfolio/").font(.caption).foregroundStyle(.secondary)
                TextField("adres-realizacji", text: slug).textFieldStyle(.roundedBorder).disabled(onSite)
                    .focused($slugFocused)
                    .onSubmit { normalizeSlug() }
                    .onChange(of: slugFocused) { _, focused in if !focused { normalizeSlug() } }
                if !onSite {
                    Button { content.wrappedValue.slug = portfolioSlug(content.wrappedValue.title) } label: { Image(systemName: "wand.and.stars") }
                        .help("Adres z tytułu")
                }
            }
            if !draft.content.slug.isEmpty && !isPortfolioSlug(draft.content.slug) {
                Text("Małe litery, cyfry i myślniki — np. gala-firmowa-olsztyn.").font(.caption).foregroundStyle(.orange)
            }
        }
    }

    private var categoryField: some View {
        HStack(spacing: 4) {
            TextField("Gala, Konferencja, Jubileusz…", text: limited(content.category, PortfolioLimits.category)).textFieldStyle(.roundedBorder)
            if !categories.isEmpty {
                Menu {
                    ForEach(categories, id: \.self) { category in Button(category) { content.wrappedValue.category = category } }
                } label: { Image(systemName: "chevron.down") }
                    .menuStyle(.borderlessButton).fixedSize().help("Kategorie innych realizacji")
            }
        }
    }

    private func dateField(_ draft: PortfolioDraft) -> some View {
        let hasDate = Binding<Bool>(
            get: { content.wrappedValue.eventDate != nil },
            set: { on in content.wrappedValue.eventDate = on ? (content.wrappedValue.eventDate ?? PortfolioDates.format(Date())) : nil }
        )
        let date = Binding<Date>(
            get: { PortfolioDates.parse(content.wrappedValue.eventDate) ?? Date() },
            set: { content.wrappedValue.eventDate = PortfolioDates.format($0) }
        )
        return HStack(spacing: 8) {
            Toggle("", isOn: hasDate).labelsHidden().toggleStyle(.checkbox)
            if draft.content.eventDate != nil {
                DatePicker("", selection: date, displayedComponents: .date).labelsHidden().environment(\.locale, Locale(identifier: "pl_PL"))
            } else {
                Text("bez daty").foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private func eventField(_ draft: PortfolioDraft) -> some View {
        field("Wydarzenie w CRM") {
            HStack(spacing: 6) {
                Button { eventPickerShown = true } label: {
                    Label(draft.event?.name ?? "Powiąż z wydarzeniem", systemImage: "calendar").lineLimit(1)
                }
                if draft.eventID != nil {
                    Button {
                        store.drafts[id]?.eventID = nil
                        store.drafts[id]?.event = nil
                    } label: { Image(systemName: "xmark") }
                        .help("Bez wydarzenia")
                }
                if let event = draft.event { Text(event.summary).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Spacer()
            }
        }
    }

    // MARK: Zdjęcia
    private func photos(_ draft: PortfolioDraft) -> some View {
        card(nil) {
            HStack(spacing: 8) {
                Text("Zdjęcia").font(.headline)
                Text("(\(draft.content.photos.count))").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button { chooseFiles() } label: { Label("Z dysku", systemImage: "square.and.arrow.up") }
                ForEach(PortfolioPhotoSource.allCases) { source in
                    Button { picker = source } label: { Label(source.button, systemImage: source.symbol) }
                }
            }
            Text("Przeciągnij zdjęcia z Findera na tę sekcję (JPEG, PNG, WebP, HEIC). Wersje strony (WebP: komputer, telefon, miniatura) powstaną na serwerze.")
                .font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .top, spacing: 14) {
                hero(draft).frame(width: 250)
                gallery(draft)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(dropping ? theme.accent : Color.clear, lineWidth: 2))
        .onDrop(of: [UTType.fileURL], isTargeted: $dropping) { providers in
            accept(providers)
            return true
        }
    }

    private func hero(_ draft: PortfolioDraft) -> some View {
        let alt = Binding<String>(
            get: { content.wrappedValue.image?.alt ?? "" },
            set: { content.wrappedValue.image?.alt = String($0.prefix(PortfolioLimits.alt)) }
        )
        return VStack(alignment: .leading, spacing: 6) {
            Text("Zdjęcie główne").font(.caption).foregroundStyle(.secondary)
            if let image = draft.content.image {
                Color.clear.aspectRatio(4.0 / 3.0, contentMode: .fit)
                    .overlay { SocialImageView(url: image.thumb) }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(alignment: .topTrailing) {
                        overlayButton("xmark", help: "Usuń zdjęcie główne") { content.wrappedValue.image = nil }.padding(5)
                    }
                    .contextMenu { Button("Otwórz zdjęcie") { openLink(image.src) } }
                TextField("Opis zdjęcia (alt)", text: alt).textFieldStyle(.roundedBorder)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(image.alt.isEmpty ? Color.orange.opacity(0.5) : Color.clear))
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(theme.accent.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [4]))
                    .aspectRatio(4.0 / 3.0, contentMode: .fit)
                    .overlay(Image(systemName: "photo").font(.largeTitle).foregroundStyle(theme.accent.opacity(0.4)))
            }
        }
    }

    private func gallery(_ draft: PortfolioDraft) -> some View {
        let items = Array(draft.content.gallery.enumerated())
        return VStack(alignment: .leading, spacing: 6) {
            Text("Galeria — przeciągnij, żeby zmienić kolejność").font(.caption).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                ForEach(items, id: \.offset) { item in galleryTile(item.element, index: item.offset, count: items.count) }
            }
            if items.isEmpty {
                Text("Dodaj 5–12 zdjęć: szerokie ujęcie sali, scena, detale, goście (bez portretów).").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func galleryAlt(_ index: Int) -> Binding<String> {
        Binding(
            get: { content.wrappedValue.gallery.indices.contains(index) ? content.wrappedValue.gallery[index].alt : "" },
            set: { value in
                guard content.wrappedValue.gallery.indices.contains(index) else { return }
                content.wrappedValue.gallery[index].alt = String(value.prefix(PortfolioLimits.alt))
            }
        )
    }

    private func galleryTile(_ photo: PortfolioPhoto, index: Int, count: Int) -> some View {
        let targeted = dropIndex == index
        return VStack(spacing: 4) {
            Color.clear.aspectRatio(4.0 / 3.0, contentMode: .fit)
                .overlay { SocialImageView(url: photo.thumb) }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(alignment: .topLeading) {
                    Image(systemName: "line.3.horizontal").font(.caption2.weight(.bold)).foregroundStyle(.white)
                        .frame(width: 20, height: 20).background(Circle().fill(Color.black.opacity(0.5))).padding(4)
                }
                .overlay(alignment: .topTrailing) {
                    HStack(spacing: 4) {
                        overlayButton("star", help: "Ustaw jako główne") { makeMain(index) }
                        overlayButton("xmark", help: "Usuń z galerii") { removeGallery(index) }
                    }
                    .padding(4)
                }
                .draggable(Self.dragPrefix + String(index)) {
                    SocialImageView(url: photo.thumb).frame(width: 120, height: 90).clipShape(RoundedRectangle(cornerRadius: 6))
                }
            TextField("Opis (alt)", text: galleryAlt(index)).textFieldStyle(.roundedBorder).font(.caption)
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(photo.alt.isEmpty ? Color.orange.opacity(0.5) : Color.clear))
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(targeted ? 0.14 : 0.04)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(targeted ? theme.accent : Color.clear, lineWidth: 1.5))
        .dropDestination(for: String.self) { items, _ in
            guard let item = items.first, item.hasPrefix(Self.dragPrefix), let from = Int(item.dropFirst(Self.dragPrefix.count)) else { return false }
            moveGallery(from: from, to: index)
            return true
        } isTargeted: { inside in
            if inside { dropIndex = index } else if dropIndex == index { dropIndex = nil }
        }
        .contextMenu {
            Button("Ustaw jako główne") { makeMain(index) }
            Button("Przesuń wcześniej") { moveGallery(from: index, to: index - 1) }.disabled(index == 0)
            Button("Przesuń dalej") { moveGallery(from: index, to: index + 1) }.disabled(index >= count - 1)
            Button("Otwórz zdjęcie") { openLink(photo.src) }
            Divider()
            Button("Usuń z galerii", role: .destructive) { removeGallery(index) }
        }
    }

    // MARK: Opisy
    private func descriptions(_ draft: PortfolioDraft) -> some View {
        card("Opisy") {
            field("Krótki opis", hint: "(\(draft.content.description.count)/\(PortfolioLimits.description) — karta realizacji)") {
                textBox(limited(content[dynamicMember: \.description], PortfolioLimits.description), height: 70)
            }
            field("Szczegółowy opis", hint: "(\(draft.content.detailedDescription.count) znaków, zalecane od \(PortfolioLimits.detailedRecommended); akapity oddziel pustą linią)") {
                textBox(limited(content.detailedDescription, PortfolioLimits.detailedDescription), height: 220)
            }
        }
    }

    // MARK: Elementy realizacji
    private func feature(_ index: Int) -> Binding<PortfolioFeature> {
        Binding(
            get: { content.wrappedValue.features.indices.contains(index) ? content.wrappedValue.features[index] : PortfolioFeature() },
            set: { value in
                guard content.wrappedValue.features.indices.contains(index) else { return }
                content.wrappedValue.features[index] = value
            }
        )
    }

    private func moveFeature(from: Int, to: Int) {
        var features = content.wrappedValue.features
        guard features.indices.contains(from), features.indices.contains(to) else { return }
        features.swapAt(from, to)
        content.wrappedValue.features = features
    }

    private func features(_ draft: PortfolioDraft) -> some View {
        let count = draft.content.features.count
        return card(nil) {
            HStack {
                Text("Elementy realizacji").font(.headline)
                Text("(\(count)/\(PortfolioLimits.features))").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button { content.wrappedValue.features.append(PortfolioFeature()) } label: { Label("Dodaj element", systemImage: "plus") }
                    .disabled(count >= PortfolioLimits.features)
            }
            ForEach(Array(draft.content.features.indices), id: \.self) { index in featureRow(index, count: count) }
            if count == 0 {
                Text("Np. scena z ekranem LED, oświetlenie architektoniczne, prowadzący — 3–6 elementów z ikonami na stronie realizacji.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func featureRow(_ index: Int, count: Int) -> some View {
        let binding = feature(index)
        let icon = PortfolioIcon.named(binding.wrappedValue.icon)
        return HStack(spacing: 8) {
            Menu {
                ForEach(PortfolioIcon.all) { option in
                    Button { binding.wrappedValue.icon = option.name } label: { Label("\(option.category) — \(option.label)", systemImage: option.symbol) }
                }
            } label: { Label(icon.label, systemImage: icon.symbol) }
                .frame(width: 160)
            TextField("Np. Scena z ekranem LED", text: limited(binding.title, PortfolioLimits.featureTitle)).textFieldStyle(.roundedBorder)
            TextField("Krótki opis (opcjonalnie)", text: limited(binding[dynamicMember: \.description], PortfolioLimits.featureDescription)).textFieldStyle(.roundedBorder)
                .frame(minWidth: 160)
            Button { moveFeature(from: index, to: index - 1) } label: { Image(systemName: "arrow.up") }.disabled(index == 0).help("W górę")
            Button { moveFeature(from: index, to: index + 1) } label: { Image(systemName: "arrow.down") }.disabled(index >= count - 1).help("W dół")
            Button {
                guard content.wrappedValue.features.indices.contains(index) else { return }
                content.wrappedValue.features.remove(at: index)
            } label: { Image(systemName: "trash") }.help("Usuń element")
        }
    }

    // MARK: SEO i miasta
    private func seo(_ draft: PortfolioDraft) -> some View {
        let meta = draft.content.metaDescription.count
        let metaOK = meta >= PortfolioLimits.metaMin && meta <= PortfolioLimits.metaMax
        return card("SEO i miasta") {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("Opis w Google").font(.callout)
                    Text("\(meta) znaków (zalecane \(PortfolioLimits.metaMin)–\(PortfolioLimits.metaMax))").font(.caption).foregroundStyle(metaOK ? Color.green : Color.orange)
                }
                textBox(limited(content.metaDescription, PortfolioLimits.metaDescription), height: 54)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)],
                      alignment: .leading, spacing: 10) {
                field("Słowa kluczowe", hint: "(Enter albo przecinek)") {
                    PortfolioChipsField(values: content.keywords, placeholder: "gala firmowa olsztyn", max: PortfolioLimits.keywords, maxLength: PortfolioLimits.keyword)
                }
                field("Tagi", hint: "(np. „konferencje” — strony konferencji)") {
                    PortfolioChipsField(values: content.tags, placeholder: "konferencje", max: PortfolioLimits.tags, maxLength: PortfolioLimits.tag)
                }
                field("Miasto realizacji") { cityPicker(draft) }
                field("Na stronach konferencji") { conferencePicker }
            }
            referenceCities(draft)
            field("Film", hint: "(adres https, opcjonalnie)") {
                TextField("https://www.youtube.com/watch?v=…", text: Binding(
                    get: { content.wrappedValue.videoUrl },
                    set: { content.wrappedValue.videoUrl = String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(PortfolioLimits.videoUrl)) }
                ))
                .textFieldStyle(.roundedBorder)
            }
        }
    }

    private func cityPicker(_ draft: PortfolioDraft) -> some View {
        let selection = Binding<String>(
            get: { content.wrappedValue.eventCitySlug ?? "" },
            set: { content.wrappedValue.eventCitySlug = $0.isEmpty ? nil : $0 }
        )
        let unknown = draft.content.eventCitySlug.flatMap { slug in cities.contains { $0.locality == slug } ? nil : slug }
        return Picker("", selection: selection) {
            Text("Nie przypisano / inne miejsce").tag("")
            if let unknown { Text("Dotychczas przypisane miasto").tag(unknown) }
            ForEach(cities) { city in Text(city.name).tag(city.locality) }
        }
        .labelsHidden()
    }

    private var conferencePicker: some View {
        let selection = Binding<String>(
            get: {
                switch content.wrappedValue.conferenceReferenceEnabled {
                case .none: return "inherit"
                case .some(true): return "include"
                case .some(false): return "exclude"
                }
            },
            set: { value in content.wrappedValue.conferenceReferenceEnabled = value == "inherit" ? nil : value == "include" }
        )
        return Picker("", selection: selection) {
            Text("Automatycznie — według tagu „konferencje”").tag("inherit")
            Text("Pokazuj jako przykład obsługi konferencji").tag("include")
            Text("Nie pokazuj na stronach konferencji").tag("exclude")
        }
        .labelsHidden()
    }

    private func referenceCities(_ draft: PortfolioDraft) -> some View {
        let locale = Locale(identifier: "pl_PL")
        let needle = cityQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: locale)
        let filtered = needle.isEmpty ? cities : cities.filter { $0.name.lowercased(with: locale).contains(needle) }
        return field("Priorytetowe miasta", hint: "(na których stronach usług pokazać realizację wyżej; nie zmieniają miejsca wydarzenia)") {
            TextField("Szukaj miasta…", text: $cityQuery).textFieldStyle(.roundedBorder).frame(maxWidth: 280)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 4) {
                    ForEach(filtered) { city in
                        Toggle(city.name, isOn: Binding(
                            get: { content.wrappedValue.referenceCitySlugs.contains(city.locality) },
                            set: { on in
                                var slugs = content.wrappedValue.referenceCitySlugs.filter { $0 != city.locality }
                                if on { slugs.append(city.locality) }
                                content.wrappedValue.referenceCitySlugs = slugs
                            }
                        ))
                        .toggleStyle(.checkbox)
                    }
                }
            }
            .frame(maxHeight: 170)
        }
    }

    // MARK: Panel boczny
    private func aside(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        VStack(spacing: 14) {
            checklist(draft)
            googlePreview(draft)
            card(nil) { PortfolioAssistantPanel(store: store, id: id) }
            card(nil) {
                Text("Utworzono \(PortfolioDates.moment(detail.item.createdAt))" + (detail.item.createdByName.map { " · \($0)" } ?? ""))
                    .font(.caption).foregroundStyle(.secondary)
                if let published = detail.item.publishedAt {
                    Text("Opublikowano \(PortfolioDates.moment(published))" + (detail.item.publishedByName.map { " · \($0)" } ?? ""))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func checklist(_ draft: PortfolioDraft) -> some View {
        card("Lista kontrolna") {
            ForEach(portfolioChecklist(draft.content)) { check in checkRow(check) }
        }
    }

    private func checkRow(_ check: PortfolioCheck) -> some View {
        let symbol: String = check.ok ? "checkmark.circle.fill" : check.required ? "exclamationmark.triangle.fill" : "circle.dashed"
        let color: Color = check.ok ? .green : check.required ? .red : .orange
        let label: String = check.label + (check.required && !check.ok ? " (wymagane)" : "")
        return HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol).foregroundStyle(color).font(.callout)
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.caption).foregroundStyle(check.ok ? Color.primary : color)
                if !check.ok { Text(check.hint).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            }
        }
    }

    private func googlePreview(_ draft: PortfolioDraft) -> some View {
        let preview = portfolioSearchPreview(draft.content)
        return card("Podgląd w Google") {
            VStack(alignment: .leading, spacing: 3) {
                Text(preview.url).font(.caption).foregroundStyle(Color(red: 0.13, green: 0.13, blue: 0.14)).lineLimit(1)
                Text(preview.title).font(.title3).foregroundStyle(Color(red: 0.10, green: 0.05, blue: 0.67)).lineLimit(1)
                Text(preview.description.isEmpty ? "Dodaj opis w Google albo krótki opis." : preview.description)
                    .font(.caption).foregroundStyle(Color(red: 0.30, green: 0.32, blue: 0.34)).lineLimit(2)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
        }
    }
}

/// Słowa kluczowe i tagi: frazy jako etykiety, dodawanie Enterem, przecinkiem albo po wyjściu z pola.
@MainActor struct PortfolioChipsField: View {
    @Binding var values: [String]
    let placeholder: String
    let max: Int
    let maxLength: Int
    @Environment(\.crmTheme) private var theme
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !values.isEmpty {
                WrapLayout(spacing: 4) {
                    ForEach(values, id: \.self) { value in chip(value) }
                }
            }
            if values.count < max {
                TextField(placeholder, text: $text).textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onSubmit { add() }
                    .onChange(of: text) { _, value in if value.contains(",") { add() } }
                    .onChange(of: focused) { _, now in if !now { add() } }
            }
        }
    }

    private func chip(_ value: String) -> some View {
        HStack(spacing: 3) {
            Text(value).font(.caption)
            Button { values.removeAll { $0 == value } } label: { Image(systemName: "xmark").font(.caption2) }
                .buttonStyle(.plain).help("Usuń „\(value)”")
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(Capsule().fill(theme.accent.opacity(0.12)))
        .overlay(Capsule().stroke(theme.accent.opacity(0.3), lineWidth: 1))
        .foregroundStyle(theme.accent)
    }

    private func add() {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: "").isEmpty else { text = ""; return }
        values = portfolioAddPhrases(text, to: values, max: max, maxLength: maxLength)
        text = ""
    }
}

/// Asystent AI realizacji (jak w CRM i w telefonie): z krótkiego opisu i danych realizacji przygotowuje tytuł, opisy, opis
/// w Google, słowa kluczowe, elementy realizacji i opisy zdjęć. Propozycje nie zmieniają realizacji, dopóki ich nie użyjesz.
@MainActor struct PortfolioAssistantPanel: View {
    @ObservedObject var store: PortfolioStore
    let id: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var brief = ""
    @State private var fields: Set<PortfolioAiField> = [.description, .detailedDescription, .metaDescription, .keywords]
    @State private var usePhotos = false
    @State private var result: PortfolioAiResult?

    private var photoCount: Int { store.drafts[id]?.content.photos.count ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Asystent AI", systemImage: "sparkles").font(.headline)
            TextEditor(text: Binding(get: { brief }, set: { brief = String($0.prefix(1500)) }))
                .font(.body).frame(height: 80).scrollContentBackground(.hidden)
                .padding(6).background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                .overlay(alignment: .topLeading) {
                    if brief.isEmpty {
                        Text("Kilka zdań o realizacji: dla kogo, co przygotowaliśmy (scena, technika, program), co było wyjątkowe.")
                            .font(.callout).foregroundStyle(.tertiary).padding(.horizontal, 11).padding(.vertical, 6).allowsHitTesting(false)
                    }
                }
            WrapLayout(spacing: 4) {
                ForEach(PortfolioAiField.allCases) { field in fieldChip(field) }
            }
            Toggle("Uwzględnij zdjęcia (opis tego, co na nich widać; przy opisach zdjęć — zawsze)", isOn: $usePhotos)
                .toggleStyle(.checkbox).font(.caption).disabled(photoCount == 0)
            Button { Task { await ask() } } label: { Label("Przygotuj teksty", systemImage: "sparkles") }.disabled(fields.isEmpty)
            if let result { proposals(result) }
            Text("Do AI trafia treść realizacji, rodzaj, miejsce i data wydarzenia oraz — gdy zaznaczysz — zdjęcia ze strony. Bez danych osobowych.")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func fieldChip(_ field: PortfolioAiField) -> some View {
        let active = fields.contains(field)
        return Button {
            if active { fields.remove(field) } else { fields.insert(field) }
        } label: {
            HStack(spacing: 3) {
                if active { Image(systemName: "checkmark").font(.caption2) }
                Text(field.label).font(.caption)
            }
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(active ? theme.accent.opacity(0.2) : Color.clear))
            .overlay(Capsule().stroke(theme.accent.opacity(active ? 0.7 : 0.2), lineWidth: 1))
            .foregroundStyle(active ? theme.accent : Color.secondary)
        }
        .buttonStyle(.plain)
    }

    private func proposals(_ result: PortfolioAiResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            HStack {
                Text("Propozycje" + (result.usedPhotos ? " (ze zdjęciami)" : "")).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Użyj wszystkich") { useAll(result) }.buttonStyle(.link)
            }
            ForEach(PortfolioAiField.allCases.filter { !result.preview($0).isEmpty }) { field in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(field.label).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                        Spacer()
                        Button("Użyj") { use(field, result) }.buttonStyle(.link)
                    }
                    ScrollView {
                        Text(result.preview(field)).font(.caption).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 140)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
            }
        }
    }

    private func ask() async {
        let ordered = PortfolioAiField.allCases.filter { fields.contains($0) }
        if let value = await store.assist(id, brief: brief, fields: ordered, usePhotos: usePhotos && photoCount > 0) { result = value }
    }

    private func use(_ field: PortfolioAiField, _ result: PortfolioAiResult) {
        guard var content = store.drafts[id]?.content else { return }
        if result.apply(field, to: &content) {
            store.drafts[id]?.content = content
            state.succeed("Wstawiono propozycję — zapisz realizację")
        }
    }

    private func useAll(_ result: PortfolioAiResult) {
        guard var content = store.drafts[id]?.content else { return }
        for field in PortfolioAiField.allCases { result.apply(field, to: &content) }
        store.drafts[id]?.content = content
        state.succeed("Wstawiono wszystkie propozycje — zapisz realizację")
    }
}

/// „Utwórz post” z realizacji: zdjęcia (pierwsze — okładka z tytułem, kolejne — karuzela, najwyżej 10) i kanały.
@MainActor struct PortfolioSocialSheet: View {
    let photos: [PortfolioPhoto]
    let onCreate: ([String], [SocialChannel]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var selected: [String] = []
    @State private var channels: Set<SocialChannel> = [.instagramFeed, .facebookFeed]

    private var limit: Int { socialSlidesLimit + 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Utwórz post social media").font(.title3.weight(.semibold))
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Zaznaczone zdjęcia trafią do biblioteki social media marki, a post (szkic) dostanie okładkę z tytułem realizacji i napisem „Realizacja”, kolejne zdjęcia jako karuzelę (Instagram do \(limit), Facebook — post z kilkoma zdjęciami), opis z krótkiego opisu i hashtagi ze słów kluczowych. Dalej edytujesz go w Social media.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Text("Zdjęcia (\(selected.count)/\(limit)) — pierwsze zaznaczone to okładka").font(.callout)
                Spacer()
                Button(selected.isEmpty ? "Zaznacz pierwsze \(limit)" : "Odznacz wszystkie") {
                    selected = selected.isEmpty ? Array(photos.prefix(limit).map(\.src)) : []
                }
                .buttonStyle(.link)
            }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
                    ForEach(Array(photos.enumerated()), id: \.offset) { item in tile(item.element) }
                }
            }
            .frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 4) {
                Text("Kanały").font(.callout)
                ForEach(SocialChannel.allCases) { channel in
                    Toggle(channel.label + (channel == .instagramStory ? " (tylko okładka)" : ""), isOn: Binding(
                        get: { channels.contains(channel) },
                        set: { on in if on { channels.insert(channel) } else { channels.remove(channel) } }
                    ))
                    .toggleStyle(.checkbox)
                }
            }
            HStack {
                Spacer()
                Button("Utwórz szkic posta") {
                    let chosen = selected
                    let list = SocialChannel.allCases.filter { channels.contains($0) }
                    dismiss()
                    onCreate(chosen, list)
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(selected.isEmpty || channels.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 760, height: 620)
        .onAppear { if selected.isEmpty { selected = Array(photos.prefix(limit).map(\.src)) } }
    }

    private func tile(_ photo: PortfolioPhoto) -> some View {
        let position = selected.firstIndex(of: photo.src)
        return Button {
            if let position { selected.remove(at: position) } else if selected.count < limit {
                // Kolejność jak w realizacji.
                let order = photos.map(\.src)
                selected = order.filter { $0 == photo.src || selected.contains($0) }
            }
        } label: {
            Color.clear.aspectRatio(1, contentMode: .fit)
                .overlay { SocialImageView(url: photo.thumb) }
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(position != nil ? theme.accent : Color.clear, lineWidth: 3))
                .overlay(alignment: .topTrailing) {
                    if let position {
                        Text(position == 0 ? "okładka" : "\(position + 1)").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Capsule().fill(theme.accent)).foregroundStyle(.black).padding(4)
                    }
                }
                .opacity(position == nil ? 0.6 : 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(photo.alt)
    }
}
