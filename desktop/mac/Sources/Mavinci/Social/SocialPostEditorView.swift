import SwiftUI
import AppKit

// MARK: Social media → kreator posta — 1:1 z CRM (`SocialPostEditor`): kanały, termin, wydarzenie, szablon, styl grafiki
// (karuzela: kolejne zdjęcia z kadrem w każdym formacie feedu, kolejność przeciąganiem, podglądy ze strzałkami),
// (miniatury wszystkich stylów), formaty 4:5 / 1:1 / 9:16 / 1,91:1 ze zdjęciem z biblioteki, natywny edytor kadru (przeciąganie,
// powiększanie gestem i suwakiem, propozycja kadru, pola logo i tekstów stylu, widoczna część zdjęcia w passe-partout i kinie,
// strefy relacji), napis nad tytułem, tytuł i podpis grafiki, opis, hashtagi, asystent AI, natywne podglądy (feed, siatka
// profilu, relacja, Facebook): grafiki z serwera, a przy niezapisanych zmianach podgląd na żywo — zdjęcie w bieżącym kadrze
// i warstwa stylu z serwera (przyciemnienia, ramy, maski, logo, teksty; ten sam HTML i Chromium co render, więc wygląda jak
// grafika po zapisie), braki, historia i akcje statusu. Układ na pełną szerokość: trzy kolumny na szerokim ekranie
// (MacBook Pro 16"), dwie na MacBooku Air 13".

private struct SocialVariantDraft: Equatable {
    var enabled: Bool
    var asset: SocialAsset?
    var crop: SocialCrop?
    var touched: Bool
}

/// Kolejne zdjęcie karuzeli: kadry w formatach feedu (brak — propozycja zdjęcia); `touched` — kadr zmieniony w kreatorze.
private struct SocialSlideDraft: Equatable {
    var asset: SocialAsset
    var crops: [SocialFormat: SocialCrop] = [:]
    var touched: Set<SocialFormat> = []
}

/// Zdjęcie kolażu w miejscu 1–3 układu (miejsce 0 — zdjęcie wariantu): kadry w formatach w proporcjach miejsca.
private struct SocialSlotDraft: Equatable {
    var slot: Int
    var asset: SocialAsset
    var crops: [SocialFormat: SocialCrop] = [:]
    var touched: Set<SocialFormat> = []
}

private struct SocialPostDraft: Equatable {
    var title = ""
    var channels: Set<SocialChannel> = []
    var hasDate = false
    var scheduledAt = Date()
    var caption = ""
    var hashtags = ""
    var templateID: String?
    var eventID: String?
    var eventName: String?
    var headline = ""
    var subline = ""
    /// Styl grafiki i napis nad tytułem — wspólne dla wszystkich formatów posta.
    var style: SocialGraphicStyle = .classic
    var kicker = ""
    var variants: [SocialFormat: SocialVariantDraft] = [:]
    /// Karuzela (Instagram — przesuwane zdjęcia, Facebook i LinkedIn — post z kilkoma zdjęciami); okładka to `variants`.
    var slides: [SocialSlideDraft] = []
    /// Układ jako dane (`nil` — styl grafiki) i zdjęcia kolażu.
    var layout: SocialLayoutChoice?
    /// Ten sam układ w aktualnej wersji (zmieniony w edytorze układów po zapisaniu posta) — zapis z `refresh`.
    var layoutRefresh = false
    var slots: [SocialSlotDraft] = []

    init() {}

    init(_ detail: SocialPostDetail) {
        title = detail.post.title
        channels = Set(detail.post.channels)
        if let raw = detail.post.scheduledAt, let date = SocialDates.parse(raw) { hasDate = true; scheduledAt = date } else {
            var parts = Calendar.current.dateComponents([.year, .month, .day], from: Date())
            parts.hour = 18
            scheduledAt = Calendar.current.date(from: parts) ?? Date()
        }
        caption = detail.post.caption
        hashtags = detail.post.hashtags.joined(separator: " ")
        templateID = detail.post.templateId
        eventID = detail.event?.id ?? detail.post.eventId
        eventName = detail.event?.name
        headline = detail.variants.first?.headline ?? ""
        subline = detail.variants.first?.subline ?? ""
        style = detail.variants.first.map { SocialGraphicStyle(raw: $0.style) } ?? (detail.template?.graphicStyle ?? .classic)
        kicker = detail.variants.first?.kicker ?? ""
        for format in SocialFormat.allCases {
            let saved = detail.variant(format)
            variants[format] = SocialVariantDraft(enabled: saved != nil, asset: saved?.asset, crop: saved?.crop, touched: false)
        }
        slides = (detail.slides ?? []).sorted { $0.position < $1.position }.compactMap { slide -> SocialSlideDraft? in
            guard let asset = slide.asset else { return nil }
            var crops: [SocialFormat: SocialCrop] = [:]
            for item in slide.formats { if let crop = item.crop { crops[item.format] = crop } }
            return SocialSlideDraft(asset: asset, crops: crops)
        }
        layout = detail.layout?.choice
        slots = (detail.slots ?? []).sorted { $0.slot < $1.slot }.compactMap { item -> SocialSlotDraft? in
            guard let asset = item.asset else { return nil }
            var crops: [SocialFormat: SocialCrop] = [:]
            for entry in item.formats { if let crop = entry.crop { crops[entry.format] = crop } }
            return SocialSlotDraft(slot: item.slot, asset: asset, crops: crops)
        }
    }

    func variant(_ format: SocialFormat) -> SocialVariantDraft { variants[format] ?? SocialVariantDraft(enabled: false, asset: nil, crop: nil, touched: false) }
    var formatsWithPhoto: [SocialFormat] { SocialFormat.allCases.filter { variant($0).enabled && variant($0).asset != nil } }
}

private enum SocialPreviewTab: String, CaseIterable, Identifiable {
    case feed, grid, story, facebook, linkedin
    var id: String { rawValue }
    var label: String {
        switch self {
        case .feed: return "Feed Instagram"
        case .grid: return "Siatka profilu"
        case .story: return "Relacja"
        case .facebook: return "Facebook"
        case .linkedin: return "LinkedIn"
        }
    }
}

private enum SocialPickerTarget: Identifiable {
    case all, format(SocialFormat), slideAdd, slide(Int), collage(Int)
    var id: String {
        switch self {
        case .all: return "all"
        case .format(let format): return format.rawValue
        case .slideAdd: return "slide-add"
        case .slide(let index): return "slide-\(index)"
        case .collage(let slot): return "collage-\(slot)"
        }
    }
}

@MainActor struct SocialPostEditorView: View {
    @ObservedObject var store: SocialStore
    let postID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var draft = SocialPostDraft()
    @State private var baseline = SocialPostDraft()
    @State private var loadedRevision: String?
    @State private var active: SocialFormat = .portrait
    @State private var preview: SocialPreviewTab = .feed
    @State private var picker: SocialPickerTarget?
    /// Karuzela: wybrane zdjęcie w edytorze kadru (`nil` — okładka).
    @State private var slideIndex: Int?
    /// Kolaż: edytowane miejsce (1–3; `nil` — zdjęcie wariantu).
    @State private var slotEdit: Int?
    @State private var eventPickerShown = false
    @State private var noteShown = false
    @State private var note = ""
    @State private var publishShown = false
    @State private var publishURL = ""
    @State private var historyShown = false
    @State private var confirmClose = false
    @State private var confirmDelete = false
    @State private var confirmCancel = false
    @State private var confirmPublishNow = false
    @State private var scheduleShown = false
    @State private var scheduleDate = Date()
    /// Edytor układów grafik na całej szerokości (kreator posta zostaje z niezapisanymi zmianami).
    @State private var layoutsShown = false

    private var detail: SocialPostDetail? { store.detail(postID) }
    private var dirty: Bool { draft != baseline }

    /// Podgląd na żywo zamiast plików z serwera: niezapisane zmiany albo grafika nieaktualna (np. nowa księga znaku).
    private func liveNeeded(_ detail: SocialPostDetail) -> Bool {
        dirty || detail.variants.contains { $0.assetId != nil && !$0.upToDate }
    }

    private func overlayKey(_ detail: SocialPostDetail, _ format: SocialFormat, style: SocialGraphicStyle? = nil,
                            layout: SocialLayoutDefinition? = nil) -> String {
        SocialStore.overlayKey(company: detail.post.companyId, template: draft.templateID, format: format, headline: draft.headline,
                               subline: draft.subline, style: style ?? draft.style, kicker: draft.kicker, layout: layout)
    }

    /// Definicja wybranego układu: migawka zapisana w poście (ten sam wybór, bez „nowej wersji”) albo aktualna z listy układów.
    private func layoutDefinition(_ detail: SocialPostDetail) -> SocialLayoutDefinition? {
        guard let choice = draft.layout else { return nil }
        if !draft.layoutRefresh, let saved = detail.layout, saved.choice == choice { return saved.definition }
        return detail.layouts?.first { $0.choice == choice }?.definition
    }

    /// Kadr zdjęcia w miejscu układu: własny (w proporcjach miejsca), propozycja formatu albo środek — jak na serwerze.
    private func layoutCrop(_ asset: SocialAsset, _ own: SocialCrop?, _ format: SocialFormat, slot: Int, layout: SocialLayoutDefinition) -> SocialCrop? {
        guard let width = asset.width, let height = asset.height else { return nil }
        let aspect = layout.slotAspect(slot, format)
        if let own, own.fits(width: width, height: height, aspect: aspect) { return own }
        if let proposal = asset.proposal(format), proposal.fits(width: width, height: height, aspect: aspect) { return proposal }
        return SocialCrop.center(width: width, height: height, aspect: aspect)
    }

    /// Zmiana układu (albo `refresh` — aktualna wersja tego samego układu): kadry niepasujące do nowych proporcji wracają do
    /// propozycji, zdjęcia kolażu ponad liczbę miejsc znikają.
    private func changeLayout(_ detail: SocialPostDetail, _ choice: SocialLayoutChoice?, refresh: Bool = false) {
        let definition: SocialLayoutDefinition? = choice.flatMap { value in
            if !refresh, let saved = detail.layout, saved.choice == value { return saved.definition }
            return detail.layouts?.first { $0.choice == value }?.definition
        }
        for format in SocialFormat.allCases {
            var item = draft.variant(format)
            guard let crop = item.crop, let width = item.asset?.width, let height = item.asset?.height else { continue }
            let aspect = definition?.slotAspect(0, format) ?? format.aspect
            if !crop.fits(width: width, height: height, aspect: aspect) {
                item.crop = nil
                item.touched = true
                draft.variants[format] = item
            }
        }
        let count = definition?.slots ?? 1
        draft.slots = draft.slots.filter { $0.slot < count }.map { SocialSlotDraft(slot: $0.slot, asset: $0.asset, crops: [:], touched: Set(SocialFormat.allCases)) }
        draft.layout = choice
        draft.layoutRefresh = refresh
        slotEdit = nil
    }

    /// Miniatury stylów (edytowalny post ze zdjęciem w aktywnym formacie i gotowym szablonem).
    private func styleThumbnailsShown(_ detail: SocialPostDetail) -> Bool {
        canvasOf(detail) == nil && detail.access.create && detail.post.status.editable && detail.spec?.ready != false && draft.variant(active).enabled
            && draft.variant(active).asset != nil
    }

    // MARK: Siatka profilu / panorama (duża grafika)
    /// Duża grafika z migawki albo wybranego układu (`nil` — zwykły post).
    private func canvasOf(_ detail: SocialPostDetail) -> SocialLayoutCanvas? { layoutDefinition(detail)?.canvas }

    /// Kafelki do podglądów: pliki z serwera (bez zmian, aktualne) albo wycinki podglądu na żywo całej grafiki.
    private func tileGraphics(_ detail: SocialPostDetail) -> [SocialGraphicSource?] {
        guard let canvas = canvasOf(detail) else { return [] }
        let tiles = canvas.tiles
        let saved = detail.tiles ?? []
        if !liveNeeded(detail), saved.count == tiles.count, saved.allSatisfy({ $0.upToDate && $0.renderedUrl != nil }) {
            return tiles.map { tile in saved.first { $0.position == tile.position }?.renderedUrl.map { SocialGraphicSource.rendered($0) } }
        }
        guard let whole = graphic(detail, .portrait) else { return tiles.map { _ in nil } }
        return tiles.map { tile in SocialGraphicSource.tile(whole, canvas: canvas.size, viewport: tile.frame) }
    }

    /// Wybór układu dużej grafiki; siatka — tylko feed Instagram, panorama — bez relacji.
    private func changeCanvasLayout(_ detail: SocialPostDetail, _ choice: SocialLayoutChoice) {
        changeLayout(detail, choice)
        guard let next = (detail.canvasLayouts ?? []).first(where: { $0.choice == choice })?.definition.canvas else { return }
        if next.isGrid {
            draft.channels = [.instagramFeed]
        } else {
            draft.channels.remove(.instagramStory)
            if draft.channels.isEmpty { draft.channels = [.instagramFeed, .facebookFeed] }
        }
    }

    /// Warstwa zdjęć karuzeli: styl okładki bez tytułu, podpisu i napisu.
    private func slideOverlayKey(_ detail: SocialPostDetail, _ format: SocialFormat) -> String {
        SocialStore.overlayKey(company: detail.post.companyId, template: draft.templateID, format: format, headline: "", subline: "",
                               style: draft.style, kicker: "")
    }

