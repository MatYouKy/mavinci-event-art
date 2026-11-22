import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Strefa sprzedawcy → „Prezentacje” — 1:1 z `/crm/presentations`: działy (kolejność przeciąganiem, edycja, okładka), karty
// działu (kolejność przeciąganiem; karta upuszczona na inny dział przechodzi do niego), wyszukiwanie we wszystkich kartach,
// edytor karty obok (`ShowcaseEditorView`) i podgląd jak na iPadzie (`ShowcasePreviewSheet`). Osoby z samym podglądem otwierają
// karty w podglądzie — tak, jak zobaczy je klient na spotkaniu. Pełna szerokość okna (MacBook Air 13" i Pro 16").

/// Przeciąganie w obrębie Prezentacji: tekst z prefiksem i identyfikatorem (dział, karta, blok, wiersz, zdjęcie, produkt).
enum ShowcaseDrag {
    static let types: [UTType] = [.utf8PlainText, .plainText]
    static let section = "mavinci-showcase-section:"
    static let item = "mavinci-showcase-item:"
    static let block = "mavinci-showcase-block:"
    static let row = "mavinci-showcase-row:"
    static let photo = "mavinci-showcase-photo:"
    static let product = "mavinci-showcase-product:"
    static let ref = "mavinci-showcase-ref:"

    /// Tekst przeciąganego elementu (z prefiksem) — obsługa na wątku głównym.
    static func read(_ providers: [NSItemProvider], _ handle: @escaping @MainActor (String) -> Void) {
        guard let provider = providers.first(where: { $0.canLoadObject(ofClass: NSString.self) }) else { return }
        _ = provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let value = object as? NSString else { return }
            let text = value as String
            Task { @MainActor in handle(text) }
        }
    }

    static func value(_ text: String, _ prefix: String) -> String? {
        text.hasPrefix(prefix) ? String(text.dropFirst(prefix.count)) : nil
    }
}

@MainActor struct ShowcaseView: View {
    @ObservedObject var store: ShowcaseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var sectionTarget: String?
    @State private var itemTarget: String?
    @State private var helpShown = false

    var body: some View {
        content
            .navigationTitle("Prezentacje")
            .navigationSubtitle("Strefa sprzedawcy")
            .task(id: state.employee?.id) { await store.load(quiet: store.home != nil) }
            .sheet(item: $store.sectionSheet) { draft in
                ShowcaseSectionSheet(store: store, draft: draft).environmentObject(state).environment(\.crmTheme, theme)
            }
            .sheet(isPresented: $store.creating) {
                ShowcaseCreateSheet(store: store).environmentObject(state).environment(\.crmTheme, theme)
            }
            .sheet(item: $store.preview) { request in
                ShowcasePreviewSheet(store: store, request: request).environmentObject(state).environment(\.crmTheme, theme)
            }
            .sheet(isPresented: $helpShown) {
                ShowcaseHelpSheet(store: store).environmentObject(state).environment(\.crmTheme, theme)
            }
    }

