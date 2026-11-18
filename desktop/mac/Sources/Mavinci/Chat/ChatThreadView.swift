import SwiftUI
import AppKit
import Combine
import UniformTypeIdentifiers
import AVKit
import PDFKit

// MARK: Rozmowa w komunikatorze (jak `ChatConversationView` w CRM): 20 ostatnich wiadomości i starsze przy przewinięciu
// do góry, separatory dni, dymki (w grupie z nadawcą i awatarem), załączniki (zdjęcie z podglądem i pobieraniem, film, PDF,
// pliki), reakcje (6 emoji, także na cudze wiadomości; usuwanie własnej), „pisze…”, status ostatniej własnej wiadomości
// (Wysłano / Dostarczono / Wyświetlono z godziną albo listą osób), miniatury osób pod ostatnią przeczytaną wiadomością,
// zaznaczanie i usuwanie wiadomości „tylko u mnie”, wysyłka Enterem (⇧↩ / ⌥↩ — nowa linia), plik przyciskiem albo przeciągnięty.

@MainActor final class ChatThreadModel: ObservableObject {
    let conversationID: String
    let me: String
    let paneID = UUID()
    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var loading = true
    @Published private(set) var loadingOlder = false
    @Published private(set) var hasOlder = true
    @Published private(set) var markers: [String: ChatMarker]
    @Published private(set) var typing: [String: Date] = [:]
    @Published private(set) var deleted: Set<String>
    @Published var error: String?
    /// Nowa wiadomość od innej osoby — widok zapisuje odczyt.
    var onIncoming: (() -> Void)?
    private weak var store: ChatStore?
    private var subscription: AnyCancellable?
    private var ticker: Task<Void, Never>?
    private var deletedKey: String { "chat_deleted_\(me)" }

    init(conversationID: String, me: String, markers: [String: ChatMarker]) {
        self.conversationID = conversationID
        self.me = me
        self.markers = markers
        // Usunięte „tylko u mnie” — na tym Macu, jak `chat_deleted_<pracownik>` w przeglądarce.
        deleted = Set(UserDefaults.standard.stringArray(forKey: "chat_deleted_\(me)") ?? [])
    }

    var visible: [ChatMessage] { messages.filter { !deleted.contains($0.id) } }
    var typingIDs: [String] { typing.keys.sorted() }

