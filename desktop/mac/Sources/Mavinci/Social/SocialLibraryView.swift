import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Social media → Biblioteka — 1:1 z CRM: filtry (status, zgoda klienta, użycie, wydarzenie, wyszukiwanie), siatka zdjęć
// ze zgodą i liczbą postów, wgrywanie z Findera (przeciąganie i okno wyboru — HEIC zapisywany jako JPEG), import z plików
// wydarzenia i z realizacji na stronie, karta zdjęcia (opis, wydarzenie, zgoda zdjęcia / wydarzenia / klienta, archiwum,
// usunięcie, „Nowy post z tego zdjęcia”). W trybie wyboru (`onPick`) — wybór zdjęcia do grafiki posta.

@MainActor struct SocialLibraryView: View {
    @ObservedObject var store: SocialStore
    var onPick: ((SocialAsset) -> Void)? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var dropping = false
    @State private var openedAsset: SocialAsset?
    @State private var importer: SocialImportKind?
    @State private var eventPickerShown = false

    private var access: SocialAccess? { store.home?.access }
    private var canCreate: Bool { access?.create == true && onPick == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            filters
            if canCreate {
                Text("Przeciągnij zdjęcia z Findera na bibliotekę.\(store.libraryFilter.eventName.map { " Nowe zdjęcia zostaną powiązane z „\($0)”." } ?? "")")
                    .font(.caption).foregroundStyle(.secondary)
            }
            grid
        }
        .padding(onPick == nil ? 12 : 0)
        .background(RoundedRectangle(cornerRadius: 12).fill(onPick == nil ? theme.card : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(dropping ? theme.accent : Color.clear, lineWidth: 2))
        .onDrop(of: [UTType.fileURL], isTargeted: canCreate ? $dropping : .constant(false)) { providers in
            guard canCreate else { return false }
            accept(providers)
            return true
        }
        .task(id: store.libraryFilter) { await store.loadLibrary() }
        .sheet(item: $openedAsset) { asset in
            SocialAssetSheet(store: store, asset: asset).environmentObject(state).environment(\.crmTheme, theme)
        }
        .sheet(item: $importer) { kind in
            SocialImportSheet(store: store, kind: kind).environmentObject(state).environment(\.crmTheme, theme)
        }
        .sheet(isPresented: $eventPickerShown) {
            SocialEventPickerSheet(store: store) { event in
                store.libraryFilter.eventID = event.id
                store.libraryFilter.eventName = event.name
                store.libraryFilter.offset = 0
            }
            .environmentObject(state).environment(\.crmTheme, theme)
        }
    }

    private var filters: some View {
        HStack(spacing: 8) {
            Picker("", selection: $store.libraryFilter.status) {
                Text("W bibliotece").tag("ready")
                Text("Propozycje\((store.library?.proposals ?? 0) > 0 ? " (\(store.library?.proposals ?? 0))" : "")").tag("proposed")
                Text("Archiwum").tag("archived")
            }
            .pickerStyle(.segmented).frame(width: 330).labelsHidden()
            Picker("Zgoda", selection: $store.libraryFilter.consent) {
                Text("Zgoda: wszystkie").tag("")
                Text("Zgoda: jest / niepotrzebna").tag("ok")
                Text("Zgoda: brak / nieustalona").tag("missing")
            }
            .labelsHidden().frame(width: 200)
            Picker("Użycie", selection: $store.libraryFilter.used) {
                Text("Użyte i nieużyte").tag("")
                Text("Nieużyte").tag("unused")
                Text("Użyte w postach").tag("used")
            }
            .labelsHidden().frame(width: 160)
            Button { eventPickerShown = true } label: { Label(store.libraryFilter.eventName ?? "Wydarzenie", systemImage: "calendar") }
            if store.libraryFilter.eventID != nil {
                Button { store.libraryFilter.eventID = nil; store.libraryFilter.eventName = nil } label: { Image(systemName: "xmark") }.help("Wszystkie wydarzenia")
            }
            TextField("Szukaj w opisach i nazwach", text: $store.libraryFilter.query).textFieldStyle(.roundedBorder).frame(maxWidth: 240)
            Spacer(minLength: 8)
            if canCreate {
                Button { choose() } label: { Label("Wgraj z dysku", systemImage: "square.and.arrow.up") }.buttonStyle(.borderedProminent)
                Button { importer = .event } label: { Label("Z plików wydarzenia", systemImage: "folder") }
                Button { importer = .portfolio } label: { Label("Z realizacji", systemImage: "photo.stack") }
            }
        }
        .controlSize(.regular)
    }