    @ViewBuilder private var content: some View {
        if let home = store.home {
            main(home)
        } else if let error = store.loadError {
            ContentUnavailableView {
                Label("Prezentacje", systemImage: "ipad.landscape")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.load() } }
            }
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func main(_ home: ShowcaseHome) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            header(home)
            HStack(alignment: .top, spacing: 14) {
                sectionsColumn(home).frame(width: 240)
                itemsColumn(home).frame(width: 300)
                Group {
                    if home.access.manage, let id = store.openedID {
                        ShowcaseEditorView(store: store, id: id).id(id)
                    } else {
                        placeholder(home)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func header(_ home: ShowcaseHome) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Strefa sprzedawcy", systemImage: "person.crop.circle.badge.checkmark").font(.callout).foregroundStyle(theme.accent)
                HStack(spacing: 6) {
                    Text("Prezentacje").font(.title.weight(.light))
                    Button { helpShown = true } label: { Image(systemName: "questionmark.circle").font(.title3) }
                        .buttonStyle(.borderless).foregroundStyle(theme.accent)
                        .help("Instrukcja: jak przygotować treściwą prezentację (z przykładem)")
                }
                Text("Materiały na spotkania z klientami: jak to wygląda, korzyści, galeria, przygotowanie.")
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
            }
            .layoutPriority(1)
            Spacer(minLength: 16)
            if store.loading { ProgressView().controlSize(.small) }
            if let offline = store.offlineState { offlineBadge(offline) }
            Button { store.preview = ShowcasePreviewRequest() } label: { Label("Podgląd na iPadzie", systemImage: "ipad.landscape") }
            Button { Task { await store.load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
            if home.layout != nil {
                Button { Task { await store.resetLayout() } } label: { Label("Układ domyślny", systemImage: "arrow.counterclockwise") }
                    .help("Kolejność ustalona przy przygotowaniu, bez działów i kart ukrytych u Ciebie")
            }
            if home.access.manage {
                Button { store.sectionSheet = ShowcaseSectionDraft(nil) } label: { Label("Nowy dział", systemImage: "folder.badge.plus") }
                Button { store.creating = true } label: { Label("Nowa karta", systemImage: "plus") }
                    .buttonStyle(.borderedProminent).disabled(store.selectedSection == nil)
            }
        }
    }

    /// Zapis prezentacji na dysku (karty i zdjęcia) — podgląd pokazu działa bez internetu.
    @ViewBuilder private func offlineBadge(_ offline: ShowcaseOfflineState) -> some View {
        if offline.saving {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Na dysk \(min(offline.done, offline.total))/\(offline.total)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            .help(offline.label)
        } else {
            Label(offline.failed == 0 ? "Na dysku" : "Częściowo na dysku", systemImage: offline.failed == 0 ? "checkmark.circle" : "exclamationmark.triangle")
                .font(.caption).foregroundStyle(offline.failed == 0 ? Color.secondary : Color.orange)
                .help(offline.label)
        }
    }

    // MARK: Działy
    private func sectionsColumn(_ home: ShowcaseHome) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("DZIAŁY").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).padding(.leading, 4)
            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(store.sections) { section in sectionRow(section, manage: home.access.manage) }
                }
            }
            if store.sections.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Zacznij od działów, np. „Ekrany LED”, „Scena i technika”, „Atrakcje”.").font(.callout).foregroundStyle(.secondary)
                    if home.access.manage {
                        Button { store.sectionSheet = ShowcaseSectionDraft(nil) } label: { Label("Nowy dział", systemImage: "plus") }.buttonStyle(.borderedProminent)
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
            } else {
                Text("Kolejność działów i kart (przeciąganie) i „Ukryj u mnie” (menu podręczne) to Twój układ — w CRM, na Macu, telefonie i iPadzie; inni widzą swój."
                     + (home.access.manage ? " Kartę przeciągniętą na dział przenosisz do niego dla wszystkich." : ""))
                    .font(.caption2).foregroundStyle(.tertiary).padding(.horizontal, 4)
            }
        }
    }

    private func sectionRow(_ section: ShowcaseSection, manage: Bool) -> some View {
        let selected = store.selectedSection?.id == section.id && store.query.isEmpty
        let count = store.items(in: section.id).count
        let countText = "\(count) \(ShowcaseShared.plural(count, "karta", "karty", "kart"))" + (section.isActive ? "" : " · ukryty dla wszystkich")
            + (section.hiddenForMe == true ? " · ukryty u Ciebie" : "")
        let targeted = sectionTarget == section.id
        return HStack(spacing: 8) {
            Image(systemName: ShowcaseIconInfo.symbol(section.icon))
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 7).fill(theme.accent.opacity(0.12)))
                .foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 1) {
                Text(section.title).font(.callout).lineLimit(1)
                Text(countText).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            if !section.isActive { Image(systemName: "eye.slash").font(.caption).foregroundStyle(.secondary) }
            Button { Task { await store.setHidden(section: section.id, section.hiddenForMe != true) } } label: {
                Image(systemName: section.hiddenForMe == true ? "eye.slash.circle" : "eye.circle")
            }
            .buttonStyle(.borderless).foregroundStyle(.secondary)
            .help(section.hiddenForMe == true ? "Pokaż u mnie" : "Ukryj u mnie (inni widzą swój układ)")
            if manage {
                Button { store.sectionSheet = ShowcaseSectionDraft(section) } label: { Image(systemName: "pencil") }
                    .buttonStyle(.borderless).help("Edytuj dział")
            }
        }
        .opacity(section.hiddenForMe == true ? 0.5 : 1)
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 10).fill(selected ? theme.card : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(targeted ? theme.accent : (selected ? theme.accent.opacity(0.6) : Color.clear), lineWidth: targeted ? 2 : 1))
        .contentShape(Rectangle())
        .onTapGesture { store.query = ""; store.sectionID = section.id }
        // Kolejność działów — własny układ każdego pracownika; karta upuszczona na dział — przeniesienie (przygotowanie).
        .modifier(ShowcaseDraggable(enabled: true, value: ShowcaseDrag.section + section.id))
        .onDrop(of: ShowcaseDrag.types, isTargeted: Binding(
            get: { sectionTarget == section.id },
            set: { inside in if inside { sectionTarget = section.id } else if sectionTarget == section.id { sectionTarget = nil } }
        )) { providers in
            sectionTarget = nil
            ShowcaseDrag.read(providers) { text in dropOnSection(text, section) }
            return true
        }
        .contextMenu {
            Button(section.hiddenForMe == true ? "Pokaż u mnie" : "Ukryj u mnie") { Task { await store.setHidden(section: section.id, section.hiddenForMe != true) } }
            if manage { Button("Edytuj dział…") { store.sectionSheet = ShowcaseSectionDraft(section) } }
        }
    }

    private func dropOnSection(_ text: String, _ section: ShowcaseSection) {
        if let itemID = ShowcaseDrag.value(text, ShowcaseDrag.item) {
            guard store.canManage else { return }
            Task { await store.moveItem(itemID, toSection: section) }
        } else if let sectionID = ShowcaseDrag.value(text, ShowcaseDrag.section), sectionID != section.id {
            let ids = store.sections.map(\.id)
            guard let from = ids.firstIndex(of: sectionID), let to = ids.firstIndex(of: section.id) else { return }
            Task { await store.reorderSections(ShowcaseShared.move(ids, from: from, to: to)) }
        }
    }

    // MARK: Karty
    private func itemsColumn(_ home: ShowcaseHome) -> some View {
        let searching = !store.query.trimmingCharacters(in: .whitespaces).isEmpty
        let items: [ShowcaseItemSummary] = searching ? store.searchResults : (store.selectedSection.map { store.items(in: $0.id) } ?? [])
        return VStack(alignment: .leading, spacing: 8) {
            TextField("Szukaj we wszystkich kartach", text: $store.query).textFieldStyle(.roundedBorder)
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(items) { item in itemRow(item, manage: !searching, searching: searching) }
                    if items.isEmpty && store.selectedSection != nil {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(searching ? "Brak kart pasujących do wyszukiwania." : "Ten dział nie ma jeszcze kart.").font(.callout).foregroundStyle(.secondary)
                            if home.access.manage && !searching {
                                Button { store.creating = true } label: { Label("Nowa karta", systemImage: "plus") }.buttonStyle(.borderedProminent)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
                    }
                }
            }
        }
    }

    private func itemRow(_ item: ShowcaseItemSummary, manage: Bool, searching: Bool) -> some View {
        let opened = store.openedID == item.id
        let unsaved = store.dirty(item.id)
        let targeted = itemTarget == item.id
        let sectionName: String = searching ? (store.sections.first { $0.id == item.sectionId }?.title ?? "") : ""
        return HStack(alignment: .top, spacing: 10) {
            Color.clear.frame(width: 76, height: 58)
                .overlay {
                    if let thumb = store.url(item.thumbKey)?.thumb { SocialImageView(url: thumb) } else {
                        Rectangle().fill(Color.primary.opacity(0.06)).overlay(Image(systemName: "photo").foregroundStyle(theme.accent.opacity(0.4)))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(item.title).font(.callout).lineLimit(2)
                    Spacer(minLength: 2)
                    if !item.isActive { Image(systemName: "eye.slash").font(.caption2).foregroundStyle(.secondary).help("Ukryta — nie pokazuje się na spotkaniach") }
                }
                if !item.tagline.isEmpty { Text(item.tagline).font(.caption2).foregroundStyle(theme.accent).lineLimit(1) }
                HStack(spacing: 6) {
                    if !item.productNames.isEmpty {
                        Label(item.productNames.joined(separator: ", "), systemImage: "shippingbox").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    if store.canManage && item.problems > 0 {
                        Label("\(item.problems)", systemImage: "exclamationmark.triangle").font(.caption2).foregroundStyle(.orange).help("Do uzupełnienia: \(item.problems)")
                    }
                    if unsaved { Label("niezapisane", systemImage: "circle.fill").font(.caption2).foregroundStyle(theme.accent) }
                }
                if !sectionName.isEmpty { Text(sectionName).font(.caption2).foregroundStyle(.tertiary) }
                if item.hiddenForMe == true { Text("Ukryta u Ciebie — nie pokazuje się na Twoich spotkaniach").font(.caption2).foregroundStyle(.secondary) }
            }
        }
        .opacity(item.hiddenForMe == true ? 0.5 : 1)
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(targeted ? theme.accent : (opened ? theme.accent.opacity(0.7) : Color.clear), lineWidth: targeted ? 2 : 1.5))
        .contentShape(Rectangle())
        .onTapGesture { open(item) }
        .modifier(ShowcaseDraggable(enabled: manage, value: ShowcaseDrag.item + item.id))
        .onDrop(of: ShowcaseDrag.types, isTargeted: Binding(
            get: { itemTarget == item.id },
            set: { inside in if inside { itemTarget = item.id } else if itemTarget == item.id { itemTarget = nil } }
        )) { providers in
            guard manage else { return false }
            itemTarget = nil
            ShowcaseDrag.read(providers) { text in dropOnItem(text, item) }
            return true
        }
        .contextMenu {
            Button("Podgląd na iPadzie") { store.preview = ShowcasePreviewRequest(sectionID: item.sectionId, itemID: item.id) }
            Button(item.hiddenForMe == true ? "Pokaż u mnie" : "Ukryj u mnie") { Task { await store.setHidden(item: item.id, item.hiddenForMe != true) } }
            if store.canManage {
                Button("Kopia karty") { Task { await store.duplicateItem(item.id) } }
            }
        }
    }

    private func open(_ item: ShowcaseItemSummary) {
        if store.canManage {
            store.sectionID = item.sectionId
            store.openedID = item.id
        } else {
            store.preview = ShowcasePreviewRequest(sectionID: item.sectionId, itemID: item.id)
        }
    }

    /// Karta upuszczona na kartę: to miejsce w dziale — kolejność w układzie pracownika; karta z innego działu przechodzi do tego
    /// działu dla wszystkich (tylko przygotowanie prezentacji).
    private func dropOnItem(_ text: String, _ target: ShowcaseItemSummary) {
        guard let draggedID = ShowcaseDrag.value(text, ShowcaseDrag.item), draggedID != target.id else { return }
        var ids = store.items(in: target.sectionId).map(\.id)
        if let from = ids.firstIndex(of: draggedID), let to = ids.firstIndex(of: target.id) {
            ids = ShowcaseShared.move(ids, from: from, to: to)
            Task { await store.reorderItems(sectionID: target.sectionId, ids: ids, success: "Zmieniono kolejność kart w Twoim układzie") }
        } else if let to = ids.firstIndex(of: target.id), store.canManage {
            ids.insert(draggedID, at: to)
            Task { await store.moveItems(sectionID: target.sectionId, ids: ids, success: "Przeniesiono kartę do działu") }
        }
    }

    private func placeholder(_ home: ShowcaseHome) -> some View {
        let message: String = home.access.manage
            ? "Wybierz kartę z listy albo utwórz nową — pustą albo z produktu z katalogu (opis, korzyści, warianty, przygotowanie zaciągną się same)."
            : "Wybierz kartę — otworzy się tak, jak zobaczy ją klient na spotkaniu. Przygotowanie prezentacji: uprawnienie „Prezentacje — przygotowanie”."
        return VStack(spacing: 12) {
            Image(systemName: "ipad.landscape").font(.system(size: 40)).foregroundStyle(theme.accent.opacity(0.5))
            Text(message)
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 520)
            if home.access.manage && store.selectedSection != nil {
                Button { store.creating = true } label: { Label("Nowa karta", systemImage: "plus") }.buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 320)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }
}

/// Przeciąganie elementu listy (kolejność we własnym układzie; przenoszenie kart między działami — przygotowanie prezentacji).
struct ShowcaseDraggable: ViewModifier {
    let enabled: Bool
    let value: String
    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.draggable(value)
        } else {
            content
        }
    }
}
