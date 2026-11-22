import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Marketing → „Realizacje” → karta realizacji — 1:1 z CRM (`PortfolioEditor`): podstawy i wydarzenie, zdjęcie główne
// i galeria (przeciągnięcie z Findera, Zdjęć, Safari, Poczty — także HEIC; z plików wydarzenia, Materiałów i biblioteki social
// media; kolejność przeciąganiem, opisy alt), opisy, elementy realizacji, SEO i miasta, lista kontrolna (kliknięcie — przejście
// do pola z podświetleniem), podgląd w Google i asystent AI — przy sekcjach (tytuł, opisy, elementy, SEO, opisy zdjęć) i w panelu.
// „Zapisz” (⌘S) — kopia robocza, „Opublikuj” — strona (przy zmianie także na stronie: wybór wersji), „Utwórz post” — szkic posta
// social media z karuzelą zdjęć realizacji. Dwie kolumny na szerokim ekranie (MacBook Pro 16"), jedna na MacBooku Air 13".

/// Pole z fokusem po przejściu z listy kontrolnej.
private enum PortfolioFocus: Hashable {
    case title, description, detailed, meta, heroAlt, alt(Int)
}

/// Gdzie trafiają upuszczone zdjęcia: na koniec, jako zdjęcie główne albo w miejsce kafelka galerii.
private enum PortfolioDropPlace {
    case append, main, at(Int)
}

/// Podświetlenie pola, do którego przeszedł pracownik z listy kontrolnej.
private struct PortfolioMark: ViewModifier {
    let active: Bool
    let color: Color
    func body(content: Content) -> some View {
        content
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(color, lineWidth: active ? 2 : 0).padding(-5).allowsHitTesting(false))
            .animation(.easeInOut(duration: 0.25), value: active)
    }
}

private extension View {
    func portfolioMark(_ active: Bool, _ color: Color) -> some View { modifier(PortfolioMark(active: active, color: color)) }
}

/// Zdjęcia przeciągnięte z innych aplikacji (Finder, Zdjęcia, Safari, Poczta, zrzuty ekranu) → pliki do wysłania na serwer.
enum PortfolioDrop {
    /// Typy przyjmowane przez sekcję zdjęć (przeciąganie kolejności w galerii to tekst — obsługiwany osobno).
    static let types: [UTType] = [.fileURL, .image, .url]

    /// Przeciągane są zdjęcia z zewnątrz (nie kafelek galerii).
    static func external(_ providers: [NSItemProvider]) -> Bool {
        providers.contains { provider in
            [UTType.fileURL, .image, .url].contains { provider.hasItemConformingToTypeIdentifier($0.identifier) }
        }
    }