    /// Warstwy do pobrania (kolejność ładowania): podgląd na żywo w bieżącym stylu, potem miniatury pozostałych stylów,
    /// na końcu warstwa zdjęć karuzeli (bez tekstów) w formatach feedu.
    private func overlayRequests(_ detail: SocialPostDetail) -> [(format: SocialFormat, style: SocialGraphicStyle, blank: Bool, layout: SocialLayoutDefinition?)] {
        // Podgląd na żywo: z układem — warstwa układu (tło z otworami na zdjęcia); miniatury stylów — zawsze bez układu.
        let layout = layoutDefinition(detail)
        var list = overlayFormats(detail).map { (format: $0, style: draft.style, blank: false, layout: layout) }
        if styleThumbnailsShown(detail) {
            for style in [draft.style] + SocialGraphicStyle.allCases.filter({ $0 != draft.style })
            where !list.contains(where: { $0.format == active && $0.style == style && !$0.blank && $0.layout == nil }) {
                list.append((format: active, style: style, blank: false, layout: nil))
            }
        }
        if !draft.slides.isEmpty, detail.spec?.ready != false, (detail.access.create && detail.post.status.editable) || liveNeeded(detail) {
            for format in draft.formatsWithPhoto where socialSlideFormats.contains(format) {
                list.append((format: format, style: draft.style, blank: true, layout: nil))
            }
        }
        return list
    }

    /// Formaty, dla których ładujemy warstwę podglądu (aktywny pierwszy): przy podglądzie na żywo — wszystkie ze zdjęciem,
    /// w edytowalnym poście bez zmian — aktywny (pierwsze przesunięcie kadru od razu pokazuje wynik).
    private func overlayFormats(_ detail: SocialPostDetail) -> [SocialFormat] {
        let formats = draft.formatsWithPhoto
        guard !formats.isEmpty, detail.spec?.ready != false else { return [] }
        // Duża grafika: podgląd całości zawsze na żywo (plik wariantu to tylko kafelek 1).
        if canvasOf(detail) != nil { return formats.contains(.portrait) ? [.portrait] : [] }
        if liveNeeded(detail) { return (formats.contains(active) ? [active] : []) + formats.filter { $0 != active } }
        return detail.access.create && detail.post.status.editable && formats.contains(active) ? [active] : []
    }

    /// Grafika formatu w podglądach: plik z serwera, gdy aktualny i bez zmian; inaczej podgląd na żywo — zdjęcie w kadrze
    /// z formularza (jak `#photo` w HTML grafiki) i warstwa szablonu z serwera.
    private func graphic(_ detail: SocialPostDetail, _ format: SocialFormat) -> SocialGraphicSource? {
        let saved = detail.variant(format)
        if canvasOf(detail) == nil, !liveNeeded(detail), let saved, saved.upToDate, let url = saved.renderedUrl { return .rendered(url) }
        guard let photo = livePhoto(detail, format) else { return canvasOf(detail) == nil ? saved?.renderedUrl.map { SocialGraphicSource.rendered($0) } : nil }
        if let layout = layoutDefinition(detail) {
            // Układ: zdjęcia w prostokątach miejsc (kolaż) pod warstwą układu z serwera.
            var photos: [SocialLayoutPhotoSource] = []
            for slot in 0..<layout.slots {
                guard let rect = layout.slotRect(slot, format) else { continue }
                if slot == 0 {
                    photos.append(SocialLayoutPhotoSource(workURL: photo.work, crop: photo.crop, rect: rect, radius: layout.previewRadius(slot)))
                } else if let item = draft.slots.first(where: { $0.slot == slot }), let work = item.asset.workUrl,
                          let crop = layoutCrop(item.asset, item.crops[format], format, slot: slot, layout: layout) {
                    photos.append(SocialLayoutPhotoSource(workURL: work, crop: crop, rect: rect, radius: layout.previewRadius(slot)))
                } else {
                    photos.append(SocialLayoutPhotoSource(workURL: nil, crop: SocialCrop(x: 0, y: 0, w: 1, h: 1), rect: rect, radius: layout.previewRadius(slot)))
                }
            }
            return .layout(photos: photos, overlay: store.overlays[overlayKey(detail, format, layout: layout)], pending: detail.spec?.ready != false)
        }
        return .live(workURL: photo.work, crop: photo.crop, overlay: store.overlays[overlayKey(detail, format)], pending: detail.spec?.ready != false)
    }

    /// Zdjęcie formatu w kadrze z formularza (jak `#photo` w HTML grafiki) — wersja robocza i kadr.
    private func livePhoto(_ detail: SocialPostDetail, _ format: SocialFormat) -> (work: String, crop: SocialCrop)? {
        let item = draft.variant(format)
        guard item.enabled, let asset = item.asset, let width = asset.width, let height = asset.height, let work = asset.workUrl else { return nil }
        let saved = detail.variant(format)
        if let layout = layoutDefinition(detail), let crop = layoutCrop(asset, item.crop, format, slot: 0, layout: layout) {
            return (work: work, crop: crop)
        }
        let savedCrop = saved?.assetId == asset.id ? saved?.effectiveCrop : nil
        return (work: work, crop: item.crop ?? savedCrop ?? asset.proposal(format) ?? SocialCrop.center(width: width, height: height, format: format))
    }

    var body: some View {
        Group {
            if let detail, layoutsShown {
                SocialLayoutEditorView(store: store, companyID: detail.post.companyId, templateID: draft.templateID,
                                       onClose: { layoutsShown = false },
                                       onChanged: { Task { await store.loadDetail(postID) } })
            } else if let detail {
                editor(detail)
            } else if let error = store.detailErrors[postID] {
                ContentUnavailableView {
                    Label("Post", systemImage: "photo")
                } description: { Text(error) } actions: {
                    Button("Wróć do kalendarza") { store.openedPostID = nil }
                }
            } else {
                ProgressView("Ładowanie posta...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: postID) { await store.loadDetail(postID) }
        // Publikacja z harmonogramu trwa na serwerze — odświeżamy kartę co 5 s, aż się skończy.
        .task(id: detail?.post.status == .publishing) {
            while !Task.isCancelled, store.detail(postID)?.post.status == .publishing, !dirty {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { break }
                await store.loadDetail(postID)
            }
        }
        .onChange(of: detail?.post.updatedAt) { _, _ in syncDraft() }
        .onAppear { syncDraft() }
        // Warstwy podglądu na żywo i miniatur stylów: po zmianie tytułu, podpisu, napisu, stylu, szablonu albo formatów
        // (z krótką zwłoką przy pisaniu).
        .task(id: detail.map { overlayPlan($0) } ?? "") {
            guard let detail else { return }
            let requests = overlayRequests(detail)
            guard !requests.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(450))
            for request in requests {
                if Task.isCancelled { return }
                await store.loadOverlay(company: detail.post.companyId, template: draft.templateID, format: request.format,
                                        headline: request.blank ? "" : draft.headline, subline: request.blank ? "" : draft.subline,
                                        style: request.style, kicker: request.blank ? "" : draft.kicker, layout: request.layout)
            }
        }
    }

    private func overlayPlan(_ detail: SocialPostDetail) -> String {
        overlayRequests(detail).map { $0.blank ? slideOverlayKey(detail, $0.format) : overlayKey(detail, $0.format, style: $0.style, layout: $0.layout) }.joined(separator: "\n")
    }

    /// Nowa wersja posta z serwera — formularz od nowa (niezapisane zmiany zostają, jeśli to ta sama wersja).
    private func syncDraft() {
        guard let detail else { return }
        let key = detail.post.updatedAt + "|" + detail.variants.map { ($0.renderedAt ?? "") + ($0.asset?.updatedAt ?? "") }.joined()
        guard key != loadedRevision else { return }
        loadedRevision = key
        let fresh = SocialPostDraft(detail)
        draft = fresh
        baseline = fresh
        if !fresh.variant(active).enabled { active = SocialFormat.allCases.first { fresh.variant($0).enabled } ?? .portrait }
    }

    private func editor(_ detail: SocialPostDetail) -> some View {
        let editable = detail.access.create && detail.post.status.editable
        return VStack(spacing: 0) {
            toolbar(detail, editable: editable)
            Divider()
            GeometryReader { geometry in
                let wide = geometry.size.width >= 1250
                ScrollViewReader { proxy in
                    ScrollView {
                        HStack(alignment: .top, spacing: 14) {
                            settingsColumn(detail, editable: editable).frame(width: wide ? 300 : 270)
                            VStack(spacing: 14) {
                                graphicColumn(detail, editable: editable)
                                if !wide { previewColumn(detail) }
                            }
                            .frame(maxWidth: .infinity)
                            if wide { previewColumn(detail).frame(width: 390) }
                        }
                        .padding(14)
                    }
                    .onAppear {
                        guard store.focusComments else { return }
                        store.focusComments = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { withAnimation { proxy.scrollTo("social-comments", anchor: .top) } }
                    }
                }
            }
        }
        .sheet(item: $picker) { target in
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(pickerTitle(target)).font(.title3.weight(.semibold))
                    Spacer()
                    Button("Zamknij") { picker = nil }.keyboardShortcut(.cancelAction)
                }
                SocialLibraryView(store: store) { asset in choose(asset, for: target) }
            }
            .padding(20)
            .frame(width: 980, height: 700)
            .environmentObject(state).environment(\.crmTheme, theme)
        }
        .sheet(isPresented: $eventPickerShown) {
            SocialEventPickerSheet(store: store) { event in draft.eventID = event.id; draft.eventName = event.name }
                .environmentObject(state).environment(\.crmTheme, theme)
        }
        .sheet(isPresented: $noteShown) { requestChangesSheet(detail) }
        .sheet(isPresented: $publishShown) { publishSheet(detail) }
        .sheet(isPresented: $historyShown) { historySheet(detail) }
        .sheet(isPresented: $scheduleShown) { scheduleSheet(detail) }
        .confirmationDialog(detail.post.status == .failed ? "Ponowić publikację?" : "Opublikować teraz?", isPresented: $confirmPublishNow, titleVisibility: .visible) {
            Button(detail.post.status == .failed ? "Ponów publikację" : "Opublikuj teraz") {
                Task { await store.publishNow(detail); loadedRevision = nil; syncDraft() }
            }
            Button("Wróć", role: .cancel) {}
        } message: {
            let message: String = detail.post.status == .failed
                ? "Kanały, które już się opublikowały, zostaną pominięte. Pozostałe zostaną opublikowane teraz."
                : "Post trafi teraz na: " + detail.post.channels.map(\.label).joined(separator: ", ") + "."
            Text(message)
        }
        .confirmationDialog("Niezapisane zmiany", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Zamknij bez zapisu", role: .destructive) { store.openedPostID = nil }
            Button("Wróć do edycji", role: .cancel) {}
        } message: { Text("Post ma niezapisane zmiany.") }
        .confirmationDialog("Usunąć post?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń trwale", role: .destructive) {
                Task {
                    if await store.run("Usuwam post", "deletePost", ["id": .string(detail.post.id)], success: "Usunięto post") != nil {
                        store.openedPostID = nil
                        await store.load(quiet: true)
                    }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Post i jego grafiki zostaną trwale usunięte. Zdjęcia zostają w bibliotece. Tej operacji nie można cofnąć.") }
        .confirmationDialog("Anulować post?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Anuluj post", role: .destructive) { Task { await store.transition(detail, .cancel) } }
            Button("Wróć", role: .cancel) {}
        } message: { Text("Post nie zostanie opublikowany. Możesz go później przywrócić do szkicu.") }
    }

    // MARK: Pasek
    private func toolbar(_ detail: SocialPostDetail, editable: Bool) -> some View {
        HStack(spacing: 8) {
            Button { if dirty { confirmClose = true } else { store.openedPostID = nil } } label: { Label("Kalendarz", systemImage: "chevron.left") }
            TextField("Nazwa posta (wewnętrzna)", text: $draft.title).textFieldStyle(.roundedBorder).frame(maxWidth: 320).disabled(!editable)
            SocialStatusBadge(status: detail.post.status)
            Text("wersja \(detail.post.revision)\(dirty ? " · niezapisane zmiany" : "")").font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            if editable { Button { Task { await save(detail) } } label: { Label("Zapisz", systemImage: "square.and.arrow.down") }.buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command) }
            if detail.actions.contains(.submit) { Button { Task { await act(detail, .submit) } } label: { Label("Wyślij do akceptacji", systemImage: "paperplane") }.buttonStyle(.borderedProminent) }
            if detail.actions.contains(.approve) {
                Button { Task { await act(detail, .approve) } } label: { Label("Zatwierdź", systemImage: "checkmark.seal") }
                    .buttonStyle(.borderedProminent).disabled(dirty).help(dirty ? "Najpierw zapisz zmiany" : "")
            }
            if detail.actions.contains(.requestChanges) { Button { note = ""; noteShown = true } label: { Label("Do poprawy", systemImage: "arrow.uturn.backward.circle") } }
            if detail.canPublishNow == true {
                let title: String = detail.post.status == .failed ? "Ponów publikację" : "Opublikuj teraz"
                Button { confirmPublishNow = true } label: { Label(title, systemImage: "bolt.fill") }
                    .buttonStyle(.borderedProminent).disabled(dirty).help(dirty ? "Najpierw zapisz zmiany" : "Publikacja teraz (Meta, LinkedIn)")
            }
            if detail.actions.contains(.schedule) || (detail.post.status == .scheduled && detail.access.publish) {
                let title: String = detail.post.status == .scheduled ? "Zmień termin publikacji" : "Zaplanuj publikację"
                Button { scheduleDate = defaultScheduleDate(detail); scheduleShown = true } label: { Label(title, systemImage: "calendar.badge.clock") }
                    .disabled(dirty).help(dirty ? "Najpierw zapisz zmiany" : "")
            }
            if detail.actions.contains(.unschedule) { Button { Task { await act(detail, .unschedule) } } label: { Label("Wstrzymaj publikację", systemImage: "pause.circle") } }
            Menu {
                Button { Task { await store.savePackage(detail) } } label: { Label("Pobierz paczkę (grafiki i opis)", systemImage: "arrow.down.doc") }
                    .disabled(!detail.variants.contains { $0.renderedUrl != nil })
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(socialPublicationText(draft.caption, socialHashtags(draft.hashtags)), forType: .string)
                    state.succeed("Skopiowano opis z hashtagami")
                } label: { Label("Kopiuj opis", systemImage: "doc.on.doc") }
                Button { historyShown = true } label: { Label("Historia", systemImage: "clock.arrow.circlepath") }
                if detail.actions.contains(.publish) {
                    Button { publishURL = ""; publishShown = true } label: { Label("Oznacz jako opublikowany…", systemImage: "checkmark.circle") }
                }
                Divider()
                if detail.access.create {
                    Button { Task { if let copy = await store.runDetail("Kopiuję post", "duplicate", ["id": .string(detail.post.id)], success: "Utworzono kopię posta") { store.openedPostID = copy.post.id } } } label: { Label("Kopia posta", systemImage: "plus.square.on.square") }
                }
                if detail.actions.contains(.reopen) { Button { Task { await store.transition(detail, .reopen) } } label: { Label("Przywróć do szkicu", systemImage: "arrow.uturn.left") } }
                if detail.actions.contains(.cancel) { Button(role: .destructive) { confirmCancel = true } label: { Label("Anuluj post", systemImage: "xmark.circle") } }
                if detail.access.create && (detail.post.status == .draft || detail.post.status == .cancelled) {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń post", systemImage: "trash") }
                }
            } label: { Label("Więcej", systemImage: "ellipsis.circle") }
            .fixedSize()
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(theme.card)
    }

