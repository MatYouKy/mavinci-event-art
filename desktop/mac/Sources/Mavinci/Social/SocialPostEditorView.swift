import SwiftUI
import AppKit

// MARK: Social media → kreator posta — 1:1 z CRM (`SocialPostEditor`): kanały, termin, wydarzenie, szablon, formaty 4:5 / 1:1 /
// 9:16 / 1,91:1 ze zdjęciem z biblioteki, natywny edytor kadru (przeciąganie, powiększanie gestem i suwakiem, propozycja kadru,
// pola logo i tekstów szablonu, strefy relacji), tytuł i podpis grafiki, opis, hashtagi, opisy AI, natywne podglądy z grafik
// wygenerowanych na serwerze (feed, siatka profilu, relacja, Facebook — te same pliki co w CRM i w telefonie), braki, historia
// i akcje statusu. Układ na pełną szerokość: trzy kolumny na szerokim ekranie (MacBook Pro 16"), dwie na MacBooku Air 13".

private struct SocialVariantDraft: Equatable {
    var enabled: Bool
    var asset: SocialAsset?
    var crop: SocialCrop?
    var touched: Bool
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
    var variants: [SocialFormat: SocialVariantDraft] = [:]

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
        for format in SocialFormat.allCases {
            let saved = detail.variant(format)
            variants[format] = SocialVariantDraft(enabled: saved != nil, asset: saved?.asset, crop: saved?.crop, touched: false)
        }
    }

    func variant(_ format: SocialFormat) -> SocialVariantDraft { variants[format] ?? SocialVariantDraft(enabled: false, asset: nil, crop: nil, touched: false) }
    var formatsWithPhoto: [SocialFormat] { SocialFormat.allCases.filter { variant($0).enabled && variant($0).asset != nil } }
}

private enum SocialPreviewTab: String, CaseIterable, Identifiable {
    case feed, grid, story, facebook
    var id: String { rawValue }
    var label: String { self == .feed ? "Feed Instagram" : self == .grid ? "Siatka profilu" : self == .story ? "Relacja" : "Facebook" }
}

private enum SocialPickerTarget: Identifiable {
    case all, format(SocialFormat)
    var id: String { if case .format(let format) = self { return format.rawValue }; return "all" }
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

    private var detail: SocialPostDetail? { store.detail(postID) }
    private var dirty: Bool { draft != baseline }