    @ViewBuilder private var grid: some View {
        if let error = store.libraryError, store.library == nil {
            Text(error).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(30)
        } else if let page = store.library {
            ScrollView {
                if page.assets.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "photo.on.rectangle").font(.largeTitle).foregroundStyle(theme.accent.opacity(0.5))
                        Text("Brak zdjęć w tym widoku.").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(40)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: 10)], spacing: 10) {
                    ForEach(page.assets) { asset in tile(asset) }
                }
                if page.total > page.limit {
                    HStack {
                        Button("Poprzednie") { store.libraryFilter.offset = max(0, store.libraryFilter.offset - page.limit) }.disabled(store.libraryFilter.offset == 0)
                        Text("\(store.libraryFilter.offset / page.limit + 1) / \(Int((Double(page.total) / Double(page.limit)).rounded(.up)))").foregroundStyle(.secondary)
                        Button("Następne") { store.libraryFilter.offset += page.limit }.disabled(store.libraryFilter.offset + page.limit >= page.total)
                    }
                    .frame(maxWidth: .infinity).padding(.top, 8)
                }
            }
        } else {
            ProgressView("Ładowanie biblioteki...").frame(maxWidth: .infinity).padding(40)
        }
    }

    private func tile(_ asset: SocialAsset) -> some View {
        Button {
            if let onPick { onPick(asset) } else { openedAsset = asset }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                ZStack(alignment: .topLeading) {
                    SocialImageView(url: asset.thumbnailUrl).aspectRatio(0.8, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 8))
                    SocialConsentBadge(consent: asset.consent, compact: true).padding(5)
                    if asset.usedIn > 0 {
                        Text("w postach: \(asset.usedIn)").font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Color.black.opacity(0.6))).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .trailing).padding(5)
                    }
                    if asset.status == "proposed" {
                        Text("Propozycja").font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Color.blue.opacity(0.8))).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading).padding(5)
                    }
                }
                Text(asset.displayTitle).font(.caption).lineLimit(1)
                Text(asset.eventName ?? asset.portfolioTitle ?? asset.sourceLabel).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP, .heic, .heif, .tiff]
        panel.prompt = "Dodaj do biblioteki"
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        let eventID = store.libraryFilter.eventID
        Task { await store.upload(urls, eventID: eventID) }
    }

    private func accept(_ providers: [NSItemProvider]) {
        let eventID = store.libraryFilter.eventID
        Task {
            var urls: [URL] = []
            for provider in providers {
                if let url = await Self.fileURL(provider) { urls.append(url) }
            }
            guard !urls.isEmpty else { return }
            await store.upload(urls, eventID: eventID)
        }
    }

    nonisolated static func fileURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
        }
    }
}

enum SocialImportKind: String, Identifiable {
    case event, portfolio
    var id: String { rawValue }
}

/// Wybór wydarzenia (wyszukiwanie, dostęp jak w CRM).
@MainActor struct SocialEventPickerSheet: View {
    @ObservedObject var store: SocialStore
    let onPick: (SocialEventOption) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var events: [SocialEventOption]?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Wybierz wydarzenie").font(.title3.weight(.semibold))
            TextField("Nazwa wydarzenia", text: $query).textFieldStyle(.roundedBorder)
            if let events {
                if events.isEmpty { Text("Brak wydarzeń.").foregroundStyle(.secondary) }
                List(events) { event in
                    Button {
                        onPick(event)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.name).font(.headline)
                            Text([event.date.map { SocialDates.dateTime($0) }, event.location.isEmpty ? nil : event.location, event.organizationName].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .frame(minHeight: 280)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 200)
            }
            HStack { Spacer(); Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction) }
        }
        .padding(20)
        .frame(width: 520, height: 520)
        .task(id: query) {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            events = await store.events(query: query)
        }
    }
}