    // MARK: Lewa kolumna
    private func settingsColumn(_ detail: SocialPostDetail, editable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let review = detail.post.reviewNote, detail.post.status == .changesRequested || detail.post.status == .approved {
                VStack(alignment: .leading, spacing: 4) {
                    Text((detail.post.status == .approved ? "Zatwierdził(a)" : "Do poprawy") + (detail.post.reviewedByName.map { " — \($0)" } ?? "")).font(.headline)
                    Text(review).font(.callout)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill((detail.post.status == .approved ? Color.green : Color.orange).opacity(0.12)))
            }
            metaCard(detail)
            card {
                Text("Publikacja").font(.headline)
                let canvas = canvasOf(detail)
                ForEach(SocialChannel.allCases.filter { channel in canvas.map { $0.isGrid ? channel == .instagramFeed : channel != .instagramStory } ?? true }) { channel in
                    HStack {
                        Toggle(channel.label, isOn: Binding(get: { draft.channels.contains(channel) }, set: { on in
                            if on { draft.channels.insert(channel) } else { draft.channels.remove(channel) }
                        }))
                        .disabled(!editable || canvas?.isGrid == true)
                        if draft.channels.contains(channel) {
                            Text("→ \(channel.format(in: draft.formatsWithPhoto)?.rawValue ?? "brak grafiki")").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                if let canvas {
                    Text(canvas.isGrid ? "Siatka profilu trafia tylko na Instagram — każdy kafelek to osobny post (publikacja od ostatniego kafelka)."
                         : "Panorama to karuzela: na Instagramie przesuwana bez przerw, na Facebooku i LinkedIn — post z kilkoma zdjęciami.")
                        .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                let dateLocked = detail.post.status == .scheduled && !detail.access.publish
                Toggle("Termin publikacji", isOn: $draft.hasDate).disabled(!editable || detail.post.status == .scheduled)
                if draft.hasDate {
                    DatePicker("", selection: $draft.scheduledAt, displayedComponents: [.date, .hourAndMinute]).labelsHidden().disabled(!editable || dateLocked)
                }
                if detail.post.status == .scheduled {
                    Text("Zmiana treści cofnie zaplanowany post do szkicu (wymaga ponownej akceptacji).").font(.caption2).foregroundStyle(.secondary)
                }
                Text("Event").font(.subheadline).padding(.top, 4)
                HStack {
                    Button { eventPickerShown = true } label: { Label(draft.eventName ?? "Wybierz event", systemImage: "calendar").lineLimit(1) }.disabled(!editable)
                    if draft.eventID != nil && editable { Button { draft.eventID = nil; draft.eventName = nil } label: { Image(systemName: "xmark") }.help("Bez eventu") }
                }
                if let event = detail.event {
                    Text([event.location.isEmpty ? nil : event.location, event.organizationName].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                }
                Picker("Szablon", selection: Binding(get: { draft.templateID ?? detail.template?.id ?? "" }, set: { draft.templateID = $0.isEmpty ? nil : $0 })) {
                    ForEach(detail.templates) { template in
                        Text(template.name + (template.isDefault ? " (domyślny)" : "") + (template.ready ? "" : " — niegotowy")).tag(template.id)
                    }
                }
                .disabled(!editable)
                if let template = detail.template, !template.ready {
                    Text(template.problems.joined(separator: " ")).font(.caption).foregroundStyle(.orange)
                }
            }
            if let canvas = canvasOf(detail) {
                card {
                    Text("Siatka profilu / panorama").font(.headline)
                    SocialCanvasPicker(options: detail.canvasLayouts ?? [], selection: draft.layout, canvas: canvas, colors: detail.template?.colors,
                                       disabled: !editable) { choice in changeCanvasLayout(detail, choice) }
                    if canvas.isGrid {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("• Każdy kafelek to osobny post — zasięg rozkłada się na kafelki; całość widać po wejściu na profil.")
                            Text("• Publikacja od ostatniego kafelka do pierwszego (kafelek 1 ląduje w lewym górnym rogu).")
                            Text("• Przypięte posty przesuwają siatkę; kolejne posty publikuj po 3, żeby została równa (kolejność poprawisz też w profilu Instagram).")
                        }
                        .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("Jedno zdjęcie przez wszystkie slajdy — jeden post, całe zaangażowanie w jednym miejscu.")
                            .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else {
            card {
                HStack {
                    Text("Układ grafiki").font(.headline)
                    Spacer(minLength: 4)
                    if detail.access.approve {
                        Button { layoutsShown = true } label: { Label("Edytuj układy", systemImage: "rectangle.3.group") }
                            .buttonStyle(.borderless).font(.caption)
                    }
                }
                SocialLayoutPickerGrid(options: detail.layouts ?? [], selection: draft.layout,
                                       format: draft.variant(active).enabled ? active : (draft.formatsWithPhoto.first ?? .portrait),
                                       colors: detail.template?.colors, disabled: !editable) { choice in
                    changeLayout(detail, choice, refresh: choice == draft.layout && draft.layoutRefresh)
                }
                if let saved = detail.layout, saved.outdated == true, draft.layout == saved.choice {
                    layoutVersionNotice(detail, saved: saved, editable: editable)
                }
                if let layout = layoutDefinition(detail), layout.slots > 1 {
                    Text("Kolaż: \(layout.slots) zdjęcia — kolejne zdjęcia wybierasz w pasku „Kolaż” nad edytorem kadru.")
                        .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            }
            if canvasOf(detail) == nil {
            card {
                Text("Styl grafiki").font(.headline)
                if layoutDefinition(detail) != nil {
                    Text("Wybrany układ zastępuje styl na okładce — styl dotyczy kolejnych zdjęć karuzeli.")
                        .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if styleThumbnailsShown(detail) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                        ForEach(SocialGraphicStyle.allCases) { style in styleThumbnail(detail, style) }
                    }
                } else {
                    Picker("Styl", selection: $draft.style) {
                        ForEach(SocialGraphicStyle.allCases) { style in
                            Text(style.label + (detail.template?.graphicStyle == style ? " ★" : "")).tag(style)
                        }
                    }
                    .labelsHidden().disabled(!editable)
                }
                Text(draft.style.hint + " Logo, kolory i fonty zawsze z księgi znaku marki.").font(.caption2).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            }
            card {
                Text("Tekst na grafice").font(.headline)
                Text("Napis nad tytułem (opcjonalnie, w kolorze akcentu)").font(.caption).foregroundStyle(.secondary)
                TextField("np. Realizacja", text: $draft.kicker).textFieldStyle(.roundedBorder).disabled(!editable)
                    .onChange(of: draft.kicker) { _, value in if value.count > socialKickerLimit { draft.kicker = String(value.prefix(socialKickerLimit)) } }
                if editable {
                    WrapLayout(spacing: 4) {
                        ForEach(socialKickerSuggestions, id: \.self) { item in
                            let selected = draft.kicker == item
                            Button { draft.kicker = selected ? "" : item } label: {
                                Text(item).font(.caption2).padding(.horizontal, 7).padding(.vertical, 3)
                                    .foregroundStyle(selected ? theme.accent : Color.primary.opacity(0.75))
                                    .background(Capsule().fill(selected ? theme.accent.opacity(0.18) : Color.clear))
                                    .overlay(Capsule().stroke(selected ? theme.accent.opacity(0.7) : Color.primary.opacity(0.15)))
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if draft.kicker.count > socialKickerRecommended {
                    Text("Krótki napis wygląda najlepiej (do \(socialKickerRecommended) znaków).").font(.caption).foregroundStyle(.orange)
                }
                Text("Tytuł (\(draft.headline.count)/30 zalecane)").font(.caption).foregroundStyle(.secondary)
                TextField("Od koncepcji po ostatni akord", text: $draft.headline).textFieldStyle(.roundedBorder).disabled(!editable)
                if draft.headline.count > 30 {
                    Text("Dłuższy tytuł zostanie zmniejszony, żeby zmieścił się w marginesach. Mniej tekstu = więcej klasy.").font(.caption).foregroundStyle(.orange)
                }
                Text("Podpis (np. nazwa realizacji · miejsce)").font(.caption).foregroundStyle(.secondary)
                TextField("Jubileusz 30 lat · Hotel Marina", text: $draft.subline).textFieldStyle(.roundedBorder).disabled(!editable)
            }
            card {
                Text("Zgoda klienta").font(.headline)
                let assets = uniqueAssets()
                if assets.isEmpty { Text("Dodaj zdjęcie, żeby sprawdzić zgodę.").font(.caption).foregroundStyle(.secondary) }
                ForEach(assets) { asset in
                    HStack(spacing: 6) {
                        SocialImageView(url: asset.thumbnailUrl).frame(width: 30, height: 30).clipShape(RoundedRectangle(cornerRadius: 4))
                        Text(asset.displayTitle).font(.caption).lineLimit(1)
                        Spacer()
                        SocialConsentBadge(consent: asset.consent, compact: true)
                    }
                }
                Text("Zgodę ustawisz w Bibliotece (zdjęcie, event albo klient).").font(.caption2).foregroundStyle(.secondary)
            }
            let problems = uniqueProblems(detail)
            if !problems.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Do uzupełnienia", systemImage: "exclamationmark.triangle").font(.headline).foregroundStyle(.orange)
                    ForEach(problems, id: \.self) { problem in Text("• " + problem).font(.caption) }
                    if dirty { Text("Lista z ostatniego zapisu.").font(.caption2).foregroundStyle(.secondary) }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.orange.opacity(0.1)))
            }
        }
    }

    /// Miniatura stylu: zdjęcie w kadrze aktywnego formatu i warstwa stylu z serwera (jak grafika po zapisie).
    private func styleThumbnail(_ detail: SocialPostDetail, _ style: SocialGraphicStyle) -> some View {
        let selected = draft.style == style
        let width = 72.0
        var source: SocialGraphicSource?
        if let photo = livePhoto(detail, active) {
            source = SocialGraphicSource.live(workURL: photo.work, crop: photo.crop, overlay: store.overlays[overlayKey(detail, active, style: style)], pending: true)
        }
        return Button { draft.style = style } label: {
            VStack(spacing: 3) {
                SocialGraphicView(source: source, width: width, height: width / active.aspect)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                HStack(spacing: 2) {
                    if selected { Image(systemName: "checkmark").font(.system(size: 8, weight: .bold)) }
                    Text(style.label).font(.caption2).lineLimit(1).minimumScaleFactor(0.8)
                    if detail.template?.graphicStyle == style { Image(systemName: "star.fill").font(.system(size: 7)).help("Domyślny styl marki") }
                }
                .foregroundStyle(selected ? theme.accent : Color.primary.opacity(0.8))
            }
            .padding(4)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 8).fill(selected ? theme.accent.opacity(0.1) : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? theme.accent : Color.primary.opacity(0.12), lineWidth: selected ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(style.hint)
    }

    private func uniqueProblems(_ detail: SocialPostDetail) -> [String] {
        var seen = Set<String>()
        return (detail.problems.submit + detail.problems.publish).filter { seen.insert($0).inserted }
    }

    private func uniqueAssets() -> [SocialAsset] {
        var seen = Set<String>()
        var result: [SocialAsset] = []
        for format in SocialFormat.allCases {
            let variant = draft.variant(format)
            guard variant.enabled, let asset = variant.asset, seen.insert(asset.id).inserted else { continue }
            result.append(asset)
        }
        for slide in draft.slides where seen.insert(slide.asset.id).inserted { result.append(slide.asset) }
        return result
    }

    /// Układ zmieniono w edytorze układów po zapisaniu posta: post ma dotychczasową wersję — „Wczytaj nową wersję”
    /// (zapis z `refresh`) albo powrót do dotychczasowej.
    private func layoutVersionNotice(_ detail: SocialPostDetail, saved: SocialPostLayout, editable: Bool) -> some View {
        let refreshing = draft.layoutRefresh
        let message: String = refreshing
            ? "Nowa wersja układu „\(saved.name)” — zapisz post, żeby ją zastosować."
            : "Układ „\(saved.name)” zmieniono po zapisaniu tego posta — post ma dotychczasową wersję."
        return VStack(alignment: .leading, spacing: 6) {
            Text(message).font(.caption).fixedSize(horizontal: false, vertical: true)
            if refreshing {
                Button("Zostaw dotychczasową") { changeLayout(detail, saved.choice, refresh: false) }.font(.caption)
            } else if editable {
                Button("Wczytaj nową wersję") { changeLayout(detail, saved.choice, refresh: true) }.font(.caption)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill((refreshing ? theme.accent : Color.orange).opacity(0.12)))
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) { content() }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    // MARK: Środek — formaty, kadr, opis
    private func graphicColumn(_ detail: SocialPostDetail, editable: Bool) -> some View {
        let variant = draft.variant(active)
        let canvas = canvasOf(detail)
        return VStack(alignment: .leading, spacing: 12) {
            if let canvas {
                HStack(spacing: 8) {
                    Text((detail.canvasLayouts ?? []).first(where: { $0.choice == draft.layout })?.name ?? canvas.label).font(.callout.weight(.semibold)).foregroundStyle(theme.accent)
                    Text(canvas.isGrid ? "\(canvas.tileCount) \(canvas.tileCount == 3 ? "kafelki" : "kafelków") po 1080×1350 px (siatka 3:4 w profilu)"
                         : "\(canvas.tileCount) \(canvas.tileCount == 5 ? "slajdów" : "slajdy") po 1080×1350 px").font(.caption).foregroundStyle(.secondary)
                }
            } else {
            HStack(spacing: 8) {
                ForEach(SocialFormat.allCases) { format in
                    let item = draft.variant(format)
                    HStack(spacing: 4) {
                        Toggle("", isOn: Binding(get: { item.enabled }, set: { on in
                            var next = item
                            next.enabled = on
                            if on && next.asset == nil { next.asset = SocialFormat.allCases.compactMap { draft.variant($0).asset }.first }
                            draft.variants[format] = next
                            if on { active = format }
                        }))
                        .labelsHidden().toggleStyle(.checkbox).disabled(!editable)
                        Button(format.label) { active = format }.buttonStyle(.plain).disabled(!item.enabled)
                            .foregroundStyle(active == format ? theme.accent : Color.primary)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 8).stroke(active == format ? theme.accent : Color.primary.opacity(0.15)))
                }
                Spacer()
                if editable { Button { picker = .all } label: { Label("Zdjęcie dla wszystkich formatów", systemImage: "photo.on.rectangle") } }
            }
            Text("\(active.hint) · \(Int(active.width))×\(Int(active.height)) px").font(.caption).foregroundStyle(.secondary)
            }
            if collageOn(detail, variant) { collageStrip(detail, variant, editable: editable) }
            if carouselOn(variant) { carouselStrip(variant, editable: editable) }
            if let index = selectedSlide(variant), slotEdit == nil {
                slideEditor(detail, index: index, editable: editable)
            } else if !variant.enabled {
                Text("Ten format jest wyłączony.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(40)
            } else if let slot = selectedCollageSlot(detail, variant) {
                slotEditor(detail, slot: slot, editable: editable)
            } else if let asset = variant.asset, let width = asset.width, let height = asset.height, let workURL = asset.workUrl {
                let layout = layoutDefinition(detail)
                let aspect: Double? = layout?.slotAspect(0, active)
                let crop: SocialCrop = layout.flatMap { layoutCrop(asset, variant.crop, active, slot: 0, layout: $0) }
                    ?? variant.crop ?? asset.proposal(active) ?? SocialCrop.center(width: width, height: height, format: active)
                HStack(alignment: .top, spacing: 14) {
                    VStack(spacing: 8) {
                        SocialCropEditor(imageURL: workURL, imageWidth: width, imageHeight: height, format: active, crop: crop,
                                         guides: layout == nil ? detail.spec?.guides(draft.style, active) : nil, aspect: aspect, disabled: !editable) { next in
                            var item = draft.variant(active)
                            item.crop = next
                            item.touched = true
                            draft.variants[active] = item
                        }
                        if editable {
                            HStack {
                                Button { zoom(0.92, width: width, height: height, crop: crop, aspect: aspect) } label: { Image(systemName: "plus.magnifyingglass") }.help("Przybliż")
                                Button { zoom(1.08, width: width, height: height, crop: crop, aspect: aspect) } label: { Image(systemName: "minus.magnifyingglass") }.help("Oddal")
                                if let proposal = asset.proposal(active) {
                                    Button {
                                        if let aspect { setCrop(proposal.fitted(width: width, height: height, aspect: aspect)) }
                                        else { setCrop(proposal.fitted(width: width, height: height, format: active)) }
                                    } label: { Label("Propozycja", systemImage: "sparkles") }
                                }
                                Button {
                                    if let aspect { setCrop(SocialCrop.center(width: width, height: height, aspect: aspect)) }
                                    else { setCrop(SocialCrop.center(width: width, height: height, format: active)) }
                                } label: { Label("Środek", systemImage: "scope") }
                                Button { picker = .format(active) } label: { Label("Inne zdjęcie", systemImage: "photo") }
                            }
                            let guides = layout == nil ? detail.spec?.guides(draft.style, active) : nil
                            Text("Przeciągnij kadr, gest szczypania lub przyciski — powiększenie. Ramki: biała — logo, złota — tytuł i podpis\(guides?.window != nil ? ", przyciemnione — passe-partout albo kinowe pasy (zdjęcie widać w jasnym polu)" : "")\(guides?.unsafeTop != nil ? ", czerwone — zasłaniane w relacji" : "").")
                                .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    if canvas == nil { renderedBox(detail) }
                }
                if let canvas { canvasBox(detail, canvas) }
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "photo.on.rectangle").font(.largeTitle).foregroundStyle(theme.accent.opacity(0.5))
                    Text("Wybierz zdjęcie z biblioteki.").foregroundStyle(.secondary)
                    if editable { Button("Wybierz zdjęcie") { picker = .format(active) }.buttonStyle(.borderedProminent) }
                }
                .frame(maxWidth: .infinity).padding(40)
            }
            Divider()
            HStack {
                Text("Opis posta").font(.headline)
                Spacer()
                Text("\(draft.caption.count)/2200").font(.caption).foregroundStyle(draft.caption.count > 1980 ? Color.orange : Color.secondary)
            }
            TextEditor(text: $draft.caption)
                .font(.body).frame(height: 150).scrollContentBackground(.hidden)
                .padding(6).background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                .disabled(!editable)
            if canvas?.isGrid == true {
                Text("Opis z hashtagami trafia do kafelka 1 (lewy górny, publikowany na końcu); pozostałe kafelki dostają same hashtagi.")
                    .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            let count = socialHashtags(draft.hashtags).count
            Text("Hashtagi (\(count)/30)").font(.caption).foregroundStyle(count > 30 ? Color.red : Color.secondary)
            TextField("#mavinci #eventy #gala", text: $draft.hashtags).textFieldStyle(.roundedBorder).disabled(!editable)
            if editable {
                SocialAssistantPanel(store: store, detail: detail, draft: assistantDraft, onUse: { suggestion, withGraphic in
                    draft.caption = suggestion.caption
                    if !suggestion.hashtags.isEmpty { draft.hashtags = suggestion.hashtags.joined(separator: " ") }
                    if withGraphic {
                        if !suggestion.headline.isEmpty { draft.headline = suggestion.headline }
                        if !suggestion.subline.isEmpty { draft.subline = suggestion.subline }
                    }
                }, onHashtags: { tags in draft.hashtags = tags.joined(separator: " ") })
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    // MARK: Kolaż (układ z kilkoma zdjęciami)
    private func collageOn(_ detail: SocialPostDetail, _ variant: SocialVariantDraft) -> Bool {
        (layoutDefinition(detail)?.slots ?? 1) > 1 && variant.enabled && variant.asset != nil
    }

    private func selectedCollageSlot(_ detail: SocialPostDetail, _ variant: SocialVariantDraft) -> Int? {
        guard collageOn(detail, variant), let slotEdit, slotEdit < (layoutDefinition(detail)?.slots ?? 1),
              draft.slots.contains(where: { $0.slot == slotEdit }) else { return nil }
        return slotEdit
    }

    private func setSlotCrop(_ slot: Int, _ crop: SocialCrop?) {
        guard let index = draft.slots.firstIndex(where: { $0.slot == slot }) else { return }
        draft.slots[index].crops[active] = crop
        draft.slots[index].touched.insert(active)
    }

    /// Miniatury miejsc: zdjęcie 1 (zdjęcie formatu) i kolejne zdjęcia kolażu (kliknięcie — kadr, puste — wybór zdjęcia).
    private func collageStrip(_ detail: SocialPostDetail, _ variant: SocialVariantDraft, editable: Bool) -> some View {
        let count = layoutDefinition(detail)?.slots ?? 1
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("Kolaż").font(.callout.weight(.semibold))
                Text("\(count) zdjęcia w układzie · kadr każdego zdjęcia ustawiasz osobno w każdym formacie, w proporcjach jego miejsca.")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 8) {
                slideThumb(url: variant.asset?.thumbnailUrl, label: "1", selected: slotEdit == nil) { slotEdit = nil; slideIndex = nil }
                ForEach(1..<max(2, count), id: \.self) { slot in
                    if let item = draft.slots.first(where: { $0.slot == slot }) {
                        slideThumb(url: item.asset.thumbnailUrl, label: "\(slot + 1)", selected: slotEdit == slot) { slotEdit = slot; slideIndex = nil }
                    } else {
                        Button { picker = .collage(slot) } label: {
                            VStack(spacing: 2) { Image(systemName: "plus"); Text("Zdjęcie \(slot + 1)").font(.caption2) }
                                .frame(width: 56, height: 64)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.orange.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4])))
                        }
                        .buttonStyle(.plain).disabled(!editable).help("Wybierz zdjęcie \(slot + 1) kolażu")
                    }
                }
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.1)))
    }

    @ViewBuilder private func slotEditor(_ detail: SocialPostDetail, slot: Int, editable: Bool) -> some View {
        if let item = draft.slots.first(where: { $0.slot == slot }), let layout = layoutDefinition(detail),
           let width = item.asset.width, let height = item.asset.height, let workURL = item.asset.workUrl,
           let crop = layoutCrop(item.asset, item.crops[active], active, slot: slot, layout: layout) {
            let aspect = layout.slotAspect(slot, active)
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 8) {
                    SocialCropEditor(imageURL: workURL, imageWidth: width, imageHeight: height, format: active, crop: crop,
                                     guides: nil, aspect: aspect, disabled: !editable) { next in setSlotCrop(slot, next) }
                    if editable {
                        HStack {
                            Button { setSlotCrop(slot, crop.zoomed(0.92, width: width, height: height, aspect: aspect)) } label: { Image(systemName: "plus.magnifyingglass") }.help("Przybliż")
                            Button { setSlotCrop(slot, crop.zoomed(1.08, width: width, height: height, aspect: aspect)) } label: { Image(systemName: "minus.magnifyingglass") }.help("Oddal")
                            Button { setSlotCrop(slot, nil) } label: { Label("Propozycja", systemImage: "sparkles") }
                            Button { picker = .collage(slot) } label: { Label("Inne zdjęcie", systemImage: "photo") }
                            Button(role: .destructive) { draft.slots.removeAll { $0.slot == slot }; slotEdit = nil } label: { Label("Usuń z kolażu", systemImage: "trash") }
                        }
                        Text("Kadr ustawiasz osobno w każdym formacie — w proporcjach miejsca tego zdjęcia w układzie.")
                            .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                if layout.canvas == nil {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Zdjęcie \(slot + 1) kolażu — \(active.label)").font(.caption).foregroundStyle(.secondary)
                        SocialGraphicView(source: graphic(detail, active), width: 240, height: 240 / active.aspect)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .frame(width: 240)
                }
            }
            if let canvas = layout.canvas { canvasBox(detail, canvas) }
        } else {
            Text("Zdjęcie nie ma jeszcze wersji roboczej.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(40)
        }
    }

    // MARK: Karuzela
    /// Karuzela w aktywnym formacie: format feedu (4:5, 1:1, 1,91:1) z okładką.
    private func carouselOn(_ variant: SocialVariantDraft) -> Bool {
        socialSlideFormats.contains(active) && variant.enabled && variant.asset != nil && detail.flatMap { canvasOf($0) } == nil
    }

    private func selectedSlide(_ variant: SocialVariantDraft) -> Int? {
        guard carouselOn(variant), let slideIndex, draft.slides.indices.contains(slideIndex) else { return nil }
        return slideIndex
    }

    private func moveSlide(_ from: Int, to: Int) {
        guard from != to, draft.slides.indices.contains(from), draft.slides.indices.contains(to) else { return }
        let moved = draft.slides.remove(at: from)
        draft.slides.insert(moved, at: to)
        slideIndex = to
    }

    private func setSlideCrop(_ index: Int, _ crop: SocialCrop?) {
        guard draft.slides.indices.contains(index) else { return }
        if let crop { draft.slides[index].crops[active] = crop } else { draft.slides[index].crops[active] = nil }
        draft.slides[index].touched.insert(active)
    }

    /// Miniatury: okładka i kolejne zdjęcia (kliknięcie — edycja kadru, przeciąganie — kolejność), „Dodaj zdjęcia”.
    private func carouselStrip(_ variant: SocialVariantDraft, editable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("Karuzela").font(.callout.weight(.semibold))
                Text("\(1 + draft.slides.count)/\(socialSlidesLimit + 1) zdjęć · Instagram — przesuwane zdjęcia, Facebook i LinkedIn — post z kilkoma zdjęciami, relacja — tylko okładka. Kolejne zdjęcia: ten sam styl, bez tekstów.")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                Spacer(minLength: 8)
                if editable && draft.slides.count < socialSlidesLimit {
                    Button { picker = .slideAdd } label: { Label("Dodaj zdjęcia", systemImage: "plus") }
                }
            }
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    slideThumb(url: variant.asset?.thumbnailUrl, label: "1 · okładka", selected: slideIndex == nil) { slideIndex = nil }
                    ForEach(Array(draft.slides.enumerated()), id: \.offset) { item in
                        slideThumb(url: item.element.asset.thumbnailUrl, label: "\(item.offset + 2)", selected: slideIndex == item.offset) { slideIndex = item.offset }
                            .draggable("mavinci-social-slide:\(item.offset)")
                            .dropDestination(for: String.self) { values, _ in
                                guard editable, let value = values.first, value.hasPrefix("mavinci-social-slide:"),
                                      let from = Int(value.dropFirst("mavinci-social-slide:".count)) else { return false }
                                moveSlide(from, to: item.offset)
                                return true
                            }
                    }
                }
                .padding(.bottom, 4)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.12)))
    }

    private func slideThumb(url: String?, label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            SocialImageView(url: url)
                .frame(width: 56, height: 68).clipped()
                .overlay(alignment: .bottom) {
                    Text(label).font(.system(size: 9, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 1)
                        .background(Color.black.opacity(0.6)).foregroundStyle(.white)
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? theme.accent : Color.clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
    }

    /// Edytor kadru zdjęcia karuzeli w aktywnym formacie i jego grafika (z serwera albo na żywo — warstwa bez tekstów).
    @ViewBuilder private func slideEditor(_ detail: SocialPostDetail, index: Int, editable: Bool) -> some View {
        let item = draft.slides[index]
        if let width = item.asset.width, let height = item.asset.height, let workURL = item.asset.workUrl {
            let crop = item.crops[active] ?? item.asset.proposal(active) ?? SocialCrop.center(width: width, height: height, format: active)
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 8) {
                    SocialCropEditor(imageURL: workURL, imageWidth: width, imageHeight: height, format: active, crop: crop,
                                     guides: detail.spec?.guides(draft.style, active), disabled: !editable) { next in setSlideCrop(index, next) }
                    if editable {
                        HStack {
                            Button { setSlideCrop(index, crop.zoomed(0.92, width: width, height: height, format: active)) } label: { Image(systemName: "plus.magnifyingglass") }.help("Przybliż")
                            Button { setSlideCrop(index, crop.zoomed(1.08, width: width, height: height, format: active)) } label: { Image(systemName: "minus.magnifyingglass") }.help("Oddal")
                            Button { setSlideCrop(index, nil) } label: { Label("Propozycja", systemImage: "sparkles") }
                            Button { moveSlide(index, to: index - 1) } label: { Image(systemName: "chevron.left") }.disabled(index == 0).help("Wcześniej")
                            Button { moveSlide(index, to: index + 1) } label: { Image(systemName: "chevron.right") }.disabled(index >= draft.slides.count - 1).help("Dalej")
                            Button { picker = .slide(index) } label: { Label("Inne zdjęcie", systemImage: "photo") }
                            Button(role: .destructive) { draft.slides.remove(at: index); slideIndex = nil } label: { Label("Usuń z karuzeli", systemImage: "trash") }
                        }
                        Text("Kadr ustawiasz osobno w każdym formacie feedu (4:5, 1:1, 1,91:1). Przeciągnij miniaturę, żeby zmienić kolejność.")
                            .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Zdjęcie \(index + 2) karuzeli — \(active.label)").font(.caption).foregroundStyle(.secondary)
                    SocialGraphicView(source: slideGraphic(detail, index, active), width: 240, height: 240 / active.aspect)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .frame(width: 240)
            }
        } else {
            Text("Zdjęcie nie ma jeszcze wersji roboczej.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(40)
        }
    }

    /// Grafika zdjęcia karuzeli: plik z serwera (bez zmian) albo podgląd na żywo — zdjęcie w kadrze i warstwa stylu bez tekstów.
    private func slideGraphic(_ detail: SocialPostDetail, _ index: Int, _ format: SocialFormat) -> SocialGraphicSource? {
        guard draft.slides.indices.contains(index) else { return nil }
        let item = draft.slides[index]
        let saved = detail.slides?.first { $0.position == index + 1 }
        let savedFormat = saved?.format(format)
        if !dirty, saved?.assetId == item.asset.id, savedFormat?.upToDate == true, let url = savedFormat?.renderedUrl { return .rendered(url) }
        guard let width = item.asset.width, let height = item.asset.height, let work = item.asset.workUrl else {
            if let url = savedFormat?.renderedUrl { return SocialGraphicSource.rendered(url) }
            return nil
        }
        let crop = item.crops[format] ?? item.asset.proposal(format) ?? SocialCrop.center(width: width, height: height, format: format)
        return SocialGraphicSource.live(workURL: work, crop: crop, overlay: store.overlays[slideOverlayKey(detail, format)], pending: detail.spec?.ready != false)
    }

    private func setCrop(_ crop: SocialCrop) {
        var item = draft.variant(active)
        item.crop = crop
        item.touched = true
        draft.variants[active] = item
    }

    private func zoom(_ factor: Double, width: Double, height: Double, crop: SocialCrop, aspect: Double? = nil) {
        if let aspect {
            setCrop(crop.zoomed(factor, width: width, height: height, aspect: aspect))
        } else {
            setCrop(crop.zoomed(factor, width: width, height: height, format: active))
        }
    }

    /// Grafika aktywnego formatu: z serwera (ta sama co w CRM i telefonie) albo podgląd na żywo przy zmianach.
    /// Cała duża grafika (podgląd na żywo: zdjęcia pod warstwą z serwera) z liniami cięcia: styki kafelków, pasy obcinane
    /// w siatce profilu, numery kafelków i kolejność publikacji siatki.
    private func canvasBox(_ detail: SocialPostDetail, _ canvas: SocialLayoutCanvas) -> some View {
        let size = canvas.size
        let crossings = layoutDefinition(detail).map { socialCanvasCrossings($0) } ?? []
        return VStack(alignment: .leading, spacing: 6) {
            Text("Cała grafika — podgląd na żywo (ten sam szablon co render); serwer tnie ją na kafelki po zapisie").font(.caption).foregroundStyle(.secondary)
            GeometryReader { geometry in
                let width: Double = max(240, Double(geometry.size.width))
                let height: Double = width * size.height / size.width
                let scale: Double = width / size.width
                ZStack(alignment: .topLeading) {
                    SocialGraphicView(source: graphic(detail, .portrait), width: width, height: height)
                    ForEach(Array(canvas.hiddenStrips.enumerated()), id: \.offset) { item in
                        Rectangle().fill(Color.black.opacity(0.45)).frame(width: item.element.w * scale, height: height).offset(x: item.element.x * scale)
                    }
                    ForEach(canvas.seamsX, id: \.self) { x in
                        Rectangle().fill(Color.white.opacity(0.7)).frame(width: 1, height: height).offset(x: x * scale)
                    }
                    ForEach(canvas.seamsY, id: \.self) { y in
                        Rectangle().fill(Color.white.opacity(0.7)).frame(width: width, height: 1).offset(y: y * scale)
                    }
                    ForEach(canvas.tiles, id: \.position) { tile in
                        Text(canvas.isGrid ? "\(tile.position) · publikacja \(canvas.tileCount - tile.position + 1)." : "\(tile.position)")
                            .font(.caption2).padding(.horizontal, 4).padding(.vertical, 1)
                            .background(RoundedRectangle(cornerRadius: 3).fill(Color.black.opacity(0.6))).foregroundStyle(.white)
                            .offset(x: tile.visible.minX * scale + 4, y: tile.visible.minY * scale + 4)
                    }
                }
                .frame(width: width, height: height, alignment: .topLeading)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .aspectRatio(size.width / size.height, contentMode: .fit)
            Text(canvas.isGrid
                 ? "Linie — styki kafelków w siatce profilu; przyciemnione pasy siatka obcina (kafelki zachodzą na siebie, więc w profilu łączą się bez przesunięć). Logo i teksty trzymaj w obrębie jednego kafelka."
                 : "Linie — granice slajdów karuzeli (na Instagramie przesuwane bez przerw; na Facebooku i LinkedIn — post z kilkoma zdjęciami).")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !crossings.isEmpty {
                Text("Część logo albo tekstów wypada na styku kafelków — w feedzie będzie przecięta.").font(.caption2).foregroundStyle(.orange)
            }
            if !dirty && detail.variants.contains(where: { $0.assetId != nil && !$0.upToDate }) && detail.access.create && detail.post.status.editable {
                Button { Task { await store.runDetail("Generuję kafelki", "renderPost", ["id": .string(detail.post.id)], success: "Kafelki są aktualne") } } label: { Label("Odśwież kafelki", systemImage: "arrow.clockwise") }
            }
        }
    }

    private func renderedBox(_ detail: SocialPostDetail) -> some View {
        let saved = detail.variant(active)
        let current = saved?.upToDate == true && !liveNeeded(detail)
        let title: String = current ? "Grafika z serwera" : dirty ? "Podgląd na żywo — zapisz, żeby wygenerować grafikę" : "Grafika nieaktualna — podgląd na żywo"
        return VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(current ? Color.secondary : Color.orange).fixedSize(horizontal: false, vertical: true)
            SocialGraphicView(source: graphic(detail, active), width: 240, height: 240 / active.aspect)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            if let at = saved?.renderedAt, current { Text("Wygenerowano \(SocialDates.dateTime(at))").font(.caption2).foregroundStyle(.secondary) }
            if !dirty && detail.variants.contains(where: { $0.assetId != nil && !$0.upToDate }) && detail.access.create && detail.post.status.editable {
                Button { Task { await store.runDetail("Generuję grafiki", "renderPost", ["id": .string(detail.post.id)], success: "Grafiki są aktualne") } } label: { Label("Odśwież grafiki", systemImage: "arrow.clockwise") }
            }
        }
        .frame(width: 240)
    }

    /// Niezapisane wartości kreatora dla asystenta AI (zdjęcie aktywnego formatu albo pierwsze w poście).
    private var assistantDraft: SocialAssistantDraft {
        SocialAssistantDraft(
            caption: draft.caption, hashtags: draft.hashtags, headline: draft.headline, subline: draft.subline, eventID: draft.eventID,
            assetID: draft.variant(active).asset?.id ?? SocialFormat.allCases.compactMap { draft.variant($0).asset?.id }.first,
            channels: SocialChannel.allCases.filter { draft.channels.contains($0) })
    }

    /// Zdjęcia karuzeli w formacie kanału (relacja i brak formatu feedu — bez karuzeli).
    private func slideGraphics(_ detail: SocialPostDetail, _ format: SocialFormat?) -> [SocialGraphicSource?] {
        guard let format, socialSlideFormats.contains(format) else { return [] }
        return draft.slides.indices.map { slideGraphic(detail, $0, format) }
    }

    // MARK: Prawa kolumna — podglądy
    private func previewColumn(_ detail: SocialPostDetail) -> some View {
        let formats = draft.formatsWithPhoto
        let live = liveNeeded(detail)
        let feed = SocialChannel.instagramFeed.format(in: formats) ?? formats.first
        let facebook = SocialChannel.facebookFeed.format(in: formats) ?? formats.first
        let linkedin = SocialChannel.linkedinPage.format(in: formats) ?? formats.first
        let story = SocialChannel.instagramStory.format(in: formats)
        let account = detail.company.name.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "." || $0 == "_" }
        let text = socialPublicationText(draft.caption, socialHashtags(draft.hashtags))
        let logo = detail.template?.logoUrl
        let canvas = canvasOf(detail)
        // Duża grafika: siatka — profil i feed (osobne posty), panorama — karuzela na Instagramie, Facebooku i LinkedIn.
        let tabs: [SocialPreviewTab] = canvas.map { shape -> [SocialPreviewTab] in shape.isGrid ? [.grid, .feed] : [.feed, .facebook, .linkedin] } ?? SocialPreviewTab.allCases
        let current = tabs.contains(preview) ? preview : tabs[0]
        return VStack(alignment: .leading, spacing: 10) {
            // Zakładki podglądów zawijane jak w CRM (pięć platform nie mieści się w kontrolce segmentowej).
            WrapLayout(spacing: 4) {
                ForEach(tabs) { tab in
                    Button { preview = tab } label: {
                        Text(tab.label).font(.caption)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(RoundedRectangle(cornerRadius: 7).fill(current == tab ? theme.accent.opacity(0.18) : Color.clear))
                            .foregroundStyle(current == tab ? theme.accent : Color.secondary)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if let canvas {
                let tiles = tileGraphics(detail)
                let first: SocialGraphicSource? = tiles.first ?? nil
                let rest = Array(tiles.dropFirst())
                switch current {
                case .grid:
                    SocialCanvasGridPreview(tiles: tiles, grid: detail.grid)
                case .feed:
                    SocialFeedPreview(graphic: first, format: .portrait, account: account, logo: logo, caption: text, slides: canvas.isGrid ? [] : rest)
                    if canvas.isGrid {
                        Text("W feedzie kafelki pojawiają się jako osobne posty — kafelek 1 (najnowszy) z opisem, pozostałe z hashtagami.")
                            .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                case .facebook:
                    SocialFacebookPreview(graphic: first, format: .portrait, account: detail.company.name, logo: logo, caption: text, slides: rest)
                case .linkedin:
                    SocialLinkedInPreview(graphic: first, format: .portrait, account: detail.meta?.linkedin?.organizationName ?? detail.company.name,
                                          logo: logo, caption: text, slides: rest)
                case .story:
                    EmptyView()
                }
            } else {
            switch current {
            case .feed:
                SocialFeedPreview(graphic: feed.flatMap { graphic(detail, $0) }, format: feed ?? .portrait, account: account, logo: logo, caption: text,
                                  slides: slideGraphics(detail, feed))
            case .grid:
                SocialGridPreview(graphic: feed.flatMap { graphic(detail, $0) }, format: feed ?? .portrait, grid: detail.grid)
            case .story:
                if let story { SocialStoryPreview(graphic: graphic(detail, story), account: account, logo: logo) }
                else { Text("Włącz format „Relacja 9:16” i kanał „Instagram — relacja”, żeby zobaczyć relację.").font(.callout).foregroundStyle(.secondary).padding(20) }
            case .facebook:
                SocialFacebookPreview(graphic: facebook.flatMap { graphic(detail, $0) }, format: facebook ?? .portrait, account: detail.company.name, logo: logo, caption: text,
                                      slides: slideGraphics(detail, facebook))
            case .linkedin:
                SocialLinkedInPreview(graphic: linkedin.flatMap { graphic(detail, $0) }, format: linkedin ?? .portrait,
                                      account: detail.meta?.linkedin?.organizationName ?? detail.company.name, logo: logo, caption: text,
                                      slides: slideGraphics(detail, linkedin))
            }
            }
            Text(live
                 ? "Podgląd na żywo: zdjęcie w bieżącym kadrze z warstwą szablonu z serwera — po zapisie serwer wygeneruje taką samą grafikę (wspólną dla CRM, Maca i telefonu)."
                 : "Podglądy pokazują grafiki wygenerowane na serwerze — identyczne w CRM, na Macu i w telefonie.")
                .font(.caption2).foregroundStyle(.secondary)
            if detail.post.status == .published, let link = detail.post.publishedUrl, let url = URL(string: link) {
                Link(destination: url) { Label("Opublikowany post", systemImage: "link") }
            }
            if (detail.publications ?? []).contains(where: { $0.status == "published" && $0.channel != .instagramStory }) || (detail.comments?.total ?? 0) > 0 {
                Divider()
                SocialCommentsView(store: store, postID: detail.post.id).id("social-comments")
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    // MARK: Publikacja (Meta, LinkedIn)
    /// Stan publikacji: termin i osoba planująca, błąd, wyniki kanałów (link albo błąd, po publikacji — statystyki z Meta)
    /// i braki kont. LinkedIn bez połączonej strony — publikacja ręczna (nie błąd).
    @ViewBuilder private func metaCard(_ detail: SocialPostDetail) -> some View {
        let publications = detail.publications ?? []
        let status = detail.post.status
        let anyPublished = publications.contains { $0.status == "published" }
        if detail.meta != nil || !publications.isEmpty || [.scheduled, .publishing, .failed].contains(status) {
            card {
                HStack {
                    Label("Publikacja", systemImage: "calendar.badge.clock").font(.headline)
                    Spacer()
                    if anyPublished {
                        Button { Task { await store.refreshPostMetrics(detail) } } label: { Label("Wyniki", systemImage: "arrow.clockwise") }
                            .buttonStyle(.link).font(.caption).help("Pobierz aktualne wyniki z Meta")
                    }
                }
                if status == .scheduled {
                    Text("Zaplanowano na \(SocialDates.dateTime(detail.post.scheduledAt))\(detail.post.scheduledByName.map { " — \($0)" } ?? ""). Post opublikuje się automatycznie.")
                        .font(.caption).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.blue.opacity(0.12)))
                }
                if status == .publishing {
                    HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Trwa publikacja…").font(.caption) }
                }
                if status == .failed, let error = detail.post.publishError {
                    Text(error).font(.caption).foregroundStyle(.red).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.red.opacity(0.1)))
                }
                ForEach(detail.post.channels, id: \.self) { channel in
                    // Siatka profilu: osobny post Instagram na kafelek — stan zbiorczy i lista kafelków (jak w CRM).
                    let tileTotal = detail.canvas?.mode == "grid" ? (detail.canvas?.tiles ?? 0) : 0
                    let tileRows: [SocialPublication] = tileTotal > 0
                        ? publications.filter({ $0.channel == channel && ($0.tile ?? 0) > 0 }).sorted(by: { ($0.tile ?? 0) < ($1.tile ?? 0) }) : []
                    let tilesPublished = tileRows.filter({ $0.status == "published" }).count
                    let publication: SocialPublication? = tileTotal > 0 ? gridPublication(tileRows, total: tileTotal) : publications.first(where: { $0.channel == channel })
                    let problem = detail.meta?.channel(channel)?.problem
                    let manual = detail.meta?.manual(channel) ?? (channel == .linkedinPage)
                    let symbol: String = publication?.status == "published" ? "checkmark.circle.fill"
                        : publication?.status == "failed" ? "xmark.circle.fill" : manual ? "circle.dashed" : problem != nil ? "exclamationmark.triangle.fill" : "circle"
                    let tint: Color = publication?.status == "published" ? Color.green : publication?.status == "failed" ? Color.red
                        : manual ? Color.secondary : problem != nil ? Color.orange : Color.secondary
                    let stateLabel: String = publication?.statusLabel ?? (manual ? "publikacja ręczna" : problem != nil ? "niegotowy" : "gotowy")
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Image(systemName: symbol).foregroundStyle(tint)
                            Text(channel.label).font(.caption.weight(.semibold))
                            Text(stateLabel + (tileTotal > 0 ? " · \(tilesPublished)/\(tileTotal) kafelków" : "")).font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            if tileTotal == 0, let link = publication?.permalink, let url = URL(string: link) {
                                Link(destination: url) { Label("Otwórz", systemImage: "arrow.up.right.square") }.font(.caption2)
                            }
                        }
                        if !tileRows.isEmpty {
                            WrapLayout(spacing: 4) {
                                ForEach(tileRows, id: \.tile) { item in
                                    if let link = item.permalink, let url = URL(string: link) {
                                        Link(destination: url) { Text("Kafelek \(item.tile ?? 0)").font(.caption2) }
                                            .padding(.horizontal, 5).padding(.vertical, 2)
                                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.green.opacity(0.4)))
                                    } else {
                                        Text("Kafelek \(item.tile ?? 0): \(item.statusLabel)").font(.caption2)
                                            .foregroundStyle(item.status == "failed" ? Color.red : Color.secondary)
                                            .padding(.horizontal, 5).padding(.vertical, 2)
                                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(item.status == "failed" ? Color.red.opacity(0.4) : Color.primary.opacity(0.15)))
                                            .help(item.error ?? "")
                                    }
                                }
                            }
                        }
                        if let error = publication?.error, publication?.status != "published" { Text(error).font(.caption2).foregroundStyle(.red) }
                        if publication == nil, let problem { Text(problem).font(.caption2).foregroundStyle(manual ? Color.secondary : Color.orange) }
                        if let publication, publication.status == "published" {
                            if channel == .linkedinPage {
                                Text("Wyniki postów LinkedIn nie są jeszcze pobierane do CRM.").font(.caption2).foregroundStyle(.secondary)
                            } else {
                                publicationMetrics(publication)
                            }
                        }
                    }
                }
                if let meta = detail.meta, !meta.connected, detail.post.channels.contains(where: \.isMeta) {
                    Button { state.openCRM("/crm/settings/my-companies/\(detail.company.id)/marketing") } label: { Label("Połącz Meta w ustawieniach marketingu", systemImage: "link") }
                        .buttonStyle(.link).font(.caption)
                }
                if let meta = detail.meta, meta.linkedin?.connected != true, detail.post.channels.contains(.linkedinPage) {
                    Button { state.openCRM("/crm/settings/my-companies/\(detail.company.id)/marketing") } label: { Label("LinkedIn w ustawieniach marketingu", systemImage: "link") }
                        .buttonStyle(.link).font(.caption)
                }
            }
        }
    }

    /// Stan zbiorczy siatki profilu: pierwszy nieopublikowany kafelek (albo kafelek 1) ze statusem całej serii.
    private func gridPublication(_ rows: [SocialPublication], total: Int) -> SocialPublication? {
        guard var item = rows.first(where: { $0.status != "published" }) ?? rows.first else { return nil }
        let published = rows.filter { $0.status == "published" }.count
        item.status = published == total ? "published" : rows.contains { $0.status == "failed" } ? "failed"
            : rows.contains { $0.status == "sending" } ? "sending" : "pending"
        return item
    }

    /// Wyniki kanału z Meta (stan narastająco od publikacji).
    @ViewBuilder private func publicationMetrics(_ publication: SocialPublication) -> some View {
        let values = publication.metrics ?? SocialMetricValues()
        let available = values.available
        if available.isEmpty {
            Text(publication.metricsError ?? (publication.metricsSyncedAt == nil ? "Wyniki pojawią się w ciągu godziny od publikacji." : "Meta nie podała jeszcze wyników."))
                .font(.caption2).foregroundStyle(.secondary)
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 4)], alignment: .leading, spacing: 4) {
                ForEach(available) { metric in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(metric.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        Text(SocialNumbers.number(values[metric])).font(.caption.monospacedDigit())
                    }
                    .padding(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(0.05)))
                    .help(metric.hint)
                }
            }
            Text(metricsInfo(publication)).font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func metricsInfo(_ publication: SocialPublication) -> String {
        var parts: [String] = []
        if let rate = publication.rate { parts.append("Zaangażowanie \(SocialNumbers.percent(rate))") }
        if let synced = publication.metricsSyncedAt { parts.append("pobrano \(SocialDates.dateTime(synced))") }
        if let error = publication.metricsError { parts.append(error) }
        return parts.joined(separator: " · ")
    }

    private func defaultScheduleDate(_ detail: SocialPostDetail) -> Date {
        if let saved = detail.post.scheduledAt.flatMap(SocialDates.parse), saved > Date().addingTimeInterval(300) { return saved }
        var parts = Calendar.current.dateComponents([.year, .month, .day], from: Date().addingTimeInterval(86_400))
        parts.hour = 18
        return Calendar.current.date(from: parts) ?? Date().addingTimeInterval(86_400)
    }

    private func scheduleSheet(_ detail: SocialPostDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(detail.post.status == .scheduled ? "Zmień termin publikacji" : "Zaplanuj publikację").font(.title3.weight(.semibold))
            Text("W tym terminie serwer opublikuje post: " + detail.post.channels.map(\.label).joined(separator: ", ") + ". Błąd publikacji zobaczysz na karcie posta (autor i osoba planująca dostaną powiadomienie).")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            DatePicker("Termin", selection: $scheduleDate, in: Date().addingTimeInterval(60)..., displayedComponents: [.date, .hourAndMinute])
            let problems = detail.problems.meta ?? []
            if !problems.isEmpty {
                VStack(alignment: .leading, spacing: 2) { ForEach(problems, id: \.self) { Text("• " + $0).font(.caption) } }
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.1)))
            }
            HStack {
                Spacer()
                Button("Anuluj") { scheduleShown = false }.keyboardShortcut(.cancelAction)
                Button("Zaplanuj") {
                    scheduleShown = false
                    let date = scheduleDate
                    Task { await store.schedulePublication(detail, at: date); loadedRevision = nil; syncDraft() }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20).frame(width: 520)
    }

