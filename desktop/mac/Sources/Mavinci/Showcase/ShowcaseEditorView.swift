import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Strefa sprzedawcy → „Prezentacje” → karta — 1:1 z CRM (`ShowcaseItemEditor`): tytuł, widoczność, ekran startowy (hasło,
// wstęp, zdjęcie główne — także przeciągnięciem z Findera, Zdjęć, Safari), produkty z katalogu (kolejność przeciąganiem), bloki
// pokazu w kolejności spotkania (przeciąganie za uchwyt): zdjęcia, punkty, z katalogu produktów, specyfikacja, pytania klientów,
// tekst, realizacje ze strony; lista kontrolna z przejściem do bloku i podgląd jak na iPadzie (także przed zapisem). „Zapisz” (⌘S).

/// Miejsce, do którego trafią wybrane zdjęcia.
enum ShowcasePhotoTarget: Identifiable, Hashable {
    case hero
    case block(String)
    var id: String {
        switch self {
        case .hero: return "hero"
        case .block(let id): return "block-\(id)"
        }
    }
}

/// Lista wyboru: produkty z katalogu albo realizacje ze strony (`blockID` — blok realizacji).
enum ShowcaseListMode: Identifiable, Hashable {
    case products
    case realizations(String)
    var id: String {
        switch self {
        case .products: return "products"
        case .realizations(let id): return "realizations-\(id)"
        }
    }
}

@MainActor struct ShowcaseEditorView: View {
    @ObservedObject var store: ShowcaseStore
    let id: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var photoPicker: ShowcasePhotoTarget?
    @State private var listPicker: ShowcaseListMode?
    @State private var confirmDelete = false
    @State private var blockToRemove: ShowcaseBlock?
    @State private var highlight: String?
    @State private var highlightTask: Task<Void, Never>?
    @State private var heroDropping = false
    @State private var blockTarget: String?
    @State private var fileTarget: String?
    @State private var rowTarget: String?
    @State private var photoTarget: String?
    @State private var productTarget: String?

    private var detail: ShowcaseDetail? { store.details[id] }

    var body: some View {
        Group {
            if let detail, let draft = store.drafts[id] {
                editor(detail, draft)
            } else if let error = store.detailErrors[id] {
                ContentUnavailableView {
                    Label("Karta prezentacji", systemImage: "ipad.landscape")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadDetail(id) } }
                    Button("Zamknij") { store.openedID = nil }
                }
            } else {
                ProgressView("Ładowanie karty...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: id) { await store.loadDetail(id) }
        .onDisappear { highlightTask?.cancel() }
    }

    // MARK: Wiązania kopii roboczej
    private func mutate(_ change: (inout ShowcaseDraft) -> Void) {
        guard var draft = store.drafts[id] else { return }
        change(&draft)
        store.drafts[id] = draft
    }

    private func field<T>(_ keyPath: WritableKeyPath<ShowcaseDraft, T>, _ fallback: T) -> Binding<T> {
        Binding(get: { store.drafts[id]?[keyPath: keyPath] ?? fallback }, set: { value in mutate { $0[keyPath: keyPath] = value } })
    }

    private func limited(_ binding: Binding<String>, _ max: Int) -> Binding<String> {
        Binding(get: { binding.wrappedValue }, set: { binding.wrappedValue = String($0.prefix(max)) })
    }

    private func blockBinding(_ block: ShowcaseBlock) -> Binding<ShowcaseBlock> {
        Binding(
            get: { store.drafts[id]?.content.blocks.first { $0.id == block.id } ?? block },
            set: { value in mutate { draft in
                if let index = draft.content.blocks.firstIndex(where: { $0.id == value.id }) { draft.content.blocks[index] = value }
            } }
        )
    }

    private func updateBlock(_ blockID: String, _ change: (inout ShowcaseBlock) -> Void) {
        mutate { draft in
            guard let index = draft.content.blocks.firstIndex(where: { $0.id == blockID }) else { return }
            change(&draft.content.blocks[index])
        }
    }

    // MARK: Układ
    private func editor(_ detail: ShowcaseDetail, _ draft: ShowcaseDraft) -> some View {
        VStack(spacing: 10) {
            toolbar(detail, draft)
            if store.stale(id) { staleBanner(detail) }
            GeometryReader { geometry in
                let wide = geometry.size.width >= 1000
                ScrollViewReader { proxy in
                    ScrollView {
                        if wide {
                            HStack(alignment: .top, spacing: 14) {
                                mainColumn(detail, draft).frame(maxWidth: .infinity)
                                aside(detail, draft) { key, blockID in jump(key, blockID: blockID, proxy) }.frame(width: 320)
                            }
                            .padding(.bottom, 16)
                        } else {
                            VStack(spacing: 14) {
                                aside(detail, draft) { key, blockID in jump(key, blockID: blockID, proxy) }
                                mainColumn(detail, draft)
                            }
                            .padding(.bottom, 16)
                        }
                    }
                }
            }
        }
        .sheet(item: $photoPicker) { target in
            ShowcasePhotoPickerSheet(store: store, target: .item(id), products: productList(draft), single: target == .hero) { replies in
                addPhotos(replies.map(\.photo), to: target)
            }
            .environmentObject(state).environment(\.crmTheme, theme)
        }
        .sheet(item: $listPicker) { mode in
            listSheet(mode, draft).environmentObject(state).environment(\.crmTheme, theme)
        }
        .confirmationDialog("Usunąć kartę?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń kartę", role: .destructive) { Task { await store.deleteItem(id) } }
            Button("Wróć", role: .cancel) {}
        } message: { Text("Karta zniknie z prezentacji. Zdjęcia z katalogu i realizacji zostają w swoich miejscach. Tej operacji nie można cofnąć.") }
        .confirmationDialog("Usunąć blok?", isPresented: Binding(get: { blockToRemove != nil }, set: { if !$0 { blockToRemove = nil } }), titleVisibility: .visible) {
            Button("Usuń blok", role: .destructive) {
                if let block = blockToRemove { mutate { $0.content.blocks.removeAll { $0.id == block.id } } }
                blockToRemove = nil
            }
            Button("Wróć", role: .cancel) { blockToRemove = nil }
        } message: { Text("Treść bloku zniknie z karty po zapisaniu. Zamiast usuwać, możesz go ukryć (ikona oka).") }
    }

    private func productList(_ draft: ShowcaseDraft) -> [(String, String)] {
        draft.productIDs.map { ($0, store.productNames[$0] ?? "Produkt") }
    }

    @ViewBuilder private func listSheet(_ mode: ShowcaseListMode, _ draft: ShowcaseDraft) -> some View {
        switch mode {
        case .products:
            ShowcaseListPickerSheet(store: store, realizations: false, exclude: draft.productIDs, single: false, title: "Produkty z katalogu", confirm: nil) { picked in
                for entry in picked { store.productNames[entry.id] = entry.title }
                mutate { $0.productIDs = Array(($0.productIDs + picked.map(\.id)).prefix(ShowcaseLimits.products)) }
            }
        case .realizations(let blockID):
            let current = draft.content.blocks.first { $0.id == blockID }?.refs ?? []
            ShowcaseListPickerSheet(store: store, realizations: true, exclude: current, single: false, title: "Realizacje ze strony", confirm: nil) { picked in
                for entry in picked { store.realizationInfo[entry.id] = ShowcaseRefInfo(title: entry.title, thumb: entry.thumb) }
                updateBlock(blockID) { $0.refs = Array(($0.refs + picked.map(\.id)).prefix(ShowcaseLimits.refs)) }
            }
        }
    }

    private func toolbar(_ detail: ShowcaseDetail, _ draft: ShowcaseDraft) -> some View {
        let dirty = store.dirty(id)
        let saved: String = dirty ? "niezapisane zmiany" : "zapisano" + (detail.item.updatedByName.map { " · \($0)" } ?? "")
        return HStack(spacing: 8) {
            TextField("Tytuł karty (np. „Ekran LED na scenę”)", text: limited(field(\.title, ""), ShowcaseLimits.title))
                .textFieldStyle(.roundedBorder).font(.title3)
                .id("showcase-field-title")
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(highlight == "title" ? theme.accent : Color.clear, lineWidth: 2))
            Toggle(draft.isActive ? "Widoczna na spotkaniach" : "Ukryta (szkic)", isOn: field(\.isActive, true)).toggleStyle(.switch)
            Text(saved).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Button { preview(detail, draft) } label: { Label("Podgląd na iPadzie", systemImage: "ipad.landscape") }
            Button { Task { await store.saveItem(id) } } label: { Label("Zapisz", systemImage: "square.and.arrow.down") }
                .buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command).disabled(!dirty)
            Menu {
                if dirty { Button { store.discardDraft(id) } label: { Label("Odrzuć niezapisane zmiany", systemImage: "xmark.circle") } }
                Button { Task { await store.duplicateItem(id) } } label: { Label("Kopia karty (ukryta)", systemImage: "plus.square.on.square") }
                Divider()
                Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń kartę", systemImage: "trash") }
            } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                .menuStyle(.borderlessButton).fixedSize()
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func staleBanner(_ detail: ShowcaseDetail) -> some View {
        let who: String = detail.item.updatedByName.map { " (\($0))" } ?? ""
        return HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text("Kartę zapisano w innym oknie lub na innym urządzeniu\(who). Twoje zmiany nie są zapisane — odrzuć je albo zachowaj i zapisz swoją wersję.")
                .font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            Button("Odrzuć moje zmiany") { store.discardDraft(id) }
            Button("Zachowaj moje zmiany") { store.keepDraft(id) }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.orange.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.35)))
    }

    private func preview(_ detail: ShowcaseDetail, _ draft: ShowcaseDraft) {
        var current = detail
        current.item.title = draft.title.isEmpty ? detail.item.title : draft.title
        current.item.tagline = draft.tagline
        current.item.isActive = draft.isActive
        current.item.productIds = draft.productIDs
        current.item.content = draft.content
        current.urls = store.urls
        store.preview = ShowcasePreviewRequest(sectionID: detail.item.sectionId, itemID: detail.item.id, draft: current)
    }

    private func card<Inner: View>(_ title: String?, @ViewBuilder _ inner: () -> Inner) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { Text(title).font(.headline) }
            inner()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func overlayButton(_ symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.caption.weight(.semibold)).foregroundStyle(.white)
                .frame(width: 22, height: 22).background(Circle().fill(Color.black.opacity(0.6)))
        }
        .buttonStyle(.plain).help(help)
    }

    private func editorText(_ text: Binding<String>, minHeight: CGFloat) -> some View {
        TextEditor(text: text)
            .font(.body)
            .scrollContentBackground(.hidden)
            .padding(6)
            .frame(minHeight: minHeight)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
    }

    // MARK: Kolumna główna
    private func mainColumn(_ detail: ShowcaseDetail, _ draft: ShowcaseDraft) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            startScreen(draft)
            HStack {
                Text("Bloki pokazu").font(.headline)
                Text("— kolejność jak na spotkaniu (przeciągnij za uchwyt)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                addBlockMenu(draft)
            }
            ForEach(draft.content.blocks) { block in
                blockCard(block, detail: detail, draft: draft).id("showcase-block-\(block.id)")
            }
            if draft.content.blocks.isEmpty {
                card(nil) { Text("Karta nie ma bloków — dodaj „Jak to wygląda”, „Korzyści” albo galerię.").font(.callout).foregroundStyle(.secondary) }
            }
        }
    }

    private func startScreen(_ draft: ShowcaseDraft) -> some View {
        card("Ekran startowy karty") {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Hasło (jedno zdanie pod tytułem)").font(.caption).foregroundStyle(.secondary)
                    TextField("np. „Obraz widoczny z każdego miejsca sali — także w dzień”", text: limited(field(\.tagline, ""), ShowcaseLimits.tagline))
                        .textFieldStyle(.roundedBorder)
                        .id("showcase-field-tagline")
                    HStack {
                        Text("Wstęp — co klient dostaje i dlaczego warto (1–3 zdania)").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text("\(draft.content.lead.count)/\(ShowcaseLimits.lead)").font(.caption2).foregroundStyle(.tertiary)
                    }
                    editorText(limited(field(\.content.lead, ""), ShowcaseLimits.lead), minHeight: 96)
                        .id("showcase-field-lead")
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(highlight == "lead" ? theme.accent : Color.clear, lineWidth: 2))
                }
                hero(draft).frame(width: 260).id("showcase-field-hero")
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(highlight == "hero" ? theme.accent : Color.clear, lineWidth: 2).padding(-4))
            }
        }
    }

    private func hero(_ draft: ShowcaseDraft) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Zdjęcie główne").font(.caption).foregroundStyle(.secondary)
            Group {
                if let hero = draft.content.hero {
                    Color.clear.aspectRatio(4.0 / 3.0, contentMode: .fit)
                        .overlay { SocialImageView(url: store.url(hero.key)?.thumb) }
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(alignment: .topTrailing) {
                            overlayButton("xmark", help: "Usuń zdjęcie główne") { mutate { $0.content.hero = nil } }.padding(5)
                        }
                } else {
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(theme.accent.opacity(heroDropping ? 0.9 : 0.35), style: StrokeStyle(lineWidth: heroDropping ? 2 : 1, dash: [5, 4]))
                        .aspectRatio(4.0 / 3.0, contentMode: .fit)
                        .overlay {
                            VStack(spacing: 6) {
                                Image(systemName: "photo.badge.plus").font(.largeTitle)
                                Text("Przeciągnij zdjęcie z Findera").font(.caption)
                            }
                            .foregroundStyle(theme.accent.opacity(heroDropping ? 1 : 0.6))
                        }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(heroDropping ? theme.accent : Color.clear, lineWidth: 3))
            HStack(spacing: 6) {
                Button { chooseFiles(single: true) { urls in Task { await uploadFiles(urls, to: .hero) } } } label: { Label("Z dysku", systemImage: "square.and.arrow.up") }
                Button { photoPicker = .hero } label: { Label("Wybierz…", systemImage: "photo.on.rectangle") }
            }
        }
        .onDrop(of: PortfolioDrop.types, isTargeted: $heroDropping) { providers in
            guard PortfolioDrop.external(providers) else { return false }
            accept(providers, to: .hero)
            return true
        }
    }

    private func addBlockMenu(_ draft: ShowcaseDraft) -> some View {
        Menu {
            ForEach(ShowcaseBlockKind.allCases) { kind in
                Section(kind.label) {
                    ForEach(kind.styles) { style in
                        Button(style.label) { addBlock(kind, style: style.key, draft: draft) }
                    }
                }
            }
        } label: { Label("Dodaj blok", systemImage: "plus") }
            .menuStyle(.borderlessButton).fixedSize()
            .disabled(draft.content.blocks.count >= ShowcaseLimits.blocks)
    }

    private func addBlock(_ kind: ShowcaseBlockKind, style: String, draft: ShowcaseDraft) {
        let block = ShowcaseBlock(kind: kind, style: style, productId: kind == .catalog ? draft.productIDs.first : nil)
        mutate { $0.content.blocks.append(block) }
        flash("block-\(block.id)")
    }

    // MARK: Blok
    private func blockCard(_ block: ShowcaseBlock, detail: ShowcaseDetail, draft: ShowcaseDraft) -> some View {
        let binding = blockBinding(block)
        let targeted = blockTarget == block.id || fileTarget == block.id
        let highlighted = highlight == "block-\(block.id)"
        return VStack(alignment: .leading, spacing: 10) {
            blockHeader(block, binding: binding)
            if block.kind != .text {
                TextField("Wprowadzenie pod tytułem (opcjonalnie)", text: limited(binding.text, ShowcaseLimits.blockIntro), axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(1...3).font(.caption)
            }
            blockBody(block, binding: binding, detail: detail, draft: draft)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(targeted || highlighted ? theme.accent : Color.clear, lineWidth: 2))
        .opacity(block.hidden ? 0.6 : 1)
        .onDrop(of: ShowcaseDrag.types + PortfolioDrop.types, isTargeted: Binding(
            get: { blockTarget == block.id },
            set: { inside in if inside { blockTarget = block.id } else if blockTarget == block.id { blockTarget = nil } }
        )) { providers in
            blockTarget = nil
            if PortfolioDrop.external(providers) {
                guard block.kind == .photos else { return false }
                accept(providers, to: .block(block.id))
                return true
            }
            ShowcaseDrag.read(providers) { text in
                guard let draggedID = ShowcaseDrag.value(text, ShowcaseDrag.block) else { return }
                moveBlock(draggedID, to: block.id)
            }
            return true
        }
    }

    private func blockHeader(_ block: ShowcaseBlock, binding: Binding<ShowcaseBlock>) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal").foregroundStyle(.secondary).frame(width: 18, height: 24)
                .contentShape(Rectangle())
                .draggable(ShowcaseDrag.block + block.id) {
                    Label(block.title, systemImage: block.kind.symbol).padding(6).background(RoundedRectangle(cornerRadius: 6).fill(theme.card))
                }
                .help("Przeciągnij, żeby zmienić kolejność bloków")
            Label(block.kind.label, systemImage: block.kind.symbol).font(.caption2)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Capsule().fill(theme.accent.opacity(0.12))).foregroundStyle(theme.accent)
            TextField(block.kind.defaultTitle(block.style), text: limited(binding.title, ShowcaseLimits.blockTitle))
                .textFieldStyle(.roundedBorder).font(.headline)
            if block.kind.styles.count > 1 {
                Picker("Wariant", selection: Binding(
                    get: { block.style },
                    set: { style in
                        updateBlock(block.id) { value in
                            let previous = value.kind.defaultTitle(value.style)
                            if value.title.isEmpty || value.title == previous { value.title = value.kind.defaultTitle(style) }
                            value.style = style
                        }
                    }
                )) {
                    ForEach(block.kind.styles) { style in Text(style.label).tag(style.key) }
                }
                .labelsHidden().frame(width: 230)
            }
            Button { updateBlock(block.id) { $0.hidden.toggle() } } label: { Image(systemName: block.hidden ? "eye.slash" : "eye") }
                .buttonStyle(.borderless)
                .help(block.hidden ? "Ukryty — kliknij, żeby pokazywać na spotkaniach" : "Ukryj na spotkaniach (blok zostaje w karcie)")
            Button { removeBlock(block) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń blok")
        }
    }

    @ViewBuilder private func blockBody(_ block: ShowcaseBlock, binding: Binding<ShowcaseBlock>, detail: ShowcaseDetail, draft: ShowcaseDraft) -> some View {
        switch block.kind {
        case .photos: photosEditor(block)
        case .points, .specs, .faq: rowsEditor(block)
        case .text: editorText(limited(binding.text, ShowcaseLimits.blockText), minHeight: 140)
        case .catalog: catalogEditor(block, detail: detail, draft: draft)
        case .realizations: refsEditor(block)
        }
    }

    // MARK: Zdjęcia w bloku
    private func photosEditor(_ block: ShowcaseBlock) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                ForEach(block.photos) { photo in photoTile(photo, block: block) }
            }
            HStack(spacing: 8) {
                Image(systemName: "square.and.arrow.down.on.square").foregroundStyle(theme.accent)
                Text(fileTarget == block.id ? "Upuść zdjęcia tutaj" : "Przeciągnij zdjęcia z Findera, Zdjęć albo Safari (JPEG, PNG, WebP, HEIC)")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button { chooseFiles(single: false) { urls in Task { await uploadFiles(urls, to: .block(block.id)) } } } label: { Label("Z dysku", systemImage: "square.and.arrow.up") }
                Button { photoPicker = .block(block.id) } label: { Label("Wybierz…", systemImage: "photo.on.rectangle") }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.accent.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
            .onDrop(of: PortfolioDrop.types, isTargeted: Binding(
                get: { fileTarget == block.id },
                set: { inside in if inside { fileTarget = block.id } else if fileTarget == block.id { fileTarget = nil } }
            )) { providers in
                fileTarget = nil
                guard PortfolioDrop.external(providers) else { return false }
                accept(providers, to: .block(block.id))
                return true
            }
        }
    }

    private func photoTile(_ photo: ShowcaseMedia, block: ShowcaseBlock) -> some View {
        let key = "\(block.id):\(photo.id)"
        let targeted = photoTarget == key
        let caption = Binding<String>(
            get: { store.drafts[id]?.content.blocks.first { $0.id == block.id }?.photos.first { $0.id == photo.id }?.caption ?? "" },
            set: { value in
                updateBlock(block.id) { item in
                    if let index = item.photos.firstIndex(where: { $0.id == photo.id }) { item.photos[index].caption = String(value.prefix(ShowcaseLimits.caption)) }
                }
            }
        )
        let badge: String? = photo.source == .product ? "Katalog" : (photo.source == .site ? "Realizacja" : nil)
        return VStack(spacing: 4) {
            Color.clear.aspectRatio(4.0 / 3.0, contentMode: .fit)
                .overlay { SocialImageView(url: store.url(photo.key)?.thumb) }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(alignment: .topLeading) {
                    if let badge {
                        Text(badge).font(.caption2).foregroundStyle(.white)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(RoundedRectangle(cornerRadius: 4).fill(Color.black.opacity(0.6))).padding(4)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    overlayButton("xmark", help: "Usuń zdjęcie") { updateBlock(block.id) { $0.photos.removeAll { $0.id == photo.id } } }.padding(4)
                }
                .draggable(ShowcaseDrag.photo + key) {
                    SocialImageView(url: store.url(photo.key)?.thumb).frame(width: 120, height: 90).clipShape(RoundedRectangle(cornerRadius: 6))
                }
            TextField("Podpis (opcjonalnie)", text: caption).textFieldStyle(.roundedBorder).font(.caption)
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(targeted ? 0.14 : 0.04)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(targeted ? theme.accent : Color.clear, lineWidth: 1.5))
        .onDrop(of: ShowcaseDrag.types, isTargeted: Binding(
            get: { photoTarget == key },
            set: { inside in if inside { photoTarget = key } else if photoTarget == key { photoTarget = nil } }
        )) { providers in
            photoTarget = nil
            ShowcaseDrag.read(providers) { text in
                guard let value = ShowcaseDrag.value(text, ShowcaseDrag.photo + block.id + ":") else { return }
                updateBlock(block.id) { item in
                    guard let from = item.photos.firstIndex(where: { $0.id == value }), let to = item.photos.firstIndex(where: { $0.id == photo.id }) else { return }
                    item.photos = ShowcaseShared.move(item.photos, from: from, to: to)
                }
            }
            return true
        }
    }

    // MARK: Wiersze (punkty, specyfikacja, pytania)
    private func rowsEditor(_ block: ShowcaseBlock) -> some View {
        let labels = block.kind.rowLabels
        let addLabel: String = block.kind == .faq ? "Dodaj pytanie" : (block.kind == .specs ? "Dodaj parametr" : "Dodaj punkt")
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(block.rows) { row in rowEditor(row, block: block, labels: labels) }
            Button {
                updateBlock(block.id) { $0.rows.append(ShowcaseRow()) }
            } label: { Label(addLabel, systemImage: "plus") }
                .disabled(block.rows.count >= ShowcaseLimits.rows)
        }
    }

    private func rowEditor(_ row: ShowcaseRow, block: ShowcaseBlock, labels: (String, String)) -> some View {
        let key = "\(block.id):\(row.id)"
        let targeted = rowTarget == key
        func rowField(_ keyPath: WritableKeyPath<ShowcaseRow, String>, _ max: Int) -> Binding<String> {
            Binding(
                get: { store.drafts[id]?.content.blocks.first { $0.id == block.id }?.rows.first { $0.id == row.id }?[keyPath: keyPath] ?? "" },
                set: { value in
                    updateBlock(block.id) { item in
                        if let index = item.rows.firstIndex(where: { $0.id == row.id }) { item.rows[index][keyPath: keyPath] = String(value.prefix(max)) }
                    }
                }
            )
        }
        return HStack(alignment: .top, spacing: 6) {
            Image(systemName: "line.3.horizontal").foregroundStyle(.secondary).frame(width: 16, height: 22)
                .contentShape(Rectangle())
                .draggable(ShowcaseDrag.row + key) { Text(row.title.isEmpty ? "Wiersz" : row.title).padding(6).background(RoundedRectangle(cornerRadius: 6).fill(theme.card)) }
                .help("Przeciągnij, żeby zmienić kolejność")
            VStack(alignment: .leading, spacing: 4) {
                TextField(labels.0, text: rowField(\.title, ShowcaseLimits.rowTitle)).textFieldStyle(.roundedBorder)
                TextField(labels.1, text: rowField(\.text, ShowcaseLimits.rowText), axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...4)
            }
            Button { updateBlock(block.id) { $0.rows.removeAll { $0.id == row.id } } } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless).help("Usuń wiersz")
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 6).fill(targeted ? theme.accent.opacity(0.12) : Color.clear))
        .onDrop(of: ShowcaseDrag.types, isTargeted: Binding(
            get: { rowTarget == key },
            set: { inside in if inside { rowTarget = key } else if rowTarget == key { rowTarget = nil } }
        )) { providers in
            rowTarget = nil
            ShowcaseDrag.read(providers) { text in
                guard let value = ShowcaseDrag.value(text, ShowcaseDrag.row + block.id + ":") else { return }
                updateBlock(block.id) { item in
                    guard let from = item.rows.firstIndex(where: { $0.id == value }), let to = item.rows.firstIndex(where: { $0.id == row.id }) else { return }
                    item.rows = ShowcaseShared.move(item.rows, from: from, to: to)
                }
            }
            return true
        }
    }

    // MARK: Z katalogu produktów
    private func catalogEditor(_ block: ShowcaseBlock, detail: ShowcaseDetail, draft: ShowcaseDraft) -> some View {
        let product = detail.products.first { $0.id == block.productId }
        return VStack(alignment: .leading, spacing: 6) {
            if draft.productIDs.isEmpty {
                Button { listPicker = .products } label: { Label("Dodaj produkt z katalogu do karty", systemImage: "shippingbox") }
            } else {
                Picker("Produkt", selection: Binding<String>(
                    get: { block.productId ?? "" },
                    set: { value in updateBlock(block.id) { $0.productId = value.isEmpty ? nil : value } }
                )) {
                    Text("Wybierz produkt karty…").tag("")
                    ForEach(draft.productIDs, id: \.self) { productID in Text(store.productNames[productID] ?? "Produkt").tag(productID) }
                }
                .frame(maxWidth: 420)
            }
            if block.productId != nil && product == nil {
                Text("Dane produktu (warianty, ceny, przygotowanie) pojawią się po zapisaniu karty.").font(.caption).foregroundStyle(.secondary)
            }
            if let product {
                let ok = ShowcaseShared.catalogHasContent(product, style: block.style)
                Text(catalogSummary(product, style: block.style)).font(.caption).foregroundStyle(ok ? Color.secondary : Color.orange)
            }
        }
    }

    private func catalogSummary(_ product: ShowcaseProduct, style: String) -> String {
        func count(_ value: Int, _ one: String, _ few: String, _ many: String) -> String { "\(value) \(ShowcaseShared.plural(value, one, few, many))" }
        switch style {
        case "variants":
            return product.variants.isEmpty ? "Produkt nie ma wariantów w katalogu — blok się nie pokaże." : "Z katalogu: \(count(product.variants.count, "wariant", "warianty", "wariantów")) (zdjęcia, opisy, ceny)."
        case "benefits":
            return product.benefits.isEmpty ? "Produkt nie ma korzyści w katalogu — blok się nie pokaże." : "Z katalogu: \(count(product.benefits.count, "korzyść", "korzyści", "korzyści"))."
        case "packages":
            return product.packages.isEmpty ? "Produkt nie ma pakietów sprzedażowych — blok się nie pokaże." : "Z katalogu: \(count(product.packages.count, "pakiet", "pakiety", "pakietów"))."
        default:
            var parts: [String] = []
            if !product.requirements.isEmpty { parts.append(count(product.requirements.count, "wymaganie", "wymagania", "wymagań")) }
            if let hours = product.setupHours { parts.append("montaż \(ShowcaseShared.hours(hours)) h") }
            if !product.preparation.isEmpty { parts.append(count(product.preparation.count, "ustalenie z obiektem", "ustalenia z obiektem", "ustaleń z obiektem")) }
            return parts.isEmpty ? "Produkt nie ma wymagań ani czasu montażu w katalogu — blok się nie pokaże." : "Z katalogu: \(parts.joined(separator: ", "))."
        }
    }

    // MARK: Realizacje ze strony
    private func refsEditor(_ block: ShowcaseBlock) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                ForEach(block.refs, id: \.self) { ref in refTile(ref, block: block) }
            }
            Button { listPicker = .realizations(block.id) } label: { Label("Dodaj realizacje ze strony", systemImage: "plus") }
                .disabled(block.refs.count >= ShowcaseLimits.refs)
        }
    }

    private func refTile(_ ref: String, block: ShowcaseBlock) -> some View {
        let info = store.realizationInfo[ref]
        let key = "\(block.id):\(ref)"
        let targeted = photoTarget == key
        return VStack(alignment: .leading, spacing: 4) {
            Color.clear.aspectRatio(4.0 / 3.0, contentMode: .fit)
                .overlay { SocialImageView(url: info?.thumb) }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(alignment: .topTrailing) {
                    overlayButton("xmark", help: "Usuń realizację") { updateBlock(block.id) { $0.refs.removeAll { $0 == ref } } }.padding(4)
                }
                .draggable(ShowcaseDrag.ref + key) { Text(info?.title ?? "Realizacja").padding(6).background(RoundedRectangle(cornerRadius: 6).fill(theme.card)) }
            Text(info?.title ?? "Realizacja").font(.caption).lineLimit(1)
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(targeted ? 0.14 : 0.04)))
        .onDrop(of: ShowcaseDrag.types, isTargeted: Binding(
            get: { photoTarget == key },
            set: { inside in if inside { photoTarget = key } else if photoTarget == key { photoTarget = nil } }
        )) { providers in
            photoTarget = nil
            ShowcaseDrag.read(providers) { text in
                guard let value = ShowcaseDrag.value(text, ShowcaseDrag.ref + block.id + ":") else { return }
                updateBlock(block.id) { item in
                    guard let from = item.refs.firstIndex(of: value), let to = item.refs.firstIndex(of: ref) else { return }
                    item.refs = ShowcaseShared.move(item.refs, from: from, to: to)
                }
            }
            return true
        }
    }

    // MARK: Kolumna boczna
    private func aside(_ detail: ShowcaseDetail, _ draft: ShowcaseDraft, jump: @escaping (String, String?) -> Void) -> some View {
        let checks = ShowcaseShared.checklist(title: draft.title, productIDs: draft.productIDs, content: draft.content, products: detail.products)
        let missing = checks.filter { !$0.ok }.count
        return VStack(spacing: 14) {
            card(nil) {
                HStack {
                    Label("Produkty z katalogu", systemImage: "shippingbox").font(.headline)
                    Spacer()
                    Button("Dodaj") { listPicker = .products }.disabled(draft.productIDs.count >= ShowcaseLimits.products)
                }
                ForEach(Array(draft.productIDs.enumerated()), id: \.element) { entry in productRow(entry.element, main: entry.offset == 0) }
                if draft.productIDs.isEmpty {
                    Text("Powiąż produkty — warianty, ceny, pakiety i przygotowanie zaciągną się z Oferty → Produkty.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .id("showcase-field-products")
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(highlight == "products" ? theme.accent : Color.clear, lineWidth: 2))
            card(nil) {
                Label("Lista kontrolna", systemImage: missing > 0 ? "exclamationmark.triangle" : "checkmark.seal")
                    .font(.headline).foregroundStyle(missing > 0 ? Color.orange : Color.green)
                ForEach(checks) { check in
                    Button { jump(check.key, check.blockID) } label: {
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: check.ok ? "checkmark.circle.fill" : "circle.dashed").foregroundStyle(check.ok ? Color.green : Color.orange)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(check.label).font(.callout).foregroundStyle(check.ok ? Color.secondary : Color.primary)
                                if !check.ok { Text(check.hint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Przejdź do pola")
                }
            }
        }
    }

    private func productRow(_ productID: String, main: Bool) -> some View {
        let targeted = productTarget == productID
        let name = store.productNames[productID] ?? "Produkt"
        return HStack(spacing: 6) {
            Image(systemName: "line.3.horizontal").foregroundStyle(.secondary)
                .draggable(ShowcaseDrag.product + productID) { Text(name).padding(6).background(RoundedRectangle(cornerRadius: 6).fill(theme.card)) }
                .help("Przeciągnij, żeby zmienić kolejność")
            Text(name).font(.callout).lineLimit(1)
            if main { Text("(główny)").font(.caption2).foregroundStyle(.secondary) }
            Spacer(minLength: 4)
            Button { state.openCRM("/crm/offers/products/\(productID)") } label: { Image(systemName: "arrow.up.right.square") }
                .buttonStyle(.borderless).help("Karta produktu w CRM")
            Button { mutate { $0.productIDs.removeAll { $0 == productID } } } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless).help("Usuń z karty")
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 6).fill(targeted ? theme.accent.opacity(0.14) : Color.primary.opacity(0.04)))
        .onDrop(of: ShowcaseDrag.types, isTargeted: Binding(
            get: { productTarget == productID },
            set: { inside in if inside { productTarget = productID } else if productTarget == productID { productTarget = nil } }
        )) { providers in
            productTarget = nil
            ShowcaseDrag.read(providers) { text in
                guard let value = ShowcaseDrag.value(text, ShowcaseDrag.product) else { return }
                mutate { draft in
                    guard let from = draft.productIDs.firstIndex(of: value), let to = draft.productIDs.firstIndex(of: productID) else { return }
                    draft.productIDs = ShowcaseShared.move(draft.productIDs, from: from, to: to)
                }
            }
            return true
        }
    }

    // MARK: Czynności
    private func moveBlock(_ draggedID: String, to targetID: String) {
        guard draggedID != targetID else { return }
        mutate { draft in
            guard let from = draft.content.blocks.firstIndex(where: { $0.id == draggedID }),
                  let to = draft.content.blocks.firstIndex(where: { $0.id == targetID }) else { return }
            draft.content.blocks = ShowcaseShared.move(draft.content.blocks, from: from, to: to)
        }
    }

    private func removeBlock(_ block: ShowcaseBlock) {
        if block.isBlank { mutate { $0.content.blocks.removeAll { $0.id == block.id } } } else { blockToRemove = block }
    }

    private func addPhotos(_ photos: [ShowcaseMedia], to target: ShowcasePhotoTarget) {
        guard !photos.isEmpty else { return }
        switch target {
        case .hero:
            mutate { $0.content.hero = photos[0] }
        case .block(let blockID):
            updateBlock(blockID) { block in
                let known = Set(block.photos.map(\.key))
                let fresh = photos.filter { !known.contains($0.key) }
                block.photos = Array((block.photos + fresh).prefix(ShowcaseLimits.photos))
            }
        }
    }

    private func uploadFiles(_ urls: [URL], to target: ShowcasePhotoTarget) async {
        let files: [URL] = target == .hero ? Array(urls.prefix(1)) : urls
        let replies = await store.upload(files, target: .item(id))
        addPhotos(replies.map(\.photo), to: target)
    }

    /// Zdjęcia przeciągnięte z innych aplikacji (Finder, Zdjęcia, Safari, Poczta).
    private func accept(_ providers: [NSItemProvider], to target: ShowcasePhotoTarget) {
        Task {
            let urls = await PortfolioDrop.files(providers)
            guard !urls.isEmpty else {
                state.error = "Nie udało się odczytać przeciągniętego zdjęcia. Przeciągnij plik JPEG, PNG, WebP albo HEIC."
                return
            }
            await uploadFiles(urls, to: target)
            PortfolioDrop.cleanup(urls)
        }
    }

    private func chooseFiles(single: Bool, _ handle: @escaping ([URL]) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = !single
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP, .heic, .heif, .tiff]
        panel.prompt = "Dodaj do karty"
        guard panel.runModal() == .OK else { return }
        handle(panel.urls)
    }

    private func flash(_ key: String) {
        highlightTask?.cancel()
        highlight = key
        highlightTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(2000))
            if Task.isCancelled { return }
            highlight = nil
        }
    }

    /// Lista kontrolna → pole albo blok (przewinięcie i podświetlenie).
    private func jump(_ key: String, blockID: String?, _ proxy: ScrollViewProxy) {
        let target: String
        if let blockID { target = "showcase-block-\(blockID)" }
        else if key == "photos" { target = draftFirstPhotosBlock().map { "showcase-block-\($0)" } ?? "showcase-field-hero" }
        else { target = "showcase-field-\(key)" }
        withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(target, anchor: .center) }
        flash(blockID.map { "block-\($0)" } ?? (key == "photos" ? (draftFirstPhotosBlock().map { "block-\($0)" } ?? "hero") : key))
    }

    private func draftFirstPhotosBlock() -> String? {
        store.drafts[id]?.content.blocks.first { $0.kind == .photos }?.id
    }
}