    func attach(_ store: ChatStore) {
        guard self.store == nil else { return }
        self.store = store
        subscription = store.events.sink { [weak self] event in self?.handle(event) }
        ticker = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
                guard let self else { return }
                self.expireTyping()
                tick += 1
                // Bez połączenia na żywo — nowe wiadomości i znaczniki co 4 s.
                if tick % 4 == 0, let store = self.store, !store.live {
                    await self.fetchNewer()
                    await self.refreshMarkers()
                }
            }
        }
    }

    func detach() {
        subscription = nil
        ticker?.cancel()
        ticker = nil
        onIncoming = nil
    }

    private func handle(_ event: ChatEvent) {
        switch event {
        case .inserted(let message):
            guard message.conversationID == conversationID else { return }
            let fresh = !messages.contains { $0.id == message.id }
            insert([message])
            typing[message.senderID] = nil
            if fresh && message.senderID != me { onIncoming?() }
        case .updated(let message):
            guard message.conversationID == conversationID, let index = messages.firstIndex(where: { $0.id == message.id }) else { return }
            messages[index] = message
        case .marker(let conversation, let employee, let marker):
            guard conversation == conversationID else { return }
            markers[employee] = marker
        case .typing(let conversation, let employee):
            guard conversation == conversationID else { return }
            typing[employee] = Date()
        case .refresh(let conversation):
            guard conversation == conversationID else { return }
            Task { await self.fetchNewer(); await self.refreshMarkers() }
        }
    }

    private func insert(_ items: [ChatMessage]) {
        var byID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        for item in items { byID[item.id] = item }
        messages = byID.values.sorted { $0.created == $1.created ? $0.id < $1.id : $0.created < $1.created }
    }

    private func expireTyping() {
        let now = Date()
        let alive = typing.filter { now.timeIntervalSince($0.value) < ChatRules.typingVisible }
        if alive.count != typing.count { typing = alive }
    }

    func load() async {
        guard let store else { return }
        loading = true
        do {
            let page = try await store.messages(conversationID)
            insert(page)
            hasOlder = page.count == ChatRules.pageSize
            if let fresh = try? await store.markers(conversationID) { markers = fresh }
            error = nil
        } catch {
            self.error = "Nie udało się wczytać wiadomości."
        }
        loading = false
    }

    /// Starsze wiadomości; zwraca wiadomość, przy której zostaje widok.
    func loadOlder() async -> String? {
        guard let store, !loading, !loadingOlder, hasOlder, let first = messages.first else { return nil }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page = try await store.messages(conversationID, before: first.created)
            hasOlder = page.count == ChatRules.pageSize
            insert(page)
            return first.id
        } catch {
            return nil
        }
    }

    func fetchNewer() async {
        guard let store, !loading else { return }
        guard let last = messages.last else { await load(); return }
        guard let page = try? await store.messages(conversationID, after: last.created), !page.isEmpty else { return }
        let known = Set(messages.map(\.id))
        insert(page)
        if page.contains(where: { !known.contains($0.id) && $0.senderID != me }) { onIncoming?() }
    }

    func refreshMarkers() async {
        if let fresh = try? await store?.markers(conversationID) { markers = fresh }
    }

    func send(conversation: ChatConversation, text: String, file: URL?) async -> Bool {
        guard let store else { return false }
        do {
            let message = try await store.send(conversation, text: text, file: file)
            insert([message])
            store.resetTyping(conversationID)
            error = nil
            return true
        } catch {
            self.error = (error as? ChatError)?.message ?? (error is URLError ? "Brak połączenia — wiadomość nie została wysłana." : "Nie udało się wysłać wiadomości.")
            return false
        }
    }

    /// Reakcja od razu na ekranie; po błędzie wraca poprzednia.
    func react(_ messageID: String, emoji: String?) async {
        guard let store, let index = messages.firstIndex(where: { $0.id == messageID }) else { return }
        let previous = messages[index].reaction
        messages[index].reaction = emoji.map { ChatReaction(emoji: $0, userID: me) }
        do {
            let saved = try await store.react(messageID, emoji: emoji)
            if let i = messages.firstIndex(where: { $0.id == messageID }) { messages[i].reaction = saved }
        } catch {
            if let i = messages.firstIndex(where: { $0.id == messageID }) { messages[i].reaction = previous }
            self.error = "Nie udało się zapisać reakcji."
        }
    }

    func deleteForMe(_ ids: Set<String>) {
        deleted.formUnion(ids)
        UserDefaults.standard.set(Array(deleted), forKey: deletedKey)
    }
}

/// Osoba, która przeczytała rozmowę do danej wiadomości (miniatura pod wiadomością).
struct ChatSeen: Identifiable {
    let id: String
    let employee: ChatEmployee?
    let help: String
}

/// Podgląd załącznika (zdjęcie, film, PDF).
struct ChatPreview: Identifiable {
    enum Kind { case image, video, pdf }
    let id = UUID()
    let kind: Kind
    let url: URL
    let filename: String
}

@MainActor struct ChatThreadView: View {
    @ObservedObject var store: ChatStore
    let conversation: ChatConversation
    let me: String
    let onBack: () -> Void
    @StateObject private var model: ChatThreadModel
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var draft = ""
    @State private var pendingFile: URL?
    @State private var sending = false
    @State private var selecting = false
    @State private var selected: Set<String> = []
    @State private var pendingDelete: Set<String> = []
    @State private var importing = false
    @State private var dropping = false
    @State private var preview: ChatPreview?
    @State private var initialScrolled = false
    @FocusState private var composerFocused: Bool
    private let bottomID = "chat-bottom"