    // MARK: Akcje
    private func payload(_ detail: SocialPostDetail) -> [String: JSONValue] {
        let variants: [JSONValue] = SocialFormat.allCases.filter { draft.variant($0).enabled }.map { format in
            let item = draft.variant(format)
            let crop = item.touched ? item.crop : detail.variant(format)?.crop
            return .object([
                "format": .string(format.rawValue),
                "assetId": item.asset.map { JSONValue.string($0.id) } ?? .null,
                "crop": crop?.json ?? .null,
                "headline": .string(draft.headline),
                "subline": .string(draft.subline),
                "style": .string(draft.style.rawValue),
                "kicker": .string(draft.kicker),
            ])
        }
        return [
            "id": .string(detail.post.id),
            "updatedAt": .string(detail.post.updatedAt),
            "title": .string(draft.title),
            "channels": .array(SocialChannel.allCases.filter { draft.channels.contains($0) }.map { JSONValue.string($0.rawValue) }),
            "scheduledAt": draft.hasDate ? .string(SocialDates.iso(draft.scheduledAt)) : .null,
            "caption": .string(draft.caption),
            "hashtags": .array(socialHashtags(draft.hashtags).map(JSONValue.string)),
            "templateId": draft.templateID.map(JSONValue.string) ?? .null,
            "eventId": draft.eventID.map(JSONValue.string) ?? .null,
            "variants": .array(variants),
            // Karuzela: kolejność = pozycje; kadr tylko w zmienionych formatach (`null` — propozycja), pozostałe — zapisane kadry.
            "slides": .array(draft.slides.map { item in
                var crops: [String: JSONValue] = [:]
                for format in socialSlideFormats where item.touched.contains(format) { crops[format.rawValue] = item.crops[format]?.json ?? .null }
                return JSONValue.object(["assetId": .string(item.asset.id), "crops": .object(crops)])
            }),
            // Układ (ten sam co w poście — serwer zostawia zapisaną migawkę) i zdjęcia kolażu z kadrami zmienionymi w kreatorze.
            "layout": draft.layout?.json(refresh: draft.layoutRefresh) ?? .null,
            "slots": .array(draft.slots.map { item in
                var crops: [String: JSONValue] = [:]
                for format in SocialFormat.allCases where item.touched.contains(format) { crops[format.rawValue] = item.crops[format]?.json ?? .null }
                return JSONValue.object(["slot": .number(Double(item.slot)), "assetId": .string(item.asset.id), "crops": .object(crops)])
            }),
        ]
    }