    var body: some View {
        Group {
            if let detail {
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
                ? "Kanały, które już się opublikowały, zostaną pominięte. Pozostałe trafią do Meta teraz."
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
                    .buttonStyle(.borderedProminent).disabled(dirty).help(dirty ? "Najpierw zapisz zmiany" : "Publikacja w Meta teraz")
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
                ForEach(SocialChannel.allCases) { channel in
                    HStack {
                        Toggle(channel.label, isOn: Binding(get: { draft.channels.contains(channel) }, set: { on in
                            if on { draft.channels.insert(channel) } else { draft.channels.remove(channel) }
                        }))
                        .disabled(!editable)
                        if draft.channels.contains(channel) {
                            Text("→ \(channel.format(in: draft.formatsWithPhoto)?.rawValue ?? "brak grafiki")").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                let dateLocked = detail.post.status == .scheduled && !detail.access.publish
                Toggle("Termin publikacji", isOn: $draft.hasDate).disabled(!editable || detail.post.status == .scheduled)
                if draft.hasDate {
                    DatePicker("", selection: $draft.scheduledAt, displayedComponents: [.date, .hourAndMinute]).labelsHidden().disabled(!editable || dateLocked)
                }
                if detail.post.status == .scheduled {
                    Text("Zmiana treści cofnie zaplanowany post do szkicu (wymaga ponownej akceptacji).").font(.caption2).foregroundStyle(.secondary)
                }
                Text("Wydarzenie").font(.subheadline).padding(.top, 4)
                HStack {
                    Button { eventPickerShown = true } label: { Label(draft.eventName ?? "Wybierz wydarzenie", systemImage: "calendar").lineLimit(1) }.disabled(!editable)
                    if draft.eventID != nil && editable { Button { draft.eventID = nil; draft.eventName = nil } label: { Image(systemName: "xmark") }.help("Bez wydarzenia") }
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
            card {
                Text("Tekst na grafice").font(.headline)
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
                Text("Zgodę ustawisz w Bibliotece (zdjęcie, wydarzenie albo klient).").font(.caption2).foregroundStyle(.secondary)
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
        return result
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
        return VStack(alignment: .leading, spacing: 12) {
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
            if !variant.enabled {
                Text("Ten format jest wyłączony.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(40)
            } else if let asset = variant.asset, let width = asset.width, let height = asset.height, let workURL = asset.workUrl {
                let crop = variant.crop ?? asset.proposal(active) ?? SocialCrop.center(width: width, height: height, format: active)
                HStack(alignment: .top, spacing: 14) {
                    VStack(spacing: 8) {
                        SocialCropEditor(imageURL: workURL, imageWidth: width, imageHeight: height, format: active, crop: crop,
                                         guides: detail.spec?.guides[active.rawValue], disabled: !editable) { next in
                            var item = draft.variant(active)
                            item.crop = next
                            item.touched = true
                            draft.variants[active] = item
                        }
                        if editable {
                            HStack {
                                Button { zoom(0.92, width: width, height: height, crop: crop) } label: { Image(systemName: "plus.magnifyingglass") }.help("Przybliż")
                                Button { zoom(1.08, width: width, height: height, crop: crop) } label: { Image(systemName: "minus.magnifyingglass") }.help("Oddal")
                                if let proposal = asset.proposal(active) { Button { setCrop(proposal.fitted(width: width, height: height, format: active)) } label: { Label("Propozycja", systemImage: "sparkles") } }
                                Button { setCrop(SocialCrop.center(width: width, height: height, format: active)) } label: { Label("Środek", systemImage: "scope") }
                                Button { picker = .format(active) } label: { Label("Inne zdjęcie", systemImage: "photo") }
                            }
                            Text("Przeciągnij kadr, gest szczypania lub przyciski — powiększenie. Ramki: biała — logo, złota — tytuł i podpis\(detail.spec?.guides[active.rawValue]?.unsafeTop != nil ? ", czerwone — zasłaniane w relacji" : "").")
                                .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    renderedBox(detail)
                }
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
            let count = socialHashtags(draft.hashtags).count
            Text("Hashtagi (\(count)/30)").font(.caption).foregroundStyle(count > 30 ? Color.red : Color.secondary)
            TextField("#mavinci #eventy #gala", text: $draft.hashtags).textFieldStyle(.roundedBorder).disabled(!editable)
            aiBox(detail, editable: editable)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func setCrop(_ crop: SocialCrop) {
        var item = draft.variant(active)
        item.crop = crop
        item.touched = true
        draft.variants[active] = item
    }

    private func zoom(_ factor: Double, width: Double, height: Double, crop: SocialCrop) {
        setCrop(crop.zoomed(factor, width: width, height: height, format: active))
    }

    /// Grafika z serwera dla aktywnego formatu (ta sama co w CRM i telefonie).
    private func renderedBox(_ detail: SocialPostDetail) -> some View {
        let saved = detail.variant(active)
        let current = saved?.upToDate == true && !dirty
        return VStack(alignment: .leading, spacing: 6) {
            Text(current ? "Grafika z serwera" : dirty ? "Zapisz, żeby wygenerować grafikę" : "Grafika nieaktualna").font(.caption).foregroundStyle(current ? Color.secondary : Color.orange)
            SocialImageView(url: saved?.renderedUrl, contentMode: .fit)
                .frame(width: 240, height: 240 / active.aspect)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .opacity(current ? 1 : 0.55)
            if let at = saved?.renderedAt, current { Text("Wygenerowano \(SocialDates.dateTime(at))").font(.caption2).foregroundStyle(.secondary) }
            if !dirty && detail.variants.contains(where: { $0.assetId != nil && !$0.upToDate }) && detail.access.create && detail.post.status.editable {
                Button { Task { await store.runDetail("Generuję grafiki", "renderPost", ["id": .string(detail.post.id)], success: "Grafiki są aktualne") } } label: { Label("Odśwież grafiki", systemImage: "arrow.clockwise") }
            }
        }
        .frame(width: 240)
    }

    @ViewBuilder private func aiBox(_ detail: SocialPostDetail, editable: Bool) -> some View {
        if editable {
            if !detail.settings.aiCaptionsEnabled {
                Label("Opisy AI włącza osoba akceptująca posty („Szablony i AI”).", systemImage: "sparkles").font(.caption).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label("Opisy AI z danych realizacji", systemImage: "sparkles").font(.subheadline)
                        Spacer()
                        Button(detail.post.aiSuggestions.isEmpty ? "Zaproponuj opisy" : "Nowe propozycje") { Task { await suggest(detail) } }
                    }
                    Text("Do AI trafia rodzaj wydarzenia, miejsce, miesiąc i opis realizacji; nazwa wydarzenia i klient — tylko przy zgodzie klienta.\(dirty ? " Najpierw zapiszemy zmiany." : "")")
                        .font(.caption2).foregroundStyle(.secondary)
                    ForEach(Array(detail.post.aiSuggestions.enumerated()), id: \.offset) { _, suggestion in
                        VStack(alignment: .leading, spacing: 4) {
                            if !suggestion.headline.isEmpty || !suggestion.subline.isEmpty {
                                Text(suggestion.headline + (suggestion.subline.isEmpty ? "" : " · " + suggestion.subline)).font(.caption).foregroundStyle(theme.accent)
                            }
                            Text(suggestion.caption).font(.caption).textSelection(.enabled)
                            Text(suggestion.hashtags.joined(separator: " ")).font(.caption2).foregroundStyle(.secondary)
                            Button("Użyj tej wersji") {
                                draft.caption = suggestion.caption
                                draft.hashtags = suggestion.hashtags.joined(separator: " ")
                                if !suggestion.headline.isEmpty { draft.headline = suggestion.headline }
                                if !suggestion.subline.isEmpty { draft.subline = suggestion.subline }
                            }
                        }
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 10).stroke(theme.accent.opacity(0.25)))
            }
        }
    }

    // MARK: Prawa kolumna — podglądy
    private func previewColumn(_ detail: SocialPostDetail) -> some View {
        let formats = detail.formatsWithPhoto
        let feed = SocialChannel.instagramFeed.format(in: formats) ?? formats.first
        let facebook = SocialChannel.facebookFeed.format(in: formats) ?? formats.first
        let story = SocialChannel.instagramStory.format(in: formats)
        let account = detail.company.name.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "." || $0 == "_" }
        let text = socialPublicationText(draft.caption, socialHashtags(draft.hashtags))
        let logo = detail.template?.logoUrl
        return VStack(alignment: .leading, spacing: 10) {
            Picker("", selection: $preview) {
                ForEach(SocialPreviewTab.allCases) { tab in Text(tab.label).tag(tab) }
            }
            .pickerStyle(.segmented).labelsHidden()
            switch preview {
            case .feed:
                SocialFeedPreview(image: feed.flatMap { detail.variant($0)?.renderedUrl }, format: feed ?? .portrait, account: account, logo: logo, caption: text)
            case .grid:
                SocialGridPreview(image: feed.flatMap { detail.variant($0)?.renderedUrl }, format: feed ?? .portrait, grid: detail.grid)
            case .story:
                if let story { SocialStoryPreview(image: detail.variant(story)?.renderedUrl, account: account, logo: logo) }
                else { Text("Włącz format „Relacja 9:16” i kanał „Instagram — relacja”, żeby zobaczyć relację.").font(.callout).foregroundStyle(.secondary).padding(20) }
            case .facebook:
                SocialFacebookPreview(image: facebook.flatMap { detail.variant($0)?.renderedUrl }, format: facebook ?? .portrait, account: detail.company.name, logo: logo, caption: text)
            }
            Text("Podglądy pokazują grafiki wygenerowane na serwerze — identyczne w CRM, na Macu i w telefonie\(dirty ? ". Zapisz, żeby zobaczyć zmiany." : ".")")
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

    // MARK: Publikacja w Meta
    /// Stan publikacji: termin i osoba planująca, błąd, wyniki kanałów (link albo błąd, po publikacji — statystyki z Meta)
    /// i braki konta Meta.
    @ViewBuilder private func metaCard(_ detail: SocialPostDetail) -> some View {
        let publications = detail.publications ?? []
        let status = detail.post.status
        let anyPublished = publications.contains { $0.status == "published" }
        if detail.meta != nil || !publications.isEmpty || [.scheduled, .publishing, .failed].contains(status) {
            card {
                HStack {
                    Label("Publikacja w Meta", systemImage: "calendar.badge.clock").font(.headline)
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
                    HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Trwa publikacja w Meta…").font(.caption) }
                }
                if status == .failed, let error = detail.post.publishError {
                    Text(error).font(.caption).foregroundStyle(.red).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.red.opacity(0.1)))
                }
                ForEach(detail.post.channels, id: \.self) { channel in
                    let publication = publications.first { $0.channel == channel }
                    let problem = detail.meta?.channel(channel)?.problem
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Image(systemName: publication?.status == "published" ? "checkmark.circle.fill"
                                  : publication?.status == "failed" ? "xmark.circle.fill" : problem != nil ? "exclamationmark.triangle.fill" : "circle")
                                .foregroundStyle(publication?.status == "published" ? Color.green : publication?.status == "failed" ? Color.red : problem != nil ? Color.orange : Color.secondary)
                            Text(channel.label).font(.caption.weight(.semibold))
                            Text(publication?.statusLabel ?? (problem != nil ? "niegotowy" : "gotowy")).font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            if let link = publication?.permalink, let url = URL(string: link) {
                                Link(destination: url) { Label("Otwórz", systemImage: "arrow.up.right.square") }.font(.caption2)
                            }
                        }
                        if let error = publication?.error, publication?.status != "published" { Text(error).font(.caption2).foregroundStyle(.red) }
                        if publication == nil, let problem { Text(problem).font(.caption2).foregroundStyle(.orange) }
                        if let publication, publication.status == "published" { publicationMetrics(publication) }
                    }
                }
                if let meta = detail.meta, !meta.connected {
                    Button { state.openCRM("/crm/settings/my-companies/\(detail.company.id)/marketing") } label: { Label("Połącz Meta w ustawieniach marketingu", systemImage: "link") }
                        .buttonStyle(.link).font(.caption)
                }
            }
        }
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
            Text("W tym terminie serwer opublikuje post w Meta: " + detail.post.channels.map(\.label).joined(separator: ", ") + ". Błąd publikacji zobaczysz na karcie posta (autor i osoba planująca dostaną powiadomienie).")
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

    private func suggest(_ detail: SocialPostDetail) async {
        var current = detail
        if dirty { guard let saved = await save(detail, quiet: true) else { return }; current = saved }
        await store.runDetail("Przygotowuję propozycje opisu", "suggest", ["id": .string(current.post.id)], success: "Gotowe propozycje opisu")
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
        }
        if draft.eventID == nil, let eventID = asset.eventId { draft.eventID = eventID; draft.eventName = asset.eventName }
        picker = nil
    }

    private func pickerTitle(_ target: SocialPickerTarget) -> String {
        if case .format(let format) = target { return "Zdjęcie — \(format.label)" }
        return "Zdjęcie dla wszystkich formatów"
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
            Text("Użyj, gdy post opublikowano ręcznie (np. z paczki „Więcej” → „Pobierz paczkę”, bez połączenia z Meta). Wklej link do posta. Publikację w Meta uruchamiają „Opublikuj teraz” i „Zaplanuj publikację”.")
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
                            onChange(start.zoomed(1 / max(0.2, value.magnification), width: imageWidth, height: imageHeight, format: format))
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

// MARK: Natywne podglądy z grafik serwera
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

struct SocialFeedPreview: View {
    let image: String?
    let format: SocialFormat
    let account: String
    let logo: String?
    let caption: String
    var body: some View {
        let width: Double = 340
        VStack(alignment: .leading, spacing: 0) {
            HStack { SocialAvatar(logo: logo); Text(account).font(.callout.weight(.semibold)); Spacer(); Image(systemName: "ellipsis") }.padding(8)
            SocialImageView(url: image, contentMode: .fill).frame(width: width, height: width / format.aspect).clipped()
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
    let image: String?
    let format: SocialFormat
    let grid: [SocialGridItem]
    var body: some View {
        let cell: Double = 110
        let cellHeight = cell * 4 / 3
        let columns = Array(repeating: GridItem(.fixed(cell), spacing: 2), count: 3)
        VStack(alignment: .leading, spacing: 4) {
            LazyVGrid(columns: columns, spacing: 2) {
                ZStack(alignment: .topLeading) {
                    SocialImageView(url: image, contentMode: .fill).frame(width: cellHeight * format.aspect, height: cellHeight)
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

struct SocialStoryPreview: View {
    let image: String?
    let account: String
    let logo: String?
    var body: some View {
        let width: Double = 260
        ZStack(alignment: .top) {
            SocialImageView(url: image, contentMode: .fill).frame(width: width, height: width * 16 / 9).clipped()
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

struct SocialFacebookPreview: View {
    let image: String?
    let format: SocialFormat
    let account: String
    let logo: String?
    let caption: String
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
            SocialImageView(url: image, contentMode: .fill).frame(width: width, height: width / format.aspect).clipped()
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