    init(store: ChatStore, conversation: ChatConversation, me: String, onBack: @escaping () -> Void) {
        _store = ObservedObject(wrappedValue: store)
        self.conversation = conversation
        self.me = me
        self.onBack = onBack
        _model = StateObject(wrappedValue: ChatThreadModel(conversationID: conversation.id, me: me, markers: conversation.markers))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if selecting { selectionBar; Divider() }
            messageList
            if let error = model.error {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.red)
                    Spacer()
                    Button { model.error = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
                }
                .padding(.horizontal, 12).padding(.vertical, 4)
            }
            if let pendingFile { pendingRow(pendingFile); Divider() }
            composer
        }
        .overlay {
            if dropping {
                VStack(spacing: 8) {
                    Image(systemName: "paperclip").font(.title2).foregroundStyle(theme.accent)
                    Text("Upuść plik, aby dodać załącznik").font(.callout.weight(.medium))
                    Text("Maksymalny rozmiar pliku: 20 MB").font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(theme.card.opacity(0.94))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(theme.accent, style: StrokeStyle(lineWidth: 2, dash: [6, 4])).padding(6))
                .allowsHitTesting(false)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in accept(providers) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
            if case .success(let url) = result { prepare(url) }
        }
        .sheet(item: $preview) { item in
            ChatPreviewSheet(item: item).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usunąć \(pendingDelete.count) wiadomości? (tylko u Ciebie)",
                            isPresented: Binding(get: { !pendingDelete.isEmpty }, set: { if !$0 { pendingDelete = [] } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                model.deleteForMe(pendingDelete)
                pendingDelete = []
                selecting = false
                selected = []
            }
            Button("Anuluj", role: .cancel) { pendingDelete = [] }
        } message: {
            Text("Pozostali uczestnicy nadal zobaczą te wiadomości.")
        }
        .task {
            model.attach(store)
            let id = conversation.id
            model.onIncoming = { [store] in
                if NSApp.isActive { Task { await store.markRead(id) } } else { Task { await store.markDelivered(id) } }
            }
            store.setVisible(model.paneID, conversation: id)
            store.joinTyping(id)
            syncRead()
            await model.load()
            composerFocused = true
        }
        .onDisappear {
            store.setVisible(model.paneID, conversation: nil)
            store.leaveTyping(conversation.id)
            model.detach()
        }
        // Powrót do aplikacji z otwartą rozmową = wyświetlenie nowych wiadomości.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in syncRead() }
    }

    private func syncRead() {
        let id = conversation.id
        if NSApp.isActive { Task { await store.markRead(id) } } else { Task { await store.markDelivered(id) } }
    }

    // MARK: Nagłówek

    private var header: some View {
        let other = conversation.other(me)
        let typingLabel = ChatRules.typingLabel(model.typingIDs.map { conversation.participantName($0) }, group: conversation.isGroup)
        let online = !conversation.isGroup && (other.map { store.isOnline($0.employeeID) } ?? false)
        return HStack(spacing: 10) {
            Button(action: onBack) { Image(systemName: "chevron.left") }.buttonStyle(.borderless).help("Wróć do listy rozmów")
            ChatAvatar(employee: other?.employee,
                       group: conversation.isGroup && (other?.employee?.avatar_url ?? "").isEmpty ? conversation.participants.count : nil,
                       size: 32, online: online)
            VStack(alignment: .leading, spacing: 1) {
                Text(conversation.name(me)).font(.callout.weight(.medium)).lineLimit(1)
                if !typingLabel.isEmpty {
                    Text(typingLabel).font(.caption2).foregroundStyle(theme.accent).lineLimit(1)
                } else {
                    Text(conversation.isGroup ? "\(conversation.participants.count) uczestników" : (online ? "Online" : "Offline"))
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Menu {
                Button("Zaznacz wiadomości", systemImage: "checkmark.circle") { selecting = true }
            } label: { Image(systemName: "ellipsis") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help("Więcej")
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private var selectionBar: some View {
        HStack {
            Button("Anuluj") { selecting = false; selected = [] }.buttonStyle(.borderless)
            Spacer()
            Text(selected.isEmpty ? "Zaznacz wiadomości do usunięcia" : "Zaznaczono: \(selected.count)").font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button(role: .destructive) { pendingDelete = selected } label: { Label("Usuń", systemImage: "trash") }
                .buttonStyle(.borderless).disabled(selected.isEmpty)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
    }

    // MARK: Wiadomości

    private var messageList: some View {
        let items = model.visible
        let heads = ChatRules.seenHeads(items, markers: model.markers, me: me)
        let lastMine = items.last { $0.senderID == me }?.id
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if model.hasOlder && !model.loading && !items.isEmpty {
                        Button(model.loadingOlder ? "Wczytywanie…" : "Pokaż starsze wiadomości") { Task { await older(proxy) } }
                            .buttonStyle(.link).font(.caption).frame(maxWidth: .infinity).padding(.vertical, 6)
                            .disabled(model.loadingOlder)
                            // Przewinięcie do góry wczytuje starsze (po pierwszym ustawieniu widoku na dole).
                            .onAppear { if initialScrolled { Task { await older(proxy) } } }
                    }
                    if model.loading && items.isEmpty {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.top, 60)
                    } else if items.isEmpty {
                        Text("Rozpocznij konwersację").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 80)
                    }
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, message in
                        row(message, previous: index > 0 ? items[index - 1] : nil, lastMine: lastMine, heads: heads[message.id] ?? [])
                            .id(message.id)
                    }
                    if !model.typingIDs.isEmpty { ChatTypingBubble().padding(.top, 8) }
                    Color.clear.frame(height: 1).id(bottomID)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
            }
            .onChange(of: model.visible.last?.id) { _, _ in
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(bottomID, anchor: .bottom) }
            }
            .onChange(of: model.loading) { _, loading in
                guard !loading else { return }
                proxy.scrollTo(bottomID, anchor: .bottom)
                Task { try? await Task.sleep(nanoseconds: 500_000_000); initialScrolled = true }
            }
            .onChange(of: model.typingIDs.isEmpty) { _, empty in
                if !empty { withAnimation { proxy.scrollTo(bottomID, anchor: .bottom) } }
            }
        }
    }

    private func older(_ proxy: ScrollViewProxy) async {
        if let anchor = await model.loadOlder() { proxy.scrollTo(anchor, anchor: .top) }
    }

    private func row(_ message: ChatMessage, previous: ChatMessage?, lastMine: String?, heads: [String]) -> some View {
        let isLastMine = message.id == lastMine
        let receipt: ChatReceipt? = isLastMine ? ChatRules.receipt(message.created, markers: model.markers, me: me) : nil
        let sender = conversation.participants.first { $0.employeeID == message.senderID }?.employee ?? store.employee(message.senderID)
        return ChatMessageRow(
            message: message, previous: previous, isGroup: conversation.isGroup, me: me,
            isLastMine: isLastMine, receipt: receipt, receiptHelp: receipt.map { receiptHelp(message, $0) } ?? "",
            seen: heads.map { id in ChatSeen(id: id, employee: conversation.participants.first { $0.employeeID == id }?.employee, help: seenHelp(id)) },
            selecting: selecting, selected: selected.contains(message.id), sender: sender,
            onToggle: { if selected.contains(message.id) { selected.remove(message.id) } else { selected.insert(message.id) } },
            onReact: { emoji in Task { await model.react(message.id, emoji: emoji) } },
            onDelete: { pendingDelete = [message.id] },
            onSelectMode: { selecting = true; selected = [message.id] },
            onOpen: { preview = $0 })
    }

    private func receiptHelp(_ message: ChatMessage, _ status: ChatReceipt) -> String {
        switch status {
        case .sent: return "Wysłano"
        case .delivered: return "Dostarczono — jeszcze nie wyświetlono"
        case .read:
            let readers = ChatRules.readers(message.created, markers: model.markers, me: me)
            if !conversation.isGroup {
                return model.markers[readers.first ?? ""]?.readAt.map { "Wyświetlono \(ChatDates.time($0))" } ?? "Wyświetlono"
            }
            return "Wyświetlili: " + readers.map { conversation.participantName($0) }.joined(separator: ", ")
        }
    }

    private func seenHelp(_ employeeID: String) -> String {
        let time = model.markers[employeeID]?.readAt.map { " \(ChatDates.time($0))" } ?? ""
        return "\(conversation.participantName(employeeID)) — wyświetlono\(time)"
    }

    // MARK: Pisanie

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || pendingFile != nil }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Button { importing = true } label: { Image(systemName: "paperclip") }
                .buttonStyle(.borderless).help("Dodaj załącznik (zdjęcie, film, PDF, dokument — do 20 MB)")
            TextField(pendingFile == nil ? "Napisz wiadomość…" : "Dodaj komentarz (opcjonalnie)…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain).lineLimit(1...6).focused($composerFocused)
                // Zapas, gdy pole samo obsłuży ↩ (podwójne wysłanie blokuje `sending`).
                .onSubmit { Task { await send() } }
                .onKeyPress(.return, phases: .down) { press in
                    // ⇧↩ i ⌥↩ — nowa linia; ↩ — wyślij (jak Enter w CRM).
                    if press.modifiers.contains(.shift) || press.modifiers.contains(.option) { return .ignored }
                    Task { await send() }
                    return .handled
                }
                .onChange(of: draft) { _, value in
                    if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { store.sendTyping(conversation.id) }
                }
            Button { Task { await send() } } label: {
                if sending { ProgressView().controlSize(.small) } else { Image(systemName: "paperplane.fill") }
            }
            .buttonStyle(.borderless).foregroundStyle(canSend ? theme.accent : Color.secondary)
            .disabled(!canSend || sending).help("Wyślij (↩)")
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .padding(10)
    }

    private func pendingRow(_ file: URL) -> some View {
        let mime = ChatRules.mime(file)
        let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return HStack(spacing: 8) {
            if mime.hasPrefix("image/"), let image = NSImage(contentsOf: file) {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fill).frame(width: 38, height: 38).clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                Image(systemName: mime.hasPrefix("video/") ? "film" : "doc.text").foregroundStyle(theme.accent)
                    .frame(width: 38, height: 38).background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(file.lastPathComponent).font(.caption).lineLimit(1)
                Text(ChatRules.fileSize(size)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Button { pendingFile = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).help("Usuń załącznik")
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
    }

    private func prepare(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= ChatRules.maxFileSize else { model.error = "Plik jest zbyt duży. Maksymalny rozmiar: 20 MB."; return }
        pendingFile = url
        model.error = nil
        composerFocused = true
    }

    private func accept(_ providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first(where: { $0.canLoadObject(ofClass: URL.self) }) else { return false }
        _ = provider.loadObject(ofClass: URL.self) { url, _ in
            guard let url, url.isFileURL else { return }
            Task { @MainActor in prepare(url) }
        }
        return true
    }

    /// Jak w CRM: pole od razu czyszczone, po błędzie tekst i plik wracają.
    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let file = pendingFile
        guard !sending, !text.isEmpty || file != nil else { return }
        sending = true
        draft = ""
        pendingFile = nil
        let ok = await model.send(conversation: conversation, text: text, file: file)
        if !ok {
            if draft.isEmpty { draft = text }
            if pendingFile == nil { pendingFile = file }
        }
        sending = false
        composerFocused = true
    }
}