    @discardableResult private func save(_ detail: SocialPostDetail, quiet: Bool = false) async -> SocialPostDetail? {
        guard SocialFormat.allCases.contains(where: { draft.variant($0).enabled }) else { state.notice = "Włącz co najmniej jeden format grafiki."; return nil }
        guard !draft.channels.isEmpty else { state.notice = "Wybierz co najmniej jeden kanał publikacji."; return nil }
        let result = await store.runDetail("Zapisuję post i generuję grafiki", "savePost", payload(detail), success: quiet ? nil : "Zapisano post i wygenerowano grafiki")
        if result != nil { loadedRevision = nil; syncDraft() }
        return result
    }

    private func act(_ detail: SocialPostDetail, _ action: SocialPostAction, note: String? = nil, url: String? = nil) async {
        var current = detail
        if dirty && detail.access.create && detail.post.status.editable {
            guard let saved = await save(detail, quiet: true) else { return }
            current = saved
        }
        await store.transition(current, action, note: note, url: url)
        loadedRevision = nil
        syncDraft()
    }

    private func choose(_ asset: SocialAsset, for target: SocialPickerTarget) {
        switch target {
        case .all:
            for format in SocialFormat.allCases where draft.variant(format).enabled {
                draft.variants[format] = SocialVariantDraft(enabled: true, asset: asset, crop: nil, touched: true)
            }
        case .format(let format):
            draft.variants[format] = SocialVariantDraft(enabled: true, asset: asset, crop: nil, touched: true)
        case .slideAdd:
            guard draft.slides.count < socialSlidesLimit else { picker = nil; return }
            draft.slides.append(SocialSlideDraft(asset: asset))
            state.succeed("Dodano zdjęcie do karuzeli (\(1 + draft.slides.count)/\(socialSlidesLimit + 1)) — wybierz kolejne albo zamknij okno")
            if draft.slides.count >= socialSlidesLimit { picker = nil }
            return
        case .slide(let index):
            if draft.slides.indices.contains(index) { draft.slides[index] = SocialSlideDraft(asset: asset, crops: [:], touched: Set(socialSlideFormats)) }
        case .collage(let slot):
            draft.slots.removeAll { $0.slot == slot }
            draft.slots.append(SocialSlotDraft(slot: slot, asset: asset, crops: [:], touched: Set(SocialFormat.allCases)))
            draft.slots.sort { $0.slot < $1.slot }
            slotEdit = slot
            slideIndex = nil
        }
        if draft.eventID == nil, let eventID = asset.eventId { draft.eventID = eventID; draft.eventName = asset.eventName }
        picker = nil
    }