/// Import zdjęć z plików wydarzenia albo z galerii realizacji na stronie.
@MainActor struct SocialImportSheet: View {
    @ObservedObject var store: SocialStore
    let kind: SocialImportKind
    @Environment(\.dismiss) private var dismiss
    @State private var event: SocialEventOption?
    @State private var files: [SocialEventFile]?
    @State private var projects: [SocialPortfolioProject]?
    @State private var project: SocialPortfolioProject?
    @State private var eventPickerShown = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.weight(.semibold))
            if kind == .event { eventContent } else { portfolioContent }
            HStack { Spacer(); Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction) }
        }
        .padding(20)
        .frame(width: 760, height: 620)
        .task {
            if kind == .portfolio { projects = await store.portfolio(query: "") } else { eventPickerShown = true }
        }
        .sheet(isPresented: $eventPickerShown) {
            SocialEventPickerSheet(store: store) { picked in
                event = picked
                files = nil
                Task { files = await store.eventFiles(picked.id) }
            }
        }
    }

    private var title: String {
        if kind == .event { return event.map { "Zdjęcia z wydarzenia „\($0.name)”" } ?? "Zdjęcia z plików wydarzenia" }
        return project?.title ?? "Realizacje na stronie"
    }

    @ViewBuilder private var eventContent: some View {
        Button { eventPickerShown = true } label: { Label(event == nil ? "Wybierz wydarzenie" : "Inne wydarzenie", systemImage: "calendar") }
        if let files {
            if files.isEmpty { Text("To wydarzenie nie ma zdjęć w plikach.").foregroundStyle(.secondary) }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(files) { file in
                        Button {
                            Task {
                                if await store.importEventFile(file.id), let index = self.files?.firstIndex(where: { $0.id == file.id }) {
                                    self.files?[index].imported = true
                                }
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                ZStack(alignment: .topTrailing) {
                                    SocialImageView(url: file.url).aspectRatio(1, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 8))
                                    if file.imported { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).padding(5) }
                                }
                                Text(file.name).font(.caption2).lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(file.imported)
                    }
                }
            }
        } else if event != nil {
            ProgressView().frame(maxWidth: .infinity, minHeight: 200)
        }
    }

    @ViewBuilder private var portfolioContent: some View {
        if let project {
            Button { self.project = nil } label: { Label("Wszystkie realizacje", systemImage: "chevron.left") }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(project.images, id: \.self) { url in
                        Button { Task { await store.importPortfolio(project.id, imageURL: url) } } label: {
                            SocialImageView(url: url).aspectRatio(1, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        } else if let projects {
            List(projects) { item in
                Button { project = item } label: {
                    HStack(spacing: 10) {
                        SocialImageView(url: item.images.first).frame(width: 48, height: 48).clipShape(RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading) {
                            Text(item.title)
                            Text("\(item.location) · \(item.images.count) zdjęć").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, minHeight: 200)
        }
    }
}

/// Karta zdjęcia z biblioteki.
@MainActor struct SocialAssetSheet: View {
    @ObservedObject var store: SocialStore
    @State var asset: SocialAsset
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var detail: SocialAssetDetail?
    @State private var title = ""
    @State private var note = ""
    @State private var brands = ""
    @State private var consent: SocialConsentStatus = .inherit
    @State private var consentChannels: Set<String> = []
    @State private var consentNote = ""
    @State private var eventPickerShown = false
    @State private var levelTarget: SocialConsentTarget?
    @State private var confirmDelete = false

    private var access: SocialAccess? { detail?.access ?? store.home?.access }

    init(store: SocialStore, asset: SocialAsset) {
        self.store = store
        _asset = State(initialValue: asset)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(asset.displayTitle).font(.title3.weight(.semibold)).lineLimit(1)
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    SocialImageView(url: asset.workUrl ?? asset.thumbnailUrl, contentMode: .fit).frame(maxHeight: 360).frame(maxWidth: .infinity)
                    HStack(spacing: 8) {
                        Text(asset.statusLabel); Text("·"); Text(asset.sourceLabel)
                        if let width = asset.width, let height = asset.height { Text("·"); Text("\(Int(width))×\(Int(height)) px") }
                        if let name = asset.createdByName { Text("·"); Text("dodał(a): \(name)") }
                        SocialConsentBadge(consent: asset.consent)
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    if access?.create == true { describe }
                    consentBox
                    if let posts = detail?.posts, !posts.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Użyte w postach").font(.headline)
                            ForEach(posts) { post in Text("\(post.title.isEmpty ? "Post bez tytułu" : post.title) · \(SocialPostStatus(rawValue: post.status)?.label ?? post.status)").font(.callout) }
                        }
                    }
                    if access?.create == true { actions }
                }
            }
        }
        .padding(20)
        .frame(width: 720, height: 760)
        .task {
            apply(asset)
            if let fresh = await store.assetDetail(asset.id) { detail = fresh; if let value = fresh.asset { apply(value) } }
        }
        .sheet(isPresented: $eventPickerShown) {
            SocialEventPickerSheet(store: store) { event in
                Task { await update(["eventId": .string(event.id)], "Powiązano zdjęcie z wydarzeniem") }
            }
        }
        .sheet(item: $levelTarget) { target in
            SocialLevelConsentSheet(store: store, target: target) {
                Task { if let fresh = await store.assetDetail(asset.id) { detail = fresh; if let value = fresh.asset { apply(value) } } }
            }
        }
        .confirmationDialog("Usunąć zdjęcie?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń trwale", role: .destructive) { Task { if await store.deleteAsset(asset.id) { dismiss() } } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Zdjęcie i jego wersje zostaną trwale usunięte z biblioteki. Tej operacji nie można cofnąć.") }
    }

    private func apply(_ value: SocialAsset) {
        asset = value
        title = value.title; note = value.note; brands = value.visibleBrands.joined(separator: ", ")
        consent = SocialConsentStatus(rawValue: value.consentStatus) ?? .inherit
        consentChannels = Set(value.consentChannels); consentNote = value.consentNote
    }

    private func update(_ patch: [String: JSONValue], _ success: String) async {
        if let fresh = await store.updateAsset(asset, patch, success: success) {
            detail = fresh
            if let value = fresh.asset { apply(value) }
        }
    }

    private var describe: some View {
        VStack(alignment: .leading, spacing: 8) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                GridRow { Text("Opis zdjęcia"); TextField("", text: $title).textFieldStyle(.roundedBorder) }
                GridRow { Text("Marki na zdjęciu"); TextField("po przecinku", text: $brands).textFieldStyle(.roundedBorder) }
                GridRow { Text("Notatka"); TextField("", text: $note, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder) }
            }
            HStack {
                Button { eventPickerShown = true } label: { Label(asset.eventName.map { "Wydarzenie: \($0)" } ?? "Powiąż z wydarzeniem", systemImage: "calendar") }
                if asset.eventId != nil { Button { Task { await update(["eventId": .null], "Usunięto powiązanie z wydarzeniem") } } label: { Label("Bez wydarzenia", systemImage: "xmark") } }
                Spacer()
                Button("Zapisz opis") {
                    let list = brands.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                    Task { await update(["title": .string(title), "note": .string(note), "visibleBrands": .array(list.map(JSONValue.string))], "Zapisano opis zdjęcia") }
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private var consentBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Zgoda klienta na publikację").font(.headline)
            Text("Obowiązuje: \(asset.consent.label) (\(asset.consent.sourceLabel)). Kolejność: zdjęcie → wydarzenie → klient.").font(.caption).foregroundStyle(.secondary)
            if access?.consent == true {
                Picker("Dla zdjęcia", selection: $consent) {
                    ForEach(SocialConsentStatus.allCases) { status in
                        Text(status == .inherit ? "Jak wydarzenie i klient" : status.label).tag(status)
                    }
                }
                .frame(maxWidth: 360)
                if consent == .granted {
                    HStack(spacing: 14) {
                        ForEach(SocialConsentPlatform.allCases) { platform in
                            Toggle(platform.label, isOn: Binding(get: { consentChannels.contains(platform.rawValue) }, set: { on in
                                if on { consentChannels.insert(platform.rawValue) } else { consentChannels.remove(platform.rawValue) }
                            }))
                        }
                        Text("Bez zaznaczenia — wszystkie platformy.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                TextField("Notatka (np. mail klienta z 12.11)", text: $consentNote).textFieldStyle(.roundedBorder)
                HStack {
                    Button("Zapisz zgodę zdjęcia") {
                        let channels = consent == .granted ? Array(consentChannels).sorted() : []
                        Task { await update(["consentStatus": .string(consent.rawValue), "consentChannels": .array(channels.map(JSONValue.string)), "consentNote": .string(consentNote)], "Zapisano zgodę dla zdjęcia") }
                    }
                    .buttonStyle(.borderedProminent)
                    if let eventID = asset.eventId {
                        Button("Zgoda dla całego wydarzenia") { levelTarget = SocialConsentTarget(eventID: eventID, organizationID: nil, label: "wydarzenia „\(asset.eventName ?? "")”") }
                    }
                    if let organizationID = asset.organizationId {
                        Button("Zgoda dla klienta") { levelTarget = SocialConsentTarget(eventID: nil, organizationID: organizationID, label: "klienta „\(asset.organizationName ?? "")”") }
                    }
                }
            } else {
                Text("Status zgody ustawia twórca treści albo akceptujący.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.12)))
    }

    private var actions: some View {
        HStack(spacing: 8) {
            if asset.status != "archived" {
                Button { let id = asset.id; dismiss(); Task { await store.createPost(assetID: id) } } label: { Label("Nowy post z tego zdjęcia", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
            }
            if asset.status == "proposed" { Button { Task { await update(["status": .string("ready")], "Zdjęcie przyjęte do biblioteki") } } label: { Label("Przyjmij do biblioteki", systemImage: "checkmark") } }
            if asset.status != "archived" {
                Button { Task { await update(["status": .string("archived")], "Zdjęcie przeniesione do archiwum") } } label: { Label("Do archiwum", systemImage: "archivebox") }
            } else {
                Button("Przywróć z archiwum") { Task { await update(["status": .string("ready")], "Zdjęcie przywrócone do biblioteki") } }
            }
            Spacer()
            if asset.usedIn == 0 { Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń", systemImage: "trash") } }
        }
    }
}

struct SocialConsentTarget: Identifiable {
    let eventID: String?
    let organizationID: String?
    let label: String
    var id: String { (eventID ?? "") + (organizationID ?? "") }
}

/// Zgoda dla całego wydarzenia albo klienta (domyślna dla zdjęć bez własnej zgody).
@MainActor struct SocialLevelConsentSheet: View {
    @ObservedObject var store: SocialStore
    let target: SocialConsentTarget
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var status: SocialConsentStatus = .granted
    @State private var channels: Set<String> = []
    @State private var note = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Zgoda \(target.label)").font(.title3.weight(.semibold))
            Picker("Status", selection: $status) {
                ForEach(SocialConsentStatus.allCases.filter { $0 != .inherit }) { value in Text(value.label).tag(value) }
            }
            if status == .granted {
                HStack(spacing: 14) {
                    ForEach(SocialConsentPlatform.allCases) { platform in
                        Toggle(platform.label, isOn: Binding(get: { channels.contains(platform.rawValue) }, set: { on in
                            if on { channels.insert(platform.rawValue) } else { channels.remove(platform.rawValue) }
                        }))
                    }
                }
            }
            TextField("Notatka (np. zgoda w umowie, mail klienta)", text: $note).textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz zgodę") {
                    let list = status == .granted ? Array(channels).sorted() : []
                    Task {
                        if await store.saveConsent(eventID: target.eventID, organizationID: target.organizationID, status: status.rawValue, channels: list, note: note) {
                            onSaved()
                            dismiss()
                        }
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 520)
    }
}