// MARK: Wiadomość

@MainActor struct ChatMessageRow: View {
    let message: ChatMessage
    let previous: ChatMessage?
    let isGroup: Bool
    let me: String
    let isLastMine: Bool
    let receipt: ChatReceipt?
    let receiptHelp: String
    /// Osoby, które przeczytały rozmowę do tej wiadomości.
    let seen: [ChatSeen]
    let selecting: Bool
    let selected: Bool
    let sender: ChatEmployee?
    let onToggle: () -> Void
    let onReact: (String?) -> Void
    let onDelete: () -> Void
    let onSelectMode: () -> Void
    let onOpen: (ChatPreview) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var hovering = false
    @State private var picker = false

    private var mine: Bool { message.senderID == me }
    private var showDate: Bool { previous.map { !ChatDates.sameDay($0.created, message.created) } ?? true }
    private var consecutive: Bool {
        guard let previous, !showDate else { return false }
        return previous.senderID == message.senderID && message.created.timeIntervalSince(previous.created) < 60
    }
    private var bubbleText: Color { mine ? (theme == .light ? Color.white : CrmTheme.rgb(0x0f1119)) : Color.primary }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showDate {
                Text(ChatDates.separator(message.created)).font(.caption2).foregroundStyle(.secondary)
                    .padding(.horizontal, 10).padding(.vertical, 2)
                    .background(Color.primary.opacity(0.06), in: Capsule())
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
            }
            HStack(alignment: .bottom, spacing: 6) {
                if selecting {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? theme.accent : Color.secondary.opacity(0.5)).font(.title3)
                }
                if mine { Spacer(minLength: 40) }
                if !mine && isGroup && !selecting {
                    if consecutive { Color.clear.frame(width: 24, height: 1) } else { ChatAvatar(employee: sender, size: 24) }
                }
                VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                    if !mine && !consecutive && isGroup {
                        Text(sender?.shortName ?? "Ktoś").font(.system(size: 10, weight: .medium)).foregroundStyle(theme.accent.opacity(0.75)).padding(.leading, 6)
                    }
                    HStack(alignment: .center, spacing: 4) {
                        if mine && !selecting { reactButton }
                        bubble
                        if !mine && !selecting { reactButton }
                    }
                    meta
                }
                if !mine { Spacer(minLength: 40) }
            }
            .padding(.top, consecutive ? 2 : 8)
            .contentShape(Rectangle())
            .onTapGesture { if selecting { onToggle() } }
            if !seen.isEmpty {
                HStack(spacing: 2) {
                    Spacer()
                    ForEach(seen) { item in
                        ChatAvatar(employee: item.employee, size: 14).help(item.help)
                    }
                }
                .padding(.top, 2)
                .help(isLastMine ? receiptHelp : "")
            }
        }
        .onHover { hovering = $0 }
    }

    private var bubble: some View {
        let attachment = message.attachmentURL != nil
        return VStack(alignment: .leading, spacing: 6) {
            if attachment { ChatAttachmentView(message: message, mine: mine, onOpen: onOpen) }
            if let caption = message.caption {
                Text(caption).font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, attachment ? 4 : 0)
            }
        }
        .padding(.horizontal, attachment ? 6 : 11).padding(.vertical, attachment ? 6 : 7)
        .foregroundStyle(bubbleText)
        .background(mine ? AnyShapeStyle(LinearGradient(colors: [theme.accent, theme.accent.opacity(0.88)], startPoint: .topLeading, endPoint: .bottomTrailing))
                         : AnyShapeStyle(Color.primary.opacity(0.09)),
                    in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(selected ? theme.accent.opacity(0.6) : Color.clear, lineWidth: 2))
        .overlay(alignment: mine ? .bottomTrailing : .bottomLeading) {
            if let reaction = message.reaction {
                Text(reaction.emoji).font(.system(size: 12))
                    .padding(.horizontal, 5).frame(minWidth: 22, minHeight: 22)
                    .background(theme.card, in: Capsule())
                    .overlay(Capsule().strokeBorder(reaction.userID == me ? theme.accent.opacity(0.7) : Color.primary.opacity(0.15)))
                    .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
                    .offset(x: mine ? 6 : -6, y: 13)
                    .help(reaction.userID == me ? "Twoja reakcja — usuniesz ją prawym przyciskiem wiadomości" : "Reakcja")
            }
        }
        .padding(.bottom, message.reaction != nil ? 12 : 0)
        .frame(maxWidth: 260, alignment: mine ? .trailing : .leading)
        .opacity(selected ? 0.75 : 1)
        .contextMenu { menu }
    }

    private var reactButton: some View {
        Button { picker.toggle() } label: {
            Text("😊").font(.system(size: 13)).frame(width: 26, height: 26)
                .background(theme.card, in: Circle())
                .overlay(Circle().strokeBorder(theme.accent.opacity(0.15)))
        }
        .buttonStyle(.plain)
        .opacity(hovering || picker ? 1 : 0)
        .allowsHitTesting(hovering || picker)
        .help("Dodaj reakcję")
        .popover(isPresented: $picker, arrowEdge: .top) {
            HStack(spacing: 2) {
                ForEach(ChatRules.reactions, id: \.self) { emoji in
                    Button { picker = false; onReact(emoji) } label: { Text(emoji).font(.system(size: 18)).frame(width: 30, height: 30) }
                        .buttonStyle(.plain)
                }
            }
            .padding(6)
        }
    }

    private var meta: some View {
        HStack(spacing: 4) {
            Text(ChatDates.time(message.created)).font(.system(size: 9)).foregroundStyle(.tertiary)
                .opacity(isLastMine || hovering ? 1 : 0)
            if isLastMine, let receipt {
                switch receipt {
                case .sent:
                    HStack(spacing: 2) { Image(systemName: "checkmark").font(.system(size: 8, weight: .semibold)); Text("Wysłano") }
                        .font(.system(size: 9)).foregroundStyle(.secondary).help(receiptHelp)
                case .delivered:
                    HStack(spacing: 2) { ChatDoubleCheck(color: .secondary); Text("Dostarczono") }
                        .font(.system(size: 9)).foregroundStyle(.secondary).help(receiptHelp)
                case .read:
                    if seen.isEmpty {
                        HStack(spacing: 2) { ChatDoubleCheck(color: theme.accent); Text("Wyświetlono") }
                            .font(.system(size: 9)).foregroundStyle(theme.accent).help(receiptHelp)
                    }
                }
            }
        }
        .padding(.horizontal, 4)
    }

    @ViewBuilder private var menu: some View {
        Menu("Reakcja") {
            ForEach(ChatRules.reactions, id: \.self) { emoji in Button(emoji) { onReact(emoji) } }
        }
        if message.reaction?.userID == me { Button("Usuń reakcję") { onReact(nil) } }
        if let caption = message.caption {
            Button("Kopiuj tekst", systemImage: "doc.on.doc") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(caption, forType: .string)
            }
        }
        if let raw = message.attachmentURL, let url = URL(string: raw) {
            let name = ChatFiles.filename(message)
            Button("Otwórz załącznik", systemImage: "arrow.up.forward.app") { Task { await ChatFiles.open(url, filename: name, workspace: state) } }
            Button("Pobierz…", systemImage: "arrow.down.circle") { Task { await ChatFiles.save(url, filename: name, workspace: state) } }
            Button("Kopiuj link", systemImage: "link") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(raw, forType: .string)
            }
        }
        Divider()
        Button("Zaznacz wiadomości", systemImage: "checkmark.circle") { onSelectMode() }
        Button("Usuń u mnie…", systemImage: "trash", role: .destructive) { onDelete() }
    }
}