    private func pickerTitle(_ target: SocialPickerTarget) -> String {
        switch target {
        case .all: return "Zdjęcie dla wszystkich formatów"
        case .format(let format): return "Zdjęcie — \(format.label)"
        case .slideAdd: return "Dodaj zdjęcia do karuzeli (\(1 + draft.slides.count)/\(socialSlidesLimit + 1))"
        case .slide(let index): return "Zdjęcie \(index + 2) karuzeli"
        case .collage(let slot): return "Zdjęcie \(slot + 1) kolażu"
        }
    }

    private func requestChangesSheet(_ detail: SocialPostDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Do poprawy").font(.title3.weight(.semibold))
            TextField("Co poprawić? (autor dostanie powiadomienie)", text: $note, axis: .vertical).lineLimit(3...6).textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Anuluj") { noteShown = false }.keyboardShortcut(.cancelAction)
                Button("Odeślij do poprawy") { noteShown = false; let text = note; Task { await act(detail, .requestChanges, note: text) } }
                    .buttonStyle(.borderedProminent).disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20).frame(width: 480)
    }

    private func publishSheet(_ detail: SocialPostDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Oznacz jako opublikowany").font(.title3.weight(.semibold))
            Text("Użyj, gdy post opublikowano ręcznie (np. z paczki „Więcej” → „Pobierz paczkę”, bez połączenia z Meta lub LinkedIn). Wklej link do posta. Automatyczną publikację uruchamiają „Opublikuj teraz” i „Zaplanuj publikację”.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            TextField("https://www.instagram.com/p/… (opcjonalnie)", text: $publishURL).textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Anuluj") { publishShown = false }.keyboardShortcut(.cancelAction)
                Button("Oznacz jako opublikowany") { publishShown = false; let link = publishURL.trimmingCharacters(in: .whitespaces); Task { await act(detail, .publish, url: link) } }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20).frame(width: 520)
    }

    private func historySheet(_ detail: SocialPostDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text("Historia posta").font(.title3.weight(.semibold)); Spacer(); Button("Zamknij") { historyShown = false }.keyboardShortcut(.cancelAction) }
            List(Array(detail.history.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(item.label + (item.revision.map { " (wersja \($0))" } ?? ""))
                        Spacer()
                        Text(SocialDates.dateTime(item.createdAt)).font(.caption).foregroundStyle(.secondary)
                    }
                    if let actor = item.actorName { Text(actor).font(.caption).foregroundStyle(.secondary) }
                    if let note = item.note { Text(note).font(.caption) }
                }
            }
        }
        .padding(20).frame(width: 560, height: 480)
    }
}