    static func folder() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mavinci-portfolio-drop", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func files(_ providers: [NSItemProvider]) async -> [URL] {
        var urls: [URL] = []
        for provider in providers { if let url = await file(provider) { urls.append(url) } }
        return urls
    }

    /// Plik z Findera; obraz bez pliku (Zdjęcia, Safari, zrzut ekranu) — kopia w katalogu tymczasowym; adres obrazu — pobranie.
    static func file(_ provider: NSItemProvider) async -> URL? {
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier), let url = await loadURL(provider), url.isFileURL { return url }
        if let type = provider.registeredTypeIdentifiers.compactMap({ UTType($0) }).first(where: { $0.conforms(to: .image) }),
           let url = await copy(provider, type: type) {
            return url
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier), let url = await loadURL(provider),
           ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            return await download(url)
        }
        return nil
    }

    static func loadURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
        }
    }

    static func copy(_ provider: NSItemProvider, type: UTType) async -> URL? {
        let fileCopy: URL? = await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url else { continuation.resume(returning: nil); return }
                let ext = url.pathExtension.isEmpty ? (type.preferredFilenameExtension ?? "jpg") : url.pathExtension
                let target = folder().appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
                continuation.resume(returning: (try? FileManager.default.copyItem(at: url, to: target)) != nil ? target : nil)
            }
        }
        if let fileCopy { return fileCopy }
        return await withCheckedContinuation { continuation in
            _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
                guard let data, !data.isEmpty else { continuation.resume(returning: nil); return }
                let target = folder().appendingPathComponent(UUID().uuidString).appendingPathExtension(type.preferredFilenameExtension ?? "jpg")
                continuation.resume(returning: (try? data.write(to: target)) != nil ? target : nil)
            }
        }
    }

    static func download(_ url: URL) async -> URL? {
        guard let result = try? await URLSession.shared.download(from: url), let mime = result.1.mimeType, mime.hasPrefix("image/") else { return nil }
        let ext = UTType(mimeType: mime)?.preferredFilenameExtension ?? (url.pathExtension.isEmpty ? "jpg" : url.pathExtension)
        let target = folder().appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        return (try? FileManager.default.moveItem(at: result.0, to: target)) != nil ? target : nil
    }

    /// Usuwa kopie tymczasowe po wysłaniu (pliki z Findera zostają).
    static func cleanup(_ urls: [URL]) {
        let root = folder().standardizedFileURL.path
        for url in urls where url.standardizedFileURL.path.hasPrefix(root) { try? FileManager.default.removeItem(at: url) }
    }
}

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
    @State private var heroDropping = false
    @State private var dropIndex: Int?
    /// Lista kontrolna → pole: podświetlenie i fokus.
    @State private var highlight: String?
    @State private var highlightTask: Task<Void, Never>?
    @FocusState private var focus: PortfolioFocus?
    /// Propozycje asystenta AI pod sekcjami.
    @State private var ai: [PortfolioAiSection: PortfolioAiResult] = [:]
    /// Element realizacji, nad którym jest przeciągany inny element (miejsce upuszczenia).
    @State private var featureDropIndex: Int?
    @FocusState private var slugFocused: Bool

    private static let dragPrefix = "mavinci-portfolio-gallery:"
    private static let featurePrefix = "mavinci-portfolio-feature:"

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
        .task(id: id) { ai = [:]; await store.loadDetail(id) }
        .onDisappear { highlightTask?.cancel() }
    }

    private func editor(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        VStack(spacing: 10) {
            toolbar(detail, draft)
            if store.stale(id) { staleBanner(detail) }
            if detail.item.status == .conflict { conflictBanner }
            GeometryReader { geometry in
                let wide = geometry.size.width >= 1080
                ScrollViewReader { proxy in
                    ScrollView {
                        if wide {
                            HStack(alignment: .top, spacing: 14) {
                                mainColumn(detail, draft).frame(maxWidth: .infinity)
                                aside(detail, draft) { key in jump(key, proxy) }.frame(width: 340)
                            }
                            .padding(.bottom, 16)
                        } else {
                            VStack(spacing: 14) {
                                mainColumn(detail, draft)
                                aside(detail, draft) { key in jump(key, proxy) }
                            }
                            .padding(.bottom, 16)
                        }
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
                ? "Realizacja zostanie usunięta ze strony i z „Realizacji”. Zdjęcia zostają w źródłach (Materiały, pliki eventu). Tej operacji nie można cofnąć."
                : "Kopia robocza zostanie usunięta. Tej operacji nie można cofnąć."
            Text(message)
        }
    }

    // MARK: Pasek
    private func toolbar(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        let dirty = store.dirty(id)
        let missing = portfolioPublishProblems(draft.content)
        let title: String = draft.content.title.isEmpty ? "Realizacja bez tytułu" : draft.content.title
        let saved: String = dirty ? "niezapisane zmiany" : "zapisano" + (detail.item.updatedByName.map { " · \($0)" } ?? "")
        let publishTitle: String = detail.item.status.onSite ? "Opublikuj zmiany" : "Opublikuj na stronie"
        let publishHelp: String = missing.isEmpty ? "Publikacja na stronie mavinci.pl" : "Uzupełnij: " + missing.map(\.label).joined(separator: ", ")
        let heading = Text(title).font(.title3.weight(.light)).lineLimit(1).truncationMode(.tail)
            .frame(minWidth: 120, idealWidth: 220, maxWidth: .infinity, alignment: .leading)
            .help(title)
        let status = PortfolioStatusBadge(status: detail.item.status).fixedSize()
        // Pasek dopasowany do szerokości okna (`AdaptiveToolbar.swift`): pełne etykiety → ikony → tytuł w osobnym wierszu.
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                heading
                status
                Text(saved).font(.caption).foregroundStyle(.secondary).lineLimit(1).fixedSize()
                toolbarActions(detail, draft, dirty: dirty, missing: !missing.isEmpty, publishTitle: publishTitle, publishHelp: publishHelp, compact: false)
            }
            HStack(spacing: 8) {
                heading
                status
                AdaptiveSavedBadge(dirty: dirty, text: saved)
                toolbarActions(detail, draft, dirty: dirty, missing: !missing.isEmpty, publishTitle: publishTitle, publishHelp: publishHelp, compact: true)
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    heading
                    status
                    AdaptiveSavedBadge(dirty: dirty, text: saved)
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    toolbarActions(detail, draft, dirty: dirty, missing: !missing.isEmpty, publishTitle: publishTitle, publishHelp: publishHelp, compact: true)
                }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
        .background { AdaptiveSaveShortcut(enabled: dirty) { Task { await save() } } }
    }

    /// Zapis, publikacja, strona, wersja ze strony, post i „Więcej”; `compact` — poza zapisem i publikacją same ikony (opis w podpowiedzi).
    @ViewBuilder private func toolbarActions(_ detail: PortfolioDetail, _ draft: PortfolioDraft, dirty: Bool, missing: Bool, publishTitle: String,
                                             publishHelp: String, compact: Bool) -> some View {
        let onSite = detail.item.status.onSite
        Button { Task { await save() } } label: { Label("Zapisz", systemImage: "square.and.arrow.down") }
            .labelStyle(AdaptiveLabelStyle(compact: false))
            .buttonStyle(.borderedProminent).disabled(!dirty)
            .help("Zapisz realizację (⌘S)")
        Button { Task { await publish() } } label: { Label(publishTitle, systemImage: "paperplane") }
            .labelStyle(AdaptiveLabelStyle(compact: false))
            .buttonStyle(.borderedProminent)
            .disabled(missing || (!dirty && detail.item.status == .published))
            .help(publishHelp)
        if let link = detail.item.siteUrl, let url = URL(string: link) {
            Button { NSWorkspace.shared.open(url) } label: { Label("Zobacz na stronie", systemImage: "arrow.up.right.square") }
                .labelStyle(AdaptiveLabelStyle(compact: compact))
                .help(compact ? "Zobacz na stronie — \(link)" : link)
        }
        if detail.item.status == .changed || detail.item.status == .conflict {
            Button { confirmDiscard = true } label: { Label("Wersja ze strony", systemImage: "arrow.uturn.backward") }
                .labelStyle(AdaptiveLabelStyle(compact: compact))
                .help("Wersja ze strony")
        }
        Button { socialShown = true } label: { Label("Utwórz post", systemImage: "square.and.pencil") }
            .labelStyle(AdaptiveLabelStyle(compact: compact))
            .disabled(draft.content.photos.isEmpty)
            .help(compact ? "Utwórz post — szkic posta social media z karuzelą zdjęć realizacji" : "Szkic posta social media z karuzelą zdjęć realizacji")
        Menu {
            if dirty { Button { store.discardDraft(id) } label: { Label("Odrzuć niezapisane zmiany", systemImage: "xmark.circle") } }
            if onSite { Button { confirmUnpublish = true } label: { Label("Usuń ze strony", systemImage: "eye.slash") } }
            Divider()
            Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń realizację", systemImage: "trash") }
        } label: { Label("Więcej", systemImage: "ellipsis.circle").labelStyle(AdaptiveLabelStyle(compact: compact)) }
            .menuStyle(.borderlessButton).fixedSize()
            .help("Więcej")
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

    /// Zdjęcia upuszczone z innych aplikacji: na sekcję (na koniec), na zdjęcie główne albo na kafelek galerii (w to miejsce).
    private func accept(_ providers: [NSItemProvider], place: PortfolioDropPlace = .append) {
        Task {
            let urls = await PortfolioDrop.files(providers)
            guard !urls.isEmpty else {
                state.error = "Nie udało się odczytać przeciągniętego zdjęcia. Przeciągnij plik JPEG, PNG, WebP albo HEIC."
                return
            }
            let added = await store.upload(urls, itemID: id)
            PortfolioDrop.cleanup(urls)
            guard !added.isEmpty else { return }
            switch place {
            case .append: store.drafts[id]?.content.add(added)
            case .main: store.drafts[id]?.content.addAsMain(added)
            case .at(let index): store.drafts[id]?.content.insert(added, at: index)
            }
        }
    }

    /// Kafelek galerii przeciągnięty w obrębie kreatora (tekst z numerem pozycji).
    private func internalIndex(_ providers: [NSItemProvider], prefix: String, _ handle: @escaping @MainActor (Int) -> Void) {
        guard let provider = providers.first(where: { $0.canLoadObject(ofClass: NSString.self) }) else { return }
        _ = provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let value = object as? NSString else { return }
            let text = value as String
            guard text.hasPrefix(prefix), let index = Int(text.dropFirst(prefix.count)) else { return }
            Task { @MainActor in handle(index) }
        }
    }

    // MARK: Lista kontrolna → pole
    private func jump(_ key: String, _ proxy: ScrollViewProxy) {
        let target = portfolioCheckTarget(key, content.wrappedValue)
        // Pola w siatkach SEO — przewijamy do karty (siatka tworzy pola leniwie), podświetlamy pole.
        let anchor: String = ["keywords", "city"].contains(target) ? "seo" : target
        withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo("portfolio-" + anchor, anchor: .center) }
        highlightTask?.cancel()
        highlight = target
        highlightTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(450))
            if Task.isCancelled { return }
            switch key {
            case "title": focus = .title
            case "slug": slugFocused = true
            case "description": focus = .description
            case "detailed": focus = .detailed
            case "meta": focus = .meta
            case "alt":
                if let image = content.wrappedValue.image, image.alt.isEmpty { focus = .heroAlt }
                else if let index = content.wrappedValue.gallery.firstIndex(where: { $0.alt.isEmpty }) { focus = .alt(index) }
            default: break
            }
            try? await Task.sleep(for: .milliseconds(1400))
            if Task.isCancelled { return }
            highlight = nil
        }
    }

    // MARK: Asystent AI przy sekcjach
    private var briefBinding: Binding<String> {
        Binding(get: { store.briefs[id] ?? "" }, set: { store.briefs[id] = String($0.prefix(1500)) })
    }

    /// Propozycje do bieżącej (także niezapisanej) treści; opisy zdjęć trafiają od razu do pustych pól.
    private func askAi(_ section: PortfolioAiSection) async {
        let photos = content.wrappedValue.photos
        guard let result = await store.assist(id, brief: store.briefs[id] ?? "", fields: section.fields,
                                              usePhotos: section.photos && !photos.isEmpty, pending: section.pending) else { return }
        if section == .alts {
            var value = content.wrappedValue
            let filled = value.applyAlts(result.alts ?? [], all: !value.photos.contains { $0.alt.isEmpty })
            if filled > 0 {
                content.wrappedValue = value
                state.succeed("Uzupełniono opisy zdjęć: \(filled) — sprawdź je i zapisz realizację")
            } else {
                state.error = "Asystent nie zaproponował opisów zdjęć — spróbuj ponownie."
            }
            return
        }
        ai[section] = result
    }

    private func aiButton(_ section: PortfolioAiSection, label: String? = nil) -> some View {
        Button { Task { await askAi(section) } } label: { Label(label ?? section.button, systemImage: "sparkles") }
            .buttonStyle(.bordered).tint(theme.accent).controlSize(.small)
            .help("Asystent AI — propozycje z danych realizacji, notatki dla asystenta i zdjęć")
    }

    private func aiPanel<Inner: View>(_ title: String, _ section: PortfolioAiSection, @ViewBuilder _ inner: () -> Inner) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles").foregroundStyle(theme.accent)
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                Spacer()
                Button("Inne propozycje") { Task { await askAi(section) } }.buttonStyle(.link).font(.caption)
                Button { ai[section] = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain).help("Zamknij propozycje")
            }
            inner()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.35)))
    }

    private func aiText(_ label: String, _ text: String, hint: String? = nil, hintColor: Color = .secondary, use: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                if let hint { Text(hint).font(.caption2).foregroundStyle(hintColor) }
                Spacer()
                Button("Użyj", action: use).buttonStyle(.link).font(.caption)
            }
            Text(text).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
    }

    private func aiChip(_ text: String, done: Bool) -> some View {
        Text(text).font(.caption)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .overlay(Capsule().stroke(done ? Color.green.opacity(0.5) : theme.accent.opacity(0.4)))
            .foregroundStyle(done ? Color.green : theme.accent)
    }

    private func applied(_ message: String = "Wstawiono propozycję — zapisz realizację") { state.succeed(message) }

    private func cityName(_ slug: String) -> String { cities.first { $0.locality == slug }?.name ?? slug }

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
            features(draft).id("portfolio-features").portfolioMark(highlight == "features", theme.accent)
            seo(draft).id("portfolio-seo")
        }
    }

    // MARK: Podstawy
    private func basics(_ detail: PortfolioDetail, _ draft: PortfolioDraft) -> some View {
        card("Podstawy") {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Tytuł").font(.callout)
                    Spacer()
                    aiButton(.title)
                }
                TextField("Jubileusz 30 lat marki", text: limited(content.title, PortfolioLimits.title)).textFieldStyle(.roundedBorder)
                    .focused($focus, equals: .title)
                if let titles = ai[.title]?.titles, !titles.isEmpty { titleProposals(titles, onSite: detail.item.status.onSite) }
            }
            .id("portfolio-title").portfolioMark(highlight == "title", theme.accent)
            field("Notatka dla asystenta AI", hint: "(opcjonalnie — motyw, dla kogo, co przygotowaliśmy; asystent użyje jej przy tytule, opisach, elementach i SEO)") {
                textBox(briefBinding, height: 46, placeholder: "Np. urodziny 30-latki w stylu Wielkiego Gatsby'ego, scena z ekranem LED, kasyno, fotolustro, muzyka na żywo.")
            }
            slugField(detail, draft).id("portfolio-slug").portfolioMark(highlight == "slug", theme.accent)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)],
                      alignment: .leading, spacing: 10) {
                field("Kategoria") { categoryField }
                field("Data eventu") { dateField(draft) }
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

    private func titleProposals(_ titles: [String], onSite: Bool) -> some View {
        aiPanel("Propozycje tytułu — kliknij, żeby wstawić", .title) {
            WrapLayout(spacing: 6) {
                ForEach(titles, id: \.self) { title in
                    let current = content.wrappedValue.title == title
                    Button {
                        content.wrappedValue.setTitle(title, onSite: onSite)
                        applied("Wstawiono tytuł — zapisz realizację")
                    } label: {
                        HStack(spacing: 4) {
                            Text(title).font(.callout)
                            Text("\(title.count) zn.").font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 7).fill(current ? theme.accent.opacity(0.18) : Color.clear))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(current ? theme.accent : theme.accent.opacity(0.3)))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if !onSite {
                Text("Adres strony zmieni się razem z tytułem, jeśli nie był ustawiony ręcznie.").font(.caption2).foregroundStyle(.secondary)
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
        field("Event w CRM") {
            HStack(spacing: 6) {
                Button { eventPickerShown = true } label: {
                    Label(draft.event?.name ?? "Powiąż z eventem", systemImage: "calendar").lineLimit(1)
                }
                if draft.eventID != nil {
                    Button {
                        store.drafts[id]?.eventID = nil
                        store.drafts[id]?.event = nil
                    } label: { Image(systemName: "xmark") }
                        .help("Bez eventu")
                }
                if let event = draft.event { Text(event.summary).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Spacer()
            }
        }
    }

    // MARK: Zdjęcia
    private func photos(_ draft: PortfolioDraft) -> some View {
        let missingAlt = draft.content.photos.filter { $0.alt.isEmpty }.count
        return card(nil) {
            HStack(spacing: 8) {
                Text("Zdjęcia").font(.headline)
                Text("(\(draft.content.photos.count))").font(.caption).foregroundStyle(.secondary)
                if !draft.content.photos.isEmpty {
                    aiButton(.alts, label: missingAlt > 0 ? "Opisz zdjęcia (\(missingAlt) bez opisu)" : "Nowe opisy zdjęć")
                }
                Spacer(minLength: 8)
                Button { chooseFiles() } label: { Label("Z dysku", systemImage: "square.and.arrow.up") }
                ForEach(PortfolioPhotoSource.allCases) { source in
                    Button { picker = source } label: { Label(source.button, systemImage: source.symbol) }
                }
            }
            Text("Przeciągnij zdjęcia z Findera, Zdjęć albo Safari na tę sekcję (na zdjęcie główne — zastąpi je, na kafelek galerii — wstawi w to miejsce). JPEG, PNG, WebP, HEIC; wersje strony (WebP: komputer, telefon, miniatura) powstaną na serwerze.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 14) {
                hero(draft).frame(width: 250).id("portfolio-image").portfolioMark(highlight == "image", theme.accent)
                gallery(draft).id("portfolio-gallery").portfolioMark(highlight == "gallery", theme.accent)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(dropping ? theme.accent : Color.clear, lineWidth: 2))
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.55))
                    .overlay(Label("Upuść zdjęcia, żeby dodać je do realizacji", systemImage: "square.and.arrow.down")
                        .font(.title3).foregroundStyle(theme.accent)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 10).fill(theme.card)))
                    .allowsHitTesting(false)
            }
        }
        .onDrop(of: PortfolioDrop.types, isTargeted: $dropping) { providers in
            guard PortfolioDrop.external(providers) else { return false }
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
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(heroDropping ? theme.accent : Color.clear, lineWidth: 3))
                TextField("Opis zdjęcia (alt)", text: alt).textFieldStyle(.roundedBorder)
                    .focused($focus, equals: .heroAlt)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(image.alt.isEmpty ? Color.orange.opacity(0.5) : Color.clear))
            } else {
                Button { chooseFiles() } label: {
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(theme.accent.opacity(heroDropping ? 0.9 : 0.35), style: StrokeStyle(lineWidth: heroDropping ? 2 : 1, dash: [5, 4]))
                        .aspectRatio(4.0 / 3.0, contentMode: .fit)
                        .overlay {
                            VStack(spacing: 6) {
                                Image(systemName: "photo.badge.plus").font(.largeTitle)
                                Text("Upuść zdjęcie główne albo kliknij").font(.caption)
                            }
                            .foregroundStyle(theme.accent.opacity(heroDropping ? 1 : 0.6))
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        // Zdjęcie z zewnątrz — nowe zdjęcie główne; kafelek galerii — „Ustaw jako główne”.
        .onDrop(of: PortfolioDrop.types + [UTType.utf8PlainText, .plainText], isTargeted: $heroDropping) { providers in
            if PortfolioDrop.external(providers) {
                accept(providers, place: .main)
            } else {
                internalIndex(providers, prefix: Self.dragPrefix) { from in makeMain(from) }
            }
            return true
        }
    }

    private func gallery(_ draft: PortfolioDraft) -> some View {
        let items = Array(draft.content.gallery.enumerated())
        return VStack(alignment: .leading, spacing: 6) {
            Text("Galeria — przeciągnij, żeby zmienić kolejność").font(.caption).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                ForEach(items, id: \.offset) { item in galleryTile(item.element, index: item.offset, count: items.count) }
                if items.count < PortfolioLimits.gallery { dropTile }
            }
            if items.isEmpty {
                Text("Dodaj 5–12 zdjęć: szerokie ujęcie sali, scena, detale, goście (bez portretów).").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Widoczna strefa upuszczania na końcu galerii (kliknięcie — wybór z dysku).
    private var dropTile: some View {
        Button { chooseFiles() } label: {
            VStack(spacing: 5) {
                Image(systemName: "square.and.arrow.down.on.square").font(.title2)
                Text("Upuść zdjęcia tutaj").font(.caption.weight(.semibold))
                Text("z Findera, Zdjęć, Safari — albo kliknij").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .foregroundStyle(theme.accent.opacity(0.85))
            .frame(maxWidth: .infinity, minHeight: 140)
            .background(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.accent.opacity(0.4), style: StrokeStyle(lineWidth: 1.2, dash: [5, 4])))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onDrop(of: PortfolioDrop.types, isTargeted: nil) { providers in
            guard PortfolioDrop.external(providers) else { return false }
            accept(providers)
            return true
        }
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
                .focused($focus, equals: .alt(index))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(photo.alt.isEmpty ? Color.orange.opacity(0.5) : Color.clear))
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(targeted ? 0.14 : 0.04)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(targeted ? theme.accent : Color.clear, lineWidth: 1.5))
        // Kafelek galerii (zmiana kolejności) albo zdjęcia z zewnątrz (Finder, Zdjęcia, Safari) — wstawione w to miejsce.
        .onDrop(of: [UTType.utf8PlainText, .plainText] + PortfolioDrop.types, isTargeted: Binding(
            get: { dropIndex == index },
            set: { inside in if inside { dropIndex = index } else if dropIndex == index { dropIndex = nil } }
        )) { providers in
            dropIndex = nil
            if PortfolioDrop.external(providers) {
                accept(providers, place: .at(index))
            } else {
                internalIndex(providers, prefix: Self.dragPrefix) { from in moveGallery(from: from, to: index) }
            }
            return true
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
        card(nil) {
            HStack {
                Text("Opisy").font(.headline)
                Spacer()
                aiButton(.descriptions)
            }
            if let result = ai[.descriptions], (result.description?.isEmpty == false) || (result.detailedDescription?.isEmpty == false) {
                aiPanel("Propozycje opisów", .descriptions) {
                    if let short = result.description, !short.isEmpty {
                        aiText("Krótki opis", short, hint: "\(short.count) zn.") { content.wrappedValue.description = String(short.prefix(PortfolioLimits.description)); applied() }
                    }
                    if let long = result.detailedDescription, !long.isEmpty {
                        aiText("Szczegółowy opis", long, hint: "\(long.count) zn.") { content.wrappedValue.detailedDescription = String(long.prefix(PortfolioLimits.detailedDescription)); applied() }
                    }
                    if let short = result.description, !short.isEmpty, let long = result.detailedDescription, !long.isEmpty {
                        Button("Użyj obu") {
                            content.wrappedValue.description = String(short.prefix(PortfolioLimits.description))
                            content.wrappedValue.detailedDescription = String(long.prefix(PortfolioLimits.detailedDescription))
                            applied("Wstawiono oba opisy — zapisz realizację")
                            ai[.descriptions] = nil
                        }
                        .buttonStyle(.link).font(.caption)
                    }
                }
            }
            field("Krótki opis", hint: "(\(draft.content.description.count)/\(PortfolioLimits.description) — karta realizacji)") {
                textBox(limited(content[dynamicMember: \.description], PortfolioLimits.description), height: 70).focused($focus, equals: .description)
            }
            .id("portfolio-description").portfolioMark(highlight == "description", theme.accent)
            field("Szczegółowy opis", hint: "(\(draft.content.detailedDescription.count) znaków, zalecane od \(PortfolioLimits.detailedRecommended); akapity oddziel pustą linią)") {
                textBox(limited(content.detailedDescription, PortfolioLimits.detailedDescription), height: 220).focused($focus, equals: .detailed)
            }
            .id("portfolio-detailed").portfolioMark(highlight == "detailed", theme.accent)
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

    /// Przeciągnięcie elementu realizacji: upuszczony element zajmuje miejsce wiersza docelowego.
    private func dragFeature(from: Int, to: Int) {
        var features = content.wrappedValue.features
        guard features.indices.contains(from), features.indices.contains(to), from != to else { return }
        let moved = features.remove(at: from)
        features.insert(moved, at: to)
        content.wrappedValue.features = features
    }

    private func features(_ draft: PortfolioDraft) -> some View {
        let count = draft.content.features.count
        return card(nil) {
            HStack {
                Text("Elementy realizacji").font(.headline)
                Text("(\(count)/\(PortfolioLimits.features))").font(.caption).foregroundStyle(.secondary)
                Spacer()
                aiButton(.features)
                Button { content.wrappedValue.features.append(PortfolioFeature()) } label: { Label("Dodaj element", systemImage: "plus") }
                    .disabled(count >= PortfolioLimits.features)
            }
            if let proposed = ai[.features]?.features, !proposed.isEmpty { featureProposals(proposed) }
            if count > 1 {
                Text("Przeciągnij element za uchwyt, żeby zmienić kolejność (albo strzałki).").font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(Array(draft.content.features.indices), id: \.self) { index in featureRow(index, count: count) }
            if count == 0 {
                Text("Np. scena z ekranem LED, oświetlenie architektoniczne, prowadzący — 3–6 elementów z ikonami na stronie realizacji.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func featureProposals(_ proposed: [PortfolioFeature]) -> some View {
        let locale = Locale(identifier: "pl_PL")
        return aiPanel("Propozycje elementów realizacji", .features) {
            ForEach(Array(proposed.enumerated()), id: \.offset) { item in
                let feature = item.element
                let exists = content.wrappedValue.features.contains { $0.title.lowercased(with: locale) == feature.title.lowercased(with: locale) }
                HStack(spacing: 8) {
                    Image(systemName: PortfolioIcon.named(feature.icon).symbol).foregroundStyle(theme.accent).frame(width: 20)
                    (Text(feature.title).font(.callout) + Text(feature.description.isEmpty ? "" : " — \(feature.description)").font(.caption).foregroundColor(.secondary))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if exists {
                        Text("już jest").font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Button("Dodaj") { content.wrappedValue.addFeatures([feature]); applied("Dodano element — zapisz realizację") }
                            .buttonStyle(.link).font(.caption).disabled(content.wrappedValue.features.count >= PortfolioLimits.features)
                    }
                }
            }
            Divider()
            HStack(spacing: 14) {
                Button("Zastąp listę") {
                    content.wrappedValue.features = Array(proposed.prefix(PortfolioLimits.features))
                    applied("Zastąpiono elementy realizacji — zapisz realizację")
                    ai[.features] = nil
                }
                Button("Dodaj nowe") {
                    content.wrappedValue.addFeatures(proposed)
                    applied("Dodano nowe elementy — zapisz realizację")
                    ai[.features] = nil
                }
            }
            .buttonStyle(.link).font(.caption)
        }
    }

    private func featureRow(_ index: Int, count: Int) -> some View {
        let binding = feature(index)
        let icon = PortfolioIcon.named(binding.wrappedValue.icon)
        let targeted = featureDropIndex == index
        return HStack(spacing: 8) {
            // Uchwyt przeciągania (pola tekstowe wiersza zostają do zaznaczania tekstu).
            Image(systemName: "line.3.horizontal").foregroundStyle(.secondary).frame(width: 18, height: 22).contentShape(Rectangle())
                .help("Przeciągnij, żeby zmienić kolejność")
                .draggable(Self.featurePrefix + String(index)) {
                    Label(binding.wrappedValue.title.isEmpty ? icon.label : binding.wrappedValue.title, systemImage: icon.symbol)
                        .padding(6).background(RoundedRectangle(cornerRadius: 6).fill(theme.card))
                }
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
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(targeted ? 0.12 : 0)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(targeted ? theme.accent : Color.clear, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])))
        .dropDestination(for: String.self) { items, _ in
            featureDropIndex = nil
            guard let item = items.first, item.hasPrefix(Self.featurePrefix), let from = Int(item.dropFirst(Self.featurePrefix.count)) else { return false }
            dragFeature(from: from, to: index)
            return true
        } isTargeted: { inside in
            if inside { featureDropIndex = index } else if featureDropIndex == index { featureDropIndex = nil }
        }
    }

    // MARK: SEO i miasta
    private func seo(_ draft: PortfolioDraft) -> some View {
        let meta = draft.content.metaDescription.count
        let metaOK = meta >= PortfolioLimits.metaMin && meta <= PortfolioLimits.metaMax
        return card(nil) {
            HStack {
                Text("SEO i miasta").font(.headline)
                Spacer()
                aiButton(.seo)
            }
            if let result = ai[.seo] { seoProposals(result) }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("Opis w Google").font(.callout)
                    Text("\(meta) znaków (zalecane \(PortfolioLimits.metaMin)–\(PortfolioLimits.metaMax))").font(.caption).foregroundStyle(metaOK ? Color.green : Color.orange)
                }
                textBox(limited(content.metaDescription, PortfolioLimits.metaDescription), height: 54).focused($focus, equals: .meta)
            }
            .id("portfolio-meta").portfolioMark(highlight == "meta", theme.accent)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)],
                      alignment: .leading, spacing: 10) {
                field("Słowa kluczowe", hint: "(Enter albo przecinek)") {
                    PortfolioChipsField(values: content.keywords, placeholder: "gala firmowa olsztyn", max: PortfolioLimits.keywords, maxLength: PortfolioLimits.keyword)
                }
                .portfolioMark(highlight == "keywords", theme.accent)
                field("Tagi", hint: "(np. „konferencje” — strony konferencji)") {
                    PortfolioChipsField(values: content.tags, placeholder: "konferencje", max: PortfolioLimits.tags, maxLength: PortfolioLimits.tag)
                }
                field("Miasto realizacji") { cityPicker(draft) }.portfolioMark(highlight == "city", theme.accent)
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

    private func seoProposals(_ result: PortfolioAiResult) -> some View {
        let locale = Locale(identifier: "pl_PL")
        let current = content.wrappedValue
        return aiPanel("Propozycje SEO — opis w Google, frazy, tagi i miasta", .seo) {
            if let meta = result.metaDescription, !meta.isEmpty {
                let ok = meta.count >= PortfolioLimits.metaMin && meta.count <= PortfolioLimits.metaMax
                aiText("Opis w Google", meta, hint: "\(meta.count) zn.", hintColor: ok ? .green : .orange) {
                    content.wrappedValue.metaDescription = String(meta.prefix(PortfolioLimits.metaDescription)); applied()
                }
            }
            if let keywords = result.keywords, !keywords.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 12) {
                        Text("Słowa kluczowe").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Dodaj brakujące") {
                            content.wrappedValue.keywords = portfolioMergePhrases(current.keywords, keywords, max: PortfolioLimits.keywords, maxLength: PortfolioLimits.keyword)
                            applied("Dodano słowa kluczowe — zapisz realizację")
                        }
                        Button("Zastąp") {
                            content.wrappedValue.keywords = portfolioMergePhrases([], keywords, max: PortfolioLimits.keywords, maxLength: PortfolioLimits.keyword)
                            applied("Zastąpiono słowa kluczowe — zapisz realizację")
                        }
                    }
                    .buttonStyle(.link).font(.caption)
                    WrapLayout(spacing: 4) {
                        ForEach(keywords, id: \.self) { keyword in
                            aiChip(keyword, done: current.keywords.contains { $0.lowercased(with: locale) == keyword.lowercased(with: locale) })
                        }
                    }
                }
            }
            if let tags = result.tags, !tags.isEmpty {
                HStack(spacing: 6) {
                    Text("Tagi:").font(.caption).foregroundStyle(.secondary)
                    WrapLayout(spacing: 4) { ForEach(tags, id: \.self) { tag in aiChip(tag, done: current.tags.contains(tag)) } }
                    Spacer()
                    Button("Dodaj") {
                        content.wrappedValue.tags = portfolioMergePhrases(current.tags, tags, max: PortfolioLimits.tags, maxLength: PortfolioLimits.tag)
                        applied("Dodano tagi — zapisz realizację")
                    }
                    .buttonStyle(.link).font(.caption)
                }
            }
            HStack(spacing: 6) {
                Text("Miasto realizacji:").font(.caption).foregroundStyle(.secondary)
                if let slug = result.eventCitySlug, !slug.isEmpty {
                    Text(cityName(slug)).font(.callout)
                    Spacer()
                    if current.eventCitySlug == slug {
                        Text("ustawione").font(.caption2).foregroundStyle(.green)
                    } else {
                        Button("Ustaw") { content.wrappedValue.eventCitySlug = slug; applied("Ustawiono miasto realizacji — zapisz realizację") }
                            .buttonStyle(.link).font(.caption)
                    }
                } else {
                    Text("nie udało się ustalić — wpisz miasto w polu „Miejsce” albo wybierz z listy").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
            }
            if let slugs = result.referenceCitySlugs, !slugs.isEmpty {
                HStack(spacing: 6) {
                    Text("Priorytetowe miasta:").font(.caption).foregroundStyle(.secondary)
                    WrapLayout(spacing: 4) { ForEach(slugs, id: \.self) { slug in aiChip(cityName(slug), done: current.referenceCitySlugs.contains(slug)) } }
                    Spacer()
                    Button("Dodaj") {
                        content.wrappedValue.referenceCitySlugs = portfolioMergePhrases(current.referenceCitySlugs, slugs, max: 60, maxLength: 120)
                        applied("Dodano priorytetowe miasta — zapisz realizację")
                    }
                    .buttonStyle(.link).font(.caption)
                }
            }
            Button("Użyj wszystkich (frazy, tagi i miasta — dopisane do obecnych)") {
                var value = content.wrappedValue
                if let meta = result.metaDescription, !meta.isEmpty { value.metaDescription = String(meta.prefix(PortfolioLimits.metaDescription)) }
                value.keywords = portfolioMergePhrases(value.keywords, result.keywords ?? [], max: PortfolioLimits.keywords, maxLength: PortfolioLimits.keyword)
                value.tags = portfolioMergePhrases(value.tags, result.tags ?? [], max: PortfolioLimits.tags, maxLength: PortfolioLimits.tag)
                if let slug = result.eventCitySlug, !slug.isEmpty { value.eventCitySlug = slug }
                value.referenceCitySlugs = portfolioMergePhrases(value.referenceCitySlugs, result.referenceCitySlugs ?? [], max: 60, maxLength: 120)
                content.wrappedValue = value
                applied("Wstawiono propozycje SEO — zapisz realizację")
                ai[.seo] = nil
            }
            .buttonStyle(.link).font(.caption)
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
        return field("Priorytetowe miasta", hint: "(na których stronach usług pokazać realizację wyżej; nie zmieniają miejsca eventu)") {
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
    private func aside(_ detail: PortfolioDetail, _ draft: PortfolioDraft, jump: @escaping (String) -> Void) -> some View {
        VStack(spacing: 14) {
            checklist(draft, jump: jump)
            googlePreview(draft)
            card(nil) { PortfolioAssistantPanel(store: store, id: id, onSite: detail.item.status.onSite) }
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

    private func checklist(_ draft: PortfolioDraft, jump: @escaping (String) -> Void) -> some View {
        card("Lista kontrolna") {
            Text("Kliknij punkt, żeby przejść do pola.").font(.caption2).foregroundStyle(.secondary)
            ForEach(portfolioChecklist(draft.content)) { check in checkRow(check, jump: jump) }
        }
    }

    private func checkRow(_ check: PortfolioCheck, jump: @escaping (String) -> Void) -> some View {
        let symbol: String = check.ok ? "checkmark.circle.fill" : check.required ? "exclamationmark.triangle.fill" : "circle.dashed"
        let color: Color = check.ok ? .green : check.required ? .red : .orange
        let label: String = check.label + (check.required && !check.ok ? " (wymagane)" : "")
        return Button { jump(check.key) } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: symbol).foregroundStyle(color).font(.callout)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(.caption).underline(!check.ok, pattern: .dot).foregroundStyle(check.ok ? Color.primary : color)
                    if !check.ok { Text(check.hint).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Przejdź do pola „\(check.label)”")
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
    /// Realizacja na stronie — adres strony nie idzie za nowym tytułem.
    var onSite = true
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var fields: Set<PortfolioAiField> = [.description, .detailedDescription, .metaDescription, .keywords]
    @State private var usePhotos = false
    @State private var result: PortfolioAiResult?

    private var photoCount: Int { store.drafts[id]?.content.photos.count ?? 0 }
    private var brief: String { store.briefs[id] ?? "" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Asystent AI", systemImage: "sparkles").font(.headline)
            Text("Kilka pól naraz. Pojedyncze sekcje — przyciski AI przy tytule, opisach, elementach, SEO i zdjęciach.")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            TextEditor(text: Binding(get: { store.briefs[id] ?? "" }, set: { store.briefs[id] = String($0.prefix(1500)) }))
                .font(.body).frame(height: 80).scrollContentBackground(.hidden)
                .padding(6).background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                .overlay(alignment: .topLeading) {
                    if brief.isEmpty {
                        Text("Notatka dla asystenta (ta sama co w „Podstawach”): dla kogo, co przygotowaliśmy (scena, technika, program), co było wyjątkowe.")
                            .font(.callout).foregroundStyle(.tertiary).padding(.horizontal, 11).padding(.vertical, 6).allowsHitTesting(false)
                    }
                }
            WrapLayout(spacing: 4) {
                ForEach(PortfolioAiField.panel) { field in fieldChip(field) }
            }
            Toggle("Uwzględnij zdjęcia (opis tego, co na nich widać; przy opisach zdjęć — zawsze)", isOn: $usePhotos)
                .toggleStyle(.checkbox).font(.caption).disabled(photoCount == 0)
            Button { Task { await ask() } } label: { Label("Przygotuj teksty", systemImage: "sparkles") }.disabled(fields.isEmpty)
            if let result { proposals(result) }
            Text("Do AI trafia treść realizacji, rodzaj, miejsce i data eventu oraz — gdy zaznaczysz — zdjęcia ze strony. Bez danych osobowych.")
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
            ForEach(PortfolioAiField.panel.filter { !result.preview($0).isEmpty }) { field in
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
        let ordered = PortfolioAiField.panel.filter { fields.contains($0) }
        if let value = await store.assist(id, brief: brief, fields: ordered, usePhotos: usePhotos && photoCount > 0) { result = value }
    }

    private func use(_ field: PortfolioAiField, _ result: PortfolioAiResult) {
        guard var content = store.drafts[id]?.content else { return }
        if result.apply(field, to: &content, onSite: onSite) {
            store.drafts[id]?.content = content
            state.succeed("Wstawiono propozycję — zapisz realizację")
        }
    }

    private func useAll(_ result: PortfolioAiResult) {
        guard var content = store.drafts[id]?.content else { return }
        for field in PortfolioAiField.panel { result.apply(field, to: &content, onSite: onSite) }
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