/// „pisze…” — trzy kropki.
struct ChatTypingBubble: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 0.2)) { context in
            let phase = Int(context.date.timeIntervalSinceReferenceDate * 3) % 3
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle().frame(width: 6, height: 6).opacity(index == phase ? 0.9 : 0.35)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Color.primary.opacity(0.09), in: RoundedRectangle(cornerRadius: 14))
        }
        .foregroundStyle(.secondary)
        .accessibilityLabel("pisze…")
    }
}

// MARK: Załączniki

@MainActor struct ChatAttachmentView: View {
    let message: ChatMessage
    let mine: Bool
    let onOpen: (ChatPreview) -> Void
    @EnvironmentObject private var state: Workspace
    @State private var busy = false

    var body: some View {
        if let raw = message.attachmentURL, let url = URL(string: raw) {
            let name = ChatFiles.filename(message)
            if message.isImage {
                VStack(alignment: .leading, spacing: 4) {
                    ChatRemoteImage(url: url)
                        .frame(maxWidth: 230, maxHeight: 210)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .contentShape(Rectangle())
                        .onTapGesture { onOpen(ChatPreview(kind: .image, url: url, filename: name)) }
                        .help("Powiększ zdjęcie")
                    Button {
                        busy = true
                        Task { await ChatFiles.save(url, filename: name, workspace: state); busy = false }
                    } label: { Label(busy ? "Pobieranie…" : "Pobierz zdjęcie", systemImage: "arrow.down.circle").font(.caption) }
                    .buttonStyle(.plain).opacity(0.85).disabled(busy)
                }
            } else {
                Button {
                    if message.isVideo { onOpen(ChatPreview(kind: .video, url: url, filename: name)) }
                    else if message.isPDF { onOpen(ChatPreview(kind: .pdf, url: url, filename: name)) }
                    else { busy = true; Task { await ChatFiles.open(url, filename: name, workspace: state); busy = false } }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: message.isVideo ? "play.rectangle" : "doc.text").font(.title3).opacity(0.75)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(message.attachmentFilename ?? "Plik").font(.caption.weight(.medium)).lineLimit(1)
                            if let size = message.attachmentSize { Text(ChatRules.fileSize(size)).font(.caption2).opacity(0.6) }
                        }
                        Spacer(minLength: 4)
                        if busy { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.down.circle").opacity(0.6) }
                    }
                    .padding(.horizontal, 8).padding(.vertical, 6)
                    .frame(maxWidth: 230)
                    .background(mine ? Color.black.opacity(0.1) : Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(message.isVideo ? "Odtwórz film" : message.isPDF ? "Podgląd PDF" : "Otwórz plik")
            }
        }
    }
}