// MARK: Natywny edytor kadru
struct SocialCropEditor: View {
    let imageURL: String
    let imageWidth: Double
    let imageHeight: Double
    let format: SocialFormat
    let crop: SocialCrop
    let guides: SocialGuides?
    /// Proporcje kadru innego niż format (miejsce zdjęcia w układzie, szerokość / wysokość).
    var aspect: Double? = nil
    let disabled: Bool
    let onChange: (SocialCrop) -> Void
    @State private var dragStart: SocialCrop?
    @State private var pinchStart: SocialCrop?

    var body: some View {
        GeometryReader { geometry in
            let scale = min(geometry.size.width / imageWidth, geometry.size.height / imageHeight)
            let size = CGSize(width: imageWidth * scale, height: imageHeight * scale)
            let rect = CGRect(x: crop.x * size.width, y: crop.y * size.height, width: crop.w * size.width, height: crop.h * size.height)
            ZStack(alignment: .topLeading) {
                SocialImageView(url: imageURL, contentMode: .fill).frame(width: size.width, height: size.height).clipped()
                Path { path in
                    path.addRect(CGRect(origin: .zero, size: size))
                    path.addRect(rect)
                }
                .fill(Color.black.opacity(0.62), style: FillStyle(eoFill: true))
                .allowsHitTesting(false)
                ZStack(alignment: .topLeading) {
                    Path { path in
                        for part in 1...2 {
                            let x = rect.width * Double(part) / 3
                            let y = rect.height * Double(part) / 3
                            path.move(to: CGPoint(x: x, y: 0)); path.addLine(to: CGPoint(x: x, y: rect.height))
                            path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: rect.width, y: y))
                        }
                    }
                    .stroke(Color.white.opacity(0.25), lineWidth: 1)
                    if let window = guides?.window {
                        // Passe-partout i kinowe pasy: zdjęcie widać tylko w jasnym polu.
                        let visible = CGRect(x: rect.width * window.x, y: rect.height * window.y, width: rect.width * window.w, height: rect.height * window.h)
                        Path { path in
                            path.addRect(CGRect(origin: .zero, size: rect.size))
                            path.addRect(visible)
                        }
                        .fill(Color(red: 0.06, green: 0.07, blue: 0.1).opacity(0.55), style: FillStyle(eoFill: true))
                        Rectangle().stroke(Color.white.opacity(0.4), lineWidth: 1)
                            .frame(width: visible.width, height: visible.height).offset(x: visible.minX, y: visible.minY)
                    }
                    if let guides {
                        if let top = guides.unsafeTop { Rectangle().fill(Color.red.opacity(0.22)).frame(width: rect.width * top.w, height: rect.height * top.h).offset(x: rect.width * top.x, y: rect.height * top.y) }
                        if let bottom = guides.unsafeBottom { Rectangle().fill(Color.red.opacity(0.22)).frame(width: rect.width * bottom.w, height: rect.height * bottom.h).offset(x: rect.width * bottom.x, y: rect.height * bottom.y) }
                        Rectangle().stroke(Color.white.opacity(0.8), style: StrokeStyle(lineWidth: 1, dash: [4]))
                            .frame(width: rect.width * guides.logo.w, height: rect.height * guides.logo.h).offset(x: rect.width * guides.logo.x, y: rect.height * guides.logo.y)
                        Rectangle().stroke(Color(red: 0.83, green: 0.73, blue: 0.45), style: StrokeStyle(lineWidth: 1, dash: [4]))
                            .frame(width: rect.width * guides.text.w, height: rect.height * guides.text.h).offset(x: rect.width * guides.text.x, y: rect.height * guides.text.y)
                    }
                    Rectangle().stroke(Color(red: 0.83, green: 0.73, blue: 0.45), lineWidth: 2)
                }
                .frame(width: rect.width, height: rect.height)
                .contentShape(Rectangle())
                .offset(x: rect.minX, y: rect.minY)
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            guard !disabled else { return }
                            let start = dragStart ?? crop
                            if dragStart == nil { dragStart = crop }
                            onChange(start.moved(dx: value.translation.width / size.width, dy: value.translation.height / size.height))
                        }
                        .onEnded { _ in dragStart = nil }
                )
                .simultaneousGesture(
                    MagnifyGesture()
                        .onChanged { value in
                            guard !disabled else { return }
                            let start = pinchStart ?? crop
                            if pinchStart == nil { pinchStart = crop }
                            let factor = 1 / max(0.2, value.magnification)
                            if let aspect {
                                onChange(start.zoomed(factor, width: imageWidth, height: imageHeight, aspect: aspect))
                            } else {
                                onChange(start.zoomed(factor, width: imageWidth, height: imageHeight, format: format))
                            }
                        }
                        .onEnded { _ in pinchStart = nil }
                )
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .frame(maxWidth: .infinity)
        }
        // Pole edytora w proporcjach zdjęcia, najwyżej 520 pkt wysokości (pionowe zdjęcia nie wypychają reszty kreatora).
        .aspectRatio(CGSize(width: imageWidth, height: imageHeight), contentMode: .fit)
        .frame(maxHeight: 520)
    }
}

// MARK: Natywne podglądy: grafika z serwera albo podgląd na żywo

/// Grafika posta w podglądach: plik z serwera albo podgląd na żywo — zdjęcie w bieżącym kadrze (położenie i skala jak
/// `#photo` w HTML grafiki) i przezroczysta warstwa szablonu z serwera (przyciemnienia, logo, teksty).
enum SocialGraphicSource {
    case rendered(String)
    case live(workURL: String, crop: SocialCrop, overlay: NSImage?, pending: Bool)
    /// Układ jako dane: zdjęcia w prostokątach miejsc (kolaż) pod warstwą układu z serwera (tło z otworami, logo, teksty).
    case layout(photos: [SocialLayoutPhotoSource], overlay: NSImage?, pending: Bool)
    /// Kafelek dużej grafiki (siatka profilu, panorama): wycinek podglądu całości (`canvas` i `viewport` w px).
    indirect case tile(SocialGraphicSource, canvas: CGSize, viewport: CGRect)
}

/// Zdjęcie w miejscu układu: wersja robocza (brak — miejsce jeszcze bez zdjęcia), kadr w proporcjach miejsca, prostokąt 0…1
/// i zaokrąglenie rogów (px dla szerokości 1080).
struct SocialLayoutPhotoSource {
    let workURL: String?
    let crop: SocialCrop
    let rect: SocialLayoutRect
    let radius: Double
}

struct SocialGraphicView: View {
    let source: SocialGraphicSource?
    let width: Double
    let height: Double