@MainActor final class ChatImageCache {
    static let shared = ChatImageCache()
    private let cache = NSCache<NSURL, NSImage>()
    func cached(_ url: URL) -> NSImage? { cache.object(forKey: url as NSURL) }
    func image(_ url: URL) async -> NSImage? {
        if let hit = cached(url) { return hit }
        guard let result = try? await URLSession.shared.data(from: url),
              (result.1 as? HTTPURLResponse)?.statusCode == 200, let image = NSImage(data: result.0) else { return nil }
        cache.setObject(image, forKey: url as NSURL)
        return image
    }
}

struct ChatRemoteImage: View {
    let url: URL
    @State private var image: NSImage?
    @State private var failed = false
    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
            } else if failed {
                Label("Nie udało się wczytać zdjęcia", systemImage: "photo").font(.caption).padding(8)
            } else {
                ProgressView().controlSize(.small).frame(width: 120, height: 90)
            }
        }
        .task(id: url) {
            image = ChatImageCache.shared.cached(url)
            if image == nil {
                image = await ChatImageCache.shared.image(url)
                failed = image == nil
            }
        }
    }
}

enum ChatFiles {
    /// Nazwa pliku załącznika (bez ukośników).
    static func filename(_ message: ChatMessage) -> String {
        let raw = message.attachmentFilename?.nonEmpty
            ?? URL(string: message.attachmentURL ?? "")?.lastPathComponent.removingPercentEncoding
            ?? "plik"
        return raw.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
    }