    var body: some View {
        switch source {
        case .live(let workURL, let crop, let overlay, let pending):
            let photoWidth = width / max(crop.w, 0.01)
            let photoHeight = height / max(crop.h, 0.01)
            ZStack(alignment: .topLeading) {
                SocialImageView(url: workURL, contentMode: .fill)
                    .frame(width: photoWidth, height: photoHeight)
                    .offset(x: -crop.x * photoWidth, y: -crop.y * photoHeight)
                if let overlay {
                    Image(nsImage: overlay).resizable().interpolation(.high).frame(width: width, height: height)
                } else if pending {
                    ProgressView().controlSize(.small).frame(width: width, height: height)
                }
            }
            .frame(width: width, height: height, alignment: .topLeading)
            .clipped()
        case .layout(let photos, let overlay, let pending):
            ZStack(alignment: .topLeading) {
                ForEach(Array(photos.enumerated()), id: \.offset) { item in
                    let photo = item.element
                    let slotWidth = photo.rect.w * width
                    let slotHeight = photo.rect.h * height
                    let photoWidth = slotWidth / max(photo.crop.w, 0.01)
                    let photoHeight = slotHeight / max(photo.crop.h, 0.01)
                    ZStack(alignment: .topLeading) {
                        if let work = photo.workURL {
                            SocialImageView(url: work, contentMode: .fill)
                                .frame(width: photoWidth, height: photoHeight)
                                .offset(x: -photo.crop.x * photoWidth, y: -photo.crop.y * photoHeight)
                        } else {
                            Color.primary.opacity(0.12)
                        }
                    }
                    .frame(width: slotWidth, height: slotHeight, alignment: .topLeading)
                    .clipShape(RoundedRectangle(cornerRadius: photo.radius * width / 1080))
                    .offset(x: photo.rect.x * width, y: photo.rect.y * height)
                }
                if let overlay {
                    Image(nsImage: overlay).resizable().interpolation(.high).frame(width: width, height: height)
                } else if pending {
                    ProgressView().controlSize(.small).frame(width: width, height: height)
                }
            }
            .frame(width: width, height: height, alignment: .topLeading)
            .clipped()
        case .tile(let whole, let canvas, let viewport):
            let scale = width / max(1, viewport.width)
            SocialGraphicView(source: whole, width: canvas.width * scale, height: canvas.height * scale)
                .offset(x: -viewport.minX * scale, y: -viewport.minY * scale)
                .frame(width: width, height: height, alignment: .topLeading)
                .clipped()
        case .rendered(let url):
            SocialImageView(url: url, contentMode: .fill).frame(width: width, height: height).clipped()
        case nil:
            SocialImageView(url: nil, contentMode: .fill).frame(width: width, height: height).clipped()
        }
    }
}

private struct SocialAvatar: View {
    let logo: String?
    var body: some View {
        ZStack {
            Circle().fill(Color(white: 0.15))
            if let logo { SocialImageView(url: logo, contentMode: .fit).padding(5) }
        }
        .frame(width: 30, height: 30)
        .overlay(Circle().stroke(Color.pink.opacity(0.7), lineWidth: 2))
    }
}

/// Karuzela w podglądzie: bieżące zdjęcie, strzałki, licznik i kropki (jak w aplikacji Instagram).
struct SocialCarouselView: View {
    let sources: [SocialGraphicSource?]
    let format: SocialFormat
    let width: Double
    var light = false
    @State private var index = 0
    var body: some View {
        let current = min(index, max(0, sources.count - 1))
        VStack(spacing: 4) {
            ZStack {
                SocialGraphicView(source: sources.indices.contains(current) ? sources[current] : nil, width: width, height: width / format.aspect)
                HStack {
                    if current > 0 { arrow("chevron.left") { index = current - 1 } }
                    Spacer()
                    if current < sources.count - 1 { arrow("chevron.right") { index = current + 1 } }
                }
                .padding(.horizontal, 8)
            }
            .overlay(alignment: .topTrailing) {
                Text("\(current + 1)/\(sources.count)").font(.caption2).padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Capsule().fill(Color.black.opacity(0.7))).foregroundStyle(.white).padding(8)
            }
            HStack(spacing: 4) {
                ForEach(sources.indices, id: \.self) { dot in
                    Circle().fill(dot == current ? Color.blue : (light ? Color.black.opacity(0.2) : Color.white.opacity(0.3))).frame(width: 6, height: 6)
                }
            }
            .padding(.bottom, 2)
        }
    }

    private func arrow(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.caption.weight(.bold)).foregroundStyle(.black)
                .frame(width: 26, height: 26).background(Circle().fill(Color.white.opacity(0.85)))
        }
        .buttonStyle(.plain)
    }
}

struct SocialFeedPreview: View {
    let graphic: SocialGraphicSource?
    let format: SocialFormat
    let account: String
    let logo: String?
    let caption: String
    /// Kolejne zdjęcia karuzeli (pusto — pojedyncze zdjęcie).
    var slides: [SocialGraphicSource?] = []
    var body: some View {
        let width: Double = 340
        VStack(alignment: .leading, spacing: 0) {
            HStack { SocialAvatar(logo: logo); Text(account).font(.callout.weight(.semibold)); Spacer(); Image(systemName: "ellipsis") }.padding(8)
            if slides.isEmpty {
                SocialGraphicView(source: graphic, width: width, height: width / format.aspect)
            } else {
                SocialCarouselView(sources: [graphic] + slides, format: format, width: width)
            }
            HStack(spacing: 14) { Image(systemName: "heart"); Image(systemName: "bubble.right"); Image(systemName: "paperplane"); Spacer(); Image(systemName: "bookmark") }
                .font(.title3).padding(8)
            (Text(account).bold() + Text(" ") + Text(caption.count > 125 ? String(caption.prefix(125)) + "… więcej" : caption))
                .font(.callout).padding(.horizontal, 8).padding(.bottom, 10).fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: width)
        .foregroundStyle(.white)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: .infinity)
    }
}

struct SocialGridPreview: View {
    let graphic: SocialGraphicSource?
    let format: SocialFormat
    let grid: [SocialGridItem]
    var body: some View {
        let cell: Double = 110
        let cellHeight = cell * 4 / 3
        let columns = Array(repeating: GridItem(.fixed(cell), spacing: 2), count: 3)
        VStack(alignment: .leading, spacing: 4) {
            LazyVGrid(columns: columns, spacing: 2) {
                ZStack(alignment: .topLeading) {
                    SocialGraphicView(source: graphic, width: cellHeight * format.aspect, height: cellHeight)
                        .frame(width: cell, height: cellHeight).clipped()
                    Text("TEN POST").font(.system(size: 8, weight: .bold)).padding(.horizontal, 3).background(Color(red: 0.83, green: 0.73, blue: 0.45)).foregroundStyle(.black).padding(3)
                }
                ForEach(grid.prefix(8)) { item in
                    SocialImageView(url: item.imageUrl, contentMode: .fill).frame(width: cell, height: cellHeight).clipped()
                }
            }
            Text("Siatka profilu przycina posty do 3:4 — środek grafiki pozostaje widoczny.").font(.caption2).foregroundStyle(.white.opacity(0.5))
        }
        .padding(4)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: .infinity)
    }
}

/// Siatka profilu z kafelkami dużej grafiki (1:1 z `CanvasGridPreview` w CRM): kafelki przycięte do 3:4 jak w profilu,
/// potem dotychczasowe posty marki.
struct SocialCanvasGridPreview: View {
    let tiles: [SocialGraphicSource?]
    let grid: [SocialGridItem]
    var body: some View {
        let cell: Double = 110
        let cellHeight = cell * 4 / 3
        let columns = Array(repeating: GridItem(.fixed(cell), spacing: 2), count: 3)
        VStack(alignment: .leading, spacing: 4) {
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(Array(tiles.enumerated()), id: \.offset) { item in
                    ZStack(alignment: .topLeading) {
                        SocialGraphicView(source: item.element, width: cellHeight * 0.8, height: cellHeight)
                            .frame(width: cell, height: cellHeight).clipped()
                        if item.offset == 0 {
                            Text("TA SIATKA").font(.system(size: 8, weight: .bold)).padding(.horizontal, 3).background(Color(red: 0.83, green: 0.73, blue: 0.45)).foregroundStyle(.black).padding(3)
                        }
                    }
                }
                ForEach(grid.prefix(max(0, 12 - tiles.count))) { item in
                    SocialImageView(url: item.imageUrl, contentMode: .fill).frame(width: cell, height: cellHeight).clipped()
                }
            }
            Text("Siatka profilu przycina kafelki do 3:4 — tu widać, jak złożą się na profilu. Przypięte posty przesuwają siatkę; kolejne posty publikuj po 3, żeby została równa.")
                .font(.caption2).foregroundStyle(.white.opacity(0.5)).fixedSize(horizontal: false, vertical: true)
        }
        .padding(4)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: .infinity)
    }
}

struct SocialStoryPreview: View {
    let graphic: SocialGraphicSource?
    let account: String
    let logo: String?
    var body: some View {
        let width: Double = 260
        ZStack(alignment: .top) {
            SocialGraphicView(source: graphic, width: width, height: width * 16 / 9)
            VStack(spacing: 6) {
                Capsule().fill(Color.white.opacity(0.4)).frame(height: 2).overlay(alignment: .leading) { Capsule().fill(Color.white).frame(width: width / 3, height: 2) }
                HStack(spacing: 6) { SocialAvatar(logo: logo); Text(account).font(.caption.weight(.semibold)); Text("2 godz.").font(.caption).opacity(0.7); Spacer() }
                Spacer()
                HStack(spacing: 8) {
                    Text("Wyślij wiadomość").font(.caption2).padding(.horizontal, 10).padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(Capsule().stroke(Color.white.opacity(0.6)))
                    Image(systemName: "heart"); Image(systemName: "paperplane")
                }
            }
            .padding(8)
            .foregroundStyle(.white)
        }
        .frame(width: width, height: width * 16 / 9)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .frame(maxWidth: .infinity)
    }
}

/// Post strony firmowej LinkedIn (jak `LinkedInPreview` w CRM): nazwa strony, opis (po ~210 znakach „…więcej”), grafika albo
/// kilka zdjęć (pierwsze duże, pod nim do trzech mniejszych), pasek akcji.
struct SocialLinkedInPreview: View {
    let graphic: SocialGraphicSource?
    let format: SocialFormat
    let account: String
    let logo: String?
    let caption: String
    var slides: [SocialGraphicSource?] = []
    @State private var expanded = false
    var body: some View {
        let width: Double = 360
        let gray = Color(white: 0.4)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 4).fill(Color(white: 0.15))
                    if let logo { SocialImageView(url: logo, contentMode: .fit).padding(5) }
                }
                .frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 1) {
                    Text(account).font(.callout.weight(.semibold))
                    Text("Obserwujący").font(.caption2).foregroundStyle(gray)
                    Text("Teraz · 🌐").font(.caption2).foregroundStyle(gray)
                }
                Spacer()
                Image(systemName: "ellipsis").foregroundStyle(gray)
            }
            .padding(10)
            let long = caption.count > 210 && !expanded
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(long ? String(caption.prefix(210)) + "…" : caption).font(.callout).fixedSize(horizontal: false, vertical: true)
                if long { Button("więcej") { expanded = true }.buttonStyle(.plain).font(.callout).foregroundStyle(gray) }
            }
            .padding(.horizontal, 10).padding(.bottom, 8)
            SocialGraphicView(source: graphic, width: width, height: width / format.aspect)
            if !slides.isEmpty { SocialPhotoStrip(slides: slides, format: format, width: width).padding(.top, 2) }
            HStack {
                Label("Lubię to", systemImage: "hand.thumbsup"); Spacer(); Label("Skomentuj", systemImage: "bubble.left"); Spacer()
                Label("Udostępnij", systemImage: "arrow.2.squarepath"); Spacer(); Label("Wyślij", systemImage: "paperplane")
            }
            .font(.caption.weight(.semibold)).foregroundStyle(gray).padding(10)
        }
        .frame(width: width)
        .foregroundStyle(Color.black)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: .infinity)
    }
}

/// Kolejne zdjęcia posta z kilkoma zdjęciami (Facebook, LinkedIn): do trzech mniejszych, na ostatnim „+N”.
struct SocialPhotoStrip: View {
    let slides: [SocialGraphicSource?]
    let format: SocialFormat
    let width: Double
    var body: some View {
        let rest = Array(slides.prefix(3))
        let hidden = slides.count - rest.count
        let cell = (width - Double(rest.count - 1) * 2) / Double(rest.count)
        HStack(spacing: 2) {
            ForEach(rest.indices, id: \.self) { position in
                SocialGraphicView(source: rest[position], width: cell, height: cell / format.aspect)
                    .frame(width: cell, height: cell).clipped()
                    .overlay {
                        if position == rest.count - 1 && hidden > 0 {
                            Text("+\(hidden)").font(.title.weight(.semibold)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.black.opacity(0.5))
                        }
                    }
            }
        }
    }
}

struct SocialFacebookPreview: View {
    let graphic: SocialGraphicSource?
    let format: SocialFormat
    let account: String
    let logo: String?
    let caption: String
    /// Kolejne zdjęcia (Facebook: pierwsze duże, pod nim do trzech mniejszych, na ostatnim „+N”).
    var slides: [SocialGraphicSource?] = []
    var body: some View {
        let width: Double = 360
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                SocialAvatar(logo: logo)
                VStack(alignment: .leading, spacing: 1) { Text(account).font(.callout.weight(.semibold)); Text("Teraz · 🌐").font(.caption2).foregroundStyle(.gray) }
                Spacer()
                Image(systemName: "ellipsis").foregroundStyle(.gray)
            }
            .padding(10)
            Text(caption.count > 240 ? String(caption.prefix(240)) + "… Zobacz więcej" : caption).font(.callout).padding(.horizontal, 10).padding(.bottom, 8)
                .fixedSize(horizontal: false, vertical: true)
            SocialGraphicView(source: graphic, width: width, height: width / format.aspect)
            if !slides.isEmpty { SocialPhotoStrip(slides: slides, format: format, width: width).padding(.top, 2) }
            HStack {
                Label("Lubię to!", systemImage: "hand.thumbsup"); Spacer(); Label("Komentarz", systemImage: "bubble.left"); Spacer(); Label("Udostępnij", systemImage: "arrowshape.turn.up.right")
            }
            .font(.caption).foregroundStyle(.gray).padding(10)
        }
        .frame(width: width)
        .foregroundStyle(Color.black)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: .infinity)
    }
}