    static func data(_ url: URL) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw ChatError("Nie udało się pobrać pliku.") }
        return data
    }

    /// „Pobierz” — okno zapisu w wybranym miejscu.
    @MainActor static func save(_ url: URL, filename: String, workspace: Workspace?) async {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = filename
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let target = panel.url else { return }
        do {
            let bytes = try await Self.data(url)
            try bytes.write(to: target, options: .atomic)
            workspace?.succeed("Zapisano „\(target.lastPathComponent)”.")
        } catch {
            workspace?.error = "Nie udało się pobrać pliku. Spróbuj ponownie lub otwórz go w przeglądarce."
        }
    }

    /// Otwarcie w domyślnej aplikacji (kopia w katalogu tymczasowym).
    @MainActor static func open(_ url: URL, filename: String, workspace: Workspace?) async {
        do {
            let bytes = try await Self.data(url)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("MavinciChat/\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appendingPathComponent(filename.isEmpty ? "plik" : filename)
            try bytes.write(to: file, options: .atomic)
            NSWorkspace.shared.open(file)
        } catch {
            workspace?.error = "Nie udało się otworzyć pliku. Spróbuj ponownie."
        }
    }
}

/// Podgląd zdjęcia, filmu albo PDF z „Pobierz…” i „Otwórz w przeglądarce”.
@MainActor struct ChatPreviewSheet: View {
    let item: ChatPreview
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var pdf: PDFDocument?
    @State private var pdfFailed = false
    @State private var player: AVPlayer?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(item.filename).font(.headline).lineLimit(1)
                Spacer()
                Button("Pobierz…") { Task { await ChatFiles.save(item.url, filename: item.filename, workspace: state) } }
                Button("Otwórz w przeglądarce") { NSWorkspace.shared.open(item.url) }
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(12)
            Divider()
            content.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.black.opacity(0.88))
        }
        .frame(minWidth: 720, idealWidth: 920, minHeight: 520, idealHeight: 700)
        .task {
            if item.kind == .video { player = AVPlayer(url: item.url) }
            if item.kind == .pdf {
                if let data = try? await ChatFiles.data(item.url), let document = PDFDocument(data: data) { pdf = document } else { pdfFailed = true }
            }
        }
        .onDisappear { player?.pause() }
    }

    @ViewBuilder private var content: some View {
        switch item.kind {
        case .image:
            ChatRemoteImage(url: item.url).padding(16)
        case .video:
            if let player { VideoPlayer(player: player) } else { ProgressView() }
        case .pdf:
            if let pdf { ChatPDFView(document: pdf) }
            else if pdfFailed { Text("Nie udało się wczytać pliku PDF.").foregroundStyle(.white) }
            else { ProgressView() }
        }
    }
}

struct ChatPDFView: NSViewRepresentable {
    let document: PDFDocument
    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.document = document
        return view
    }
    func updateNSView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}
