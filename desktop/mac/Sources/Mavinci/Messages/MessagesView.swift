import SwiftUI
import AppKit

/// Ekran Wiadomości 1:1 z `/crm/messages`: skrzynki z licznikami, lista wiadomości i podgląd obok siebie (`HSplitView`).
struct MessagesView: View {
    @EnvironmentObject private var state: Workspace
    var body: some View { MessagesScreen(store: state.messages) }
}

/// Licznik nieprzeczytanych przy „Wiadomości” w pasku bocznym; odświeżany co minutę jak w CRM.
struct MessagesUnreadBadge: View {
    @ObservedObject var store: MessagesStore
    var body: some View {
        Text(store.unreadTotal > 0 ? (store.unreadTotal > 99 ? "99+" : "\(store.unreadTotal)") : "")
            .foregroundStyle(.secondary).monospacedDigit()
            .task {
                // Kopia Wiadomości synchronizowana w tle co 30 s (tylko zmiany), także gdy ekran Wiadomości jest zamknięty.
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    await store.backgroundSync()
                }
            }
    }
}

/// Wiadomość w osobnym oknie („Otwórz w nowym oknie”, dwuklik na liście).
struct MessageWindow: View {
    @EnvironmentObject private var state: Workspace
    let key: String
    var body: some View {
        MessageActionHost(store: state.messages) { actions in
            MessagePreviewPane(store: state.messages, key: key, actions: actions)
        }
        .frame(minWidth: 620, minHeight: 520)
        .background(state.theme.page)
        .navigationTitle(state.messages.details[key]?.item.subjectLabel ?? "Wiadomość")
        .task(id: key) {
            let parts = key.split(separator: ":", maxSplits: 1).map(String.init)
            if parts.count == 2, state.messages.details[key] == nil { _ = await state.messages.loadDetail(id: parts[1], type: parts[0]) }
        }
    }
}

/// Akcja wymagająca arkusza (przypisanie, zapytanie, zadanie, wysyłka).
enum MessageSheet: Identifiable {
    case assign(MessageItem), inquiry(MessageItem), task(MessageItem, MessageDetail?), compose(ComposeDraft)
    var id: String {
        switch self {
        case .assign(let m): return "assign:\(m.key)"
        case .inquiry(let m): return "inquiry:\(m.key)"
        case .task(let m, _): return "task:\(m.key)"
        case .compose(let d): return "compose:\(d.id)"
        }
    }
}

struct MessageActions {
    let compose: () -> Void
    let reply: (MessageItem) -> Void
    let forward: (MessageItem) -> Void
    let assign: (MessageItem) -> Void
    let inquiry: (MessageItem) -> Void
    let task: (MessageItem) -> Void
    let star: (MessageItem) -> Void
    let unread: (MessageItem) -> Void
    let archive: (MessageItem) -> Void
    let move: (MessageItem) -> Void
    let trash: (MessageItem, Bool) -> Void
    let window: (MessageItem) -> Void
    let browser: (MessageItem) -> Void
}

/// Czynności wiadomości z arkuszami i potwierdzeniem kosza — te same reguły co `MessageActionsMenu` i `MessagePreviewPane`.
@MainActor struct MessageActionHost<Content: View>: View {
    @EnvironmentObject private var state: Workspace
    @ObservedObject var store: MessagesStore
    @ViewBuilder let content: (MessageActions) -> Content
    @State private var sheet: MessageSheet?
    @State private var trashTarget: (message: MessageItem, restore: Bool)?
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        content(actions)
            .sheet(item: $sheet) { sheet in
                switch sheet {
                case .assign(let message): AssignMessageSheet(store: store, message: message)
                case .inquiry(let message): InquiryFromMessageSheet(store: store, message: message)
                case .task(let message, let detail): TaskFromMessageSheet(store: store, message: message, detail: detail)
                case .compose(let draft): ComposeSheet(store: store, draft: draft)
                }
            }
            .confirmationDialog(trashTarget?.restore == true ? "Przywróć wiadomość" : "Przenieś wiadomość do kosza",
                                isPresented: Binding(get: { trashTarget != nil }, set: { if !$0 { trashTarget = nil } }), titleVisibility: .visible) {
                if let target = trashTarget {
                    Button(target.restore ? "Przywróć" : "Przenieś do kosza", role: target.restore ? nil : .destructive) {
                        Task { await store.trash(target.message, restore: target.restore) }
                    }
                    Button("Anuluj", role: .cancel) {}
                }
            } message: {
                Text(trashTarget?.message.type == "contact_form" ? "Wiadomość można przywrócić z kosza CRM."
                     : "Zmiana zostanie zsynchronizowana z serwerem pocztowym, również w Thunderbirdzie. Wiadomość nie zostanie trwale usunięta.")
            }
    }
    private var actions: MessageActions {
        MessageActions(
            compose: { sheet = .compose(store.newDraft()) },
            reply: { m in Task { if let draft = await store.replyDraft(m) { sheet = .compose(draft) } } },
            forward: { m in Task { if let draft = await store.forwardDraft(m) { sheet = .compose(draft) } } },
            assign: { m in
                if let linked = m.sales?.inquiries.first, m.sales?.hasInquiry == true { store.openInquiry(linked.id) } else { sheet = .assign(m) }
            },
            inquiry: { m in
                if let sales = m.sales, sales.inquiries.count == 1, sales.hasInquiry, !sales.canClaim, let first = sales.inquiries.first { store.openInquiry(first.id) }
                else { sheet = .inquiry(m) }
            },
            task: { m in Task { let detail = await store.loadDetail(m); sheet = .task(m, detail) } },
            star: { m in Task { await store.toggleStar(m) } },
            unread: { m in Task { await store.markUnread(m) } },
            archive: { _ in state.notice = "Funkcja archiwizacji będzie wkrótce dostępna" },
            move: { _ in state.notice = "Funkcja przenoszenia będzie wkrótce dostępna" },
            trash: { m, restore in trashTarget = (m, restore) },
            window: { m in openWindow(id: "message", value: m.key) },
            browser: { m in store.openInBrowser(m) }
        )
    }
}

@MainActor struct MessagesScreen: View {
    @EnvironmentObject private var state: Workspace
    @ObservedObject var store: MessagesStore
    @State private var datesShown = false

    var body: some View {
        MessageActionHost(store: store) { actions in
            Group {
                if let info = store.info {
                    // Szerokości skrzynek i listy zapisują się po chwili od zmiany i wracają po ponownym uruchomieniu.
                    PersistentSplitView(id: "messages", panes: [
                        .init(view: pane(MailboxList(store: store, info: info)), min: 210, ideal: 250, max: 420),
                        .init(view: pane(MessageListPane(store: store, actions: actions)), min: 320, ideal: 430, max: 760),
                        .init(view: pane(MessagePreviewPane(store: store, key: store.selectedKey, actions: actions)), min: 380, ideal: 600),
                    ])
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = store.infoError {
                    ContentUnavailableView {
                        Label("Wiadomości", systemImage: "envelope")
                    } description: { Text(error) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.loadInfo() } }
                    }
                } else {
                    ProgressView("Ładowanie wiadomości...").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { datesShown.toggle() } label: { Label("Zaawansowane wyszukiwanie", systemImage: "calendar") }
                        .help("Zaawansowane wyszukiwanie")
                        .popover(isPresented: $datesShown, arrowEdge: .bottom) { dateSearch }
                    if store.searchMode {
                        Button { store.clearSearch() } label: { Label("Wyczyść wyszukiwanie", systemImage: "xmark.circle") }.help("Wyczyść wyszukiwanie")
                    }
                    if store.info?.canManage == true {
                        Button { Task { await store.fetchFromServer() } } label: { Label("Pobierz z serwera", systemImage: "tray.and.arrow.down") }
                            .help("Pobierz nowe wiadomości z serwera email")
                            .disabled(store.busy || store.scope.account == "all" || store.scope.account == "contact_form")
                    }
                    if store.canSend {
                        Button { actions.compose() } label: { Label("Wyślij e-mail", systemImage: "square.and.pencil") }
                            .help("Wyślij e-mail").keyboardShortcut("n")
                    }
                }
            }
        }
        .navigationTitle("Wiadomości")
        .navigationSubtitle(store.info?.canManage == true ? "Zarządzaj komunikacją z klientami" : "Przeglądaj wiadomości email")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Szukaj...")
        .onSubmit(of: .search) { Task { await store.search() } }
        .task(id: state.employee?.id) {
            if store.info == nil { await store.loadInfo() }
            if store.items.isEmpty { await store.backgroundSync() }
        }
    }

    /// Panel w natywnym widoku podziału — z motywem i obszarem roboczym jak reszta okna.
    private func pane<V: View>(_ view: V) -> AnyView {
        AnyView(view
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .environment(\.crmTheme, state.theme)
            .tint(state.theme.accent)
            .scrollContentBackground(.hidden)
            .background(state.theme.page)
            .environmentObject(state))
    }

    private var dateSearch: some View {
        Form {
            Toggle("Od dnia", isOn: Binding(get: { store.dateFrom != nil }, set: { store.dateFrom = $0 ? Calendar.current.date(byAdding: .month, value: -1, to: Date()) : nil }))
            if store.dateFrom != nil {
                DatePicker("Data od", selection: Binding(get: { store.dateFrom ?? Date() }, set: { store.dateFrom = $0 }), displayedComponents: .date)
            }
            Toggle("Do dnia", isOn: Binding(get: { store.dateTo != nil }, set: { store.dateTo = $0 ? Date() : nil }))
            if store.dateTo != nil {
                DatePicker("Data do", selection: Binding(get: { store.dateTo ?? Date() }, set: { store.dateTo = $0 }), displayedComponents: .date)
            }
            HStack {
                Text("Wpisz frazę w polu „Szukaj...”.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Szukaj") { datesShown = false; Task { await store.search() } }
                    .buttonStyle(.borderedProminent).disabled(store.searchText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }.formStyle(.grouped).frame(width: 360)
    }
}

/// Skrzynki jak `MessagesSidebar`: „Wszystkie wiadomości”, formularz kontaktowy i foldery każdej skrzynki (kolejność — przeciąganiem).
@MainActor struct MailboxList: View {
    @ObservedObject var store: MessagesStore
    let info: MailboxInfo
    var body: some View {
        List {
            Section {
                if info.hasAll {
                    folderButton("Wszystkie wiadomości", symbol: "envelope", account: "all", folder: .all, badge: info.unread.total)
                }
                if (info.hasContactFormAccess || info.canManage) && info.hasContactForm {
                    folderButton("Formularz kontaktowy", symbol: "list.bullet.rectangle", account: "contact_form", folder: .contact_form, badge: info.unread.contactForm)
                }
            }
            if !info.mailboxes.isEmpty {
                Section("Skrzynki") {
                    ForEach(info.orderedMailboxes) { account in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.name).font(.caption.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                                .padding(.top, 4).help("Przeciągnij, aby zmienić kolejność skrzynki")
                            ForEach(MessageFolder.mailbox) { folder in
                                if folder == .received {
                                    folderButton(store.markingAccount == account.id ? "Oznaczanie… \(store.markedCount)" : folder.label, symbol: folder.symbol,
                                                 account: account.id, folder: folder, badge: store.unread(account: account.id), muted: info.mutedMailboxIds?.contains(account.id) == true)
                                        .contextMenu {
                                            Text("\(account.name) · Odebrane")
                                            Button("Oznacz wszystkie jako odczytane") { Task { await store.markAllRead(account.id) } }
                                                .disabled(store.markingAccount != nil)
                                        }
                                        .help("Kliknij prawym przyciskiem, aby otworzyć menu skrzynki")
                                } else {
                                    folderButton(folder.label, symbol: folder.symbol, account: account.id, folder: folder, badge: 0)
                                }
                            }
                        }.padding(.bottom, 4)
                    }
                    .onMove { store.moveMailboxes(from: $0, to: $1) }
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) { MailSyncStatusView(status: store.status) }
    }
    private func folderButton(_ label: String, symbol: String, account: String, folder: MessageFolder, badge: Int, muted: Bool = false) -> some View {
        let active = store.scope.account == account && store.scope.folder == folder
        return Button { store.open(account: account, folder: folder) } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol).frame(width: 16).foregroundStyle(active ? Color.accentColor : .secondary)
                Text(label).lineLimit(1)
                Spacer(minLength: 4)
                if badge > 0 {
                    Text(badge > 99 ? "99+" : "\(badge)").font(.caption2.weight(.bold)).monospacedDigit()
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(muted ? Color.secondary.opacity(0.35) : Color.red.opacity(0.9), in: Capsule()).foregroundStyle(.white)
                }
            }
            .padding(.vertical, 4).padding(.horizontal, 6)
            .background(active ? Color.accentColor.opacity(0.2) : .clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fontWeight(active ? .semibold : .regular)
    }
}

/// Lista jak w CRM (nadawca/odbiorca, temat, data, typ, opiekun, lejek, zajawka) — stronicowanie po 50 przy przewijaniu.
@MainActor struct MessageListPane: View {
    @ObservedObject var store: MessagesStore
    let actions: MessageActions
    var body: some View {
        let visible = store.visibleItems
        VStack(spacing: 0) {
            if let error = store.listError {
                HStack { Image(systemName: "exclamationmark.triangle"); Text(error); Spacer(); Button("Ponów") { Task { await store.sync() } } }
                    .font(.callout).padding(10).background(Color.orange.opacity(0.12))
            }
            if store.searchMode {
                HStack { Image(systemName: "magnifyingglass"); Text("Wyniki wyszukiwania: \(visible.count)"); Spacer(); Button("Wyczyść") { store.clearSearch() } }
                    .font(.callout).padding(.horizontal, 12).padding(.vertical, 6).crmBar()
            }
            if store.loading && visible.isEmpty {
                ProgressView(store.searchMode ? "Wyszukiwanie..." : "Pobieranie wiadomości na dysk…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if visible.isEmpty {
                ContentUnavailableView("Brak wiadomości", systemImage: "tray").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: Binding(get: { store.selectedKey }, set: { store.select($0) })) {
                    ForEach(visible, id: \.key) { message in
                        MessageRow(message: message).tag(message.key)
                            .listRowBackground(UnreadRowBackground(unread: !message.isRead))
                    }
                    Text("Koniec listy wiadomości").font(.caption2).foregroundStyle(.tertiary).frame(maxWidth: .infinity).padding(6)
                }
                .listStyle(.inset)
                .contextMenu(forSelectionType: String.self) { keys in
                    if let key = keys.first, let message = store.item(key) {
                        MessageMenuItems(store: store, message: message, actions: actions)
                    }
                } primaryAction: { keys in
                    if let key = keys.first, let message = store.item(key) {
                        message.type == "draft" ? actions.browser(message) : actions.window(message)
                    }
                }
            }
        }
    }
}

struct MessageRow: View {
    let message: MessageItem
    @Environment(\.crmTheme) private var theme
    var body: some View {
        let unread = !message.isRead
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if unread {
                    Circle().fill(theme.accent).frame(width: 8, height: 8)
                        .background(Circle().fill(theme.accent.opacity(0.22)).frame(width: 14, height: 14))
                        .accessibilityLabel("Nieprzeczytana")
                }
                Text(message.counterpart).font(.callout.weight(unread ? .semibold : .regular)).lineLimit(1)
                    .foregroundStyle(unread ? Color.primary : Color.primary.opacity(0.72))
                if message.isStarred { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
                Spacer(minLength: 4)
                Text(MailDates.list(message.date)).font(.caption2.weight(unread ? .semibold : .regular)).monospacedDigit()
                    .foregroundStyle(unread ? theme.accent : Color.secondary)
                    .help(MailDates.medium(message.date))
            }
            Text(message.subjectLabel).font(.caption.weight(unread ? .medium : .regular)).lineLimit(1)
                .foregroundStyle(unread ? theme.accent : Color.secondary)
            HStack(spacing: 5) {
                Text(message.typeLabel).font(.system(size: 9, weight: .medium)).padding(.horizontal, 5).padding(.vertical, 1)
                    .background(typeColor.opacity(0.85), in: RoundedRectangle(cornerRadius: 3)).foregroundStyle(.white)
                if message.sales?.hasInquiry != true, let person = message.assigned_employee {
                    Text(person.full).font(.system(size: 9)).lineLimit(1).padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Color.purple.opacity(0.18), in: RoundedRectangle(cornerRadius: 3)).foregroundStyle(.purple)
                }
                if let sales = message.sales, sales.hasInquiry, let inquiry = sales.inquiries.first {
                    Text("W lejku · \(inquiry.archived == true ? "Archiwum" : SalesContext.stages[inquiry.stage ?? ""] ?? "Zapytanie")")
                        .font(.system(size: 9)).padding(.horizontal, 5).padding(.vertical, 1)
                        .background(theme.accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 3)).foregroundStyle(theme.accent)
                }
                Text(message.preview).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
            }
        }
        .padding(.vertical, 3)
    }
    private var typeColor: Color {
        switch message.type { case "contact_form": return .blue; case "sent": return .green; case "received": return .purple; case "draft": return .yellow; default: return .gray }
    }
}

/// Tło nieprzeczytanej wiadomości: delikatny odcień akcentu motywu i pasek akcentu z lewej (jak w CRM), przeczytana — bez tła.
struct UnreadRowBackground: View {
    let unread: Bool
    @Environment(\.crmTheme) private var theme
    var body: some View {
        if unread {
            HStack(spacing: 0) {
                Rectangle().fill(theme.accent.opacity(0.6)).frame(width: 3)
                theme.accent.opacity(0.08)
            }
        } else {
            Color.clear
        }
    }
}

/// Menu czynności wiadomości (prawy przycisk na liście, „⋯” w podglądzie) — pozycje i warunki jak `MessageActionsMenu`.
@MainActor struct MessageMenuItems: View {
    @ObservedObject var store: MessagesStore
    let message: MessageItem
    let actions: MessageActions
    var body: some View {
        let deleted = store.scope.folder == .trash || message.isDeleted
        let manage = store.info?.canManage == true
        if message.type == "draft" {
            Button("Otwórz w przeglądarce") { actions.browser(message) }
        } else {
            if message.type != "sent" && !deleted && store.canReply(message) { Button("Odpowiedz") { actions.reply(message) } }
            if message.type == "received" && store.canReply(message) { Button("Przekaż dalej") { actions.forward(message) } }
            if !deleted && message.type == "received" {
                Button(message.isStarred ? "Usuń gwiazdkę" : "Oznacz gwiazdką") { actions.star(message) }
            }
            if message.inbound && !deleted {
                Button(message.isRead ? "Oznacz jako nieprzeczytaną" : "Oznacz jako przeczytaną") {
                    message.isRead ? actions.unread(message) : store.select(message.key)
                }
            }
            Divider()
            if manage && message.type != "sent" && !deleted { Button("Przypisz pracownika") { actions.assign(message) } }
            if message.type != "sent" && !deleted { Button("Powiąż z zapytaniem") { actions.inquiry(message) } }
            if message.type != "sent" && !deleted && store.info?.canCreateTasks == true { Button("Utwórz zadanie") { actions.task(message) } }
            if !deleted && message.type == "received" {
                Button("Archiwizuj") { actions.archive(message) }
                Button("Przenieś do folderu") { actions.move(message) }
            }
            Divider()
            Button("Otwórz w nowym oknie") { actions.window(message) }
            Button("Otwórz w przeglądarce") { actions.browser(message) }
        }
        if store.canTrash(message) {
            Divider()
            Button(deleted ? "Przywróć z kosza" : "Przenieś do kosza", role: deleted ? nil : .destructive) { actions.trash(message, deleted) }
        }
    }
}

/// Stan kopii na dysku pod listą skrzynek: synchronizacja, praca bez połączenia, postęp pobierania treści.
struct MailSyncStatusView: View {
    @ObservedObject var status: MailSyncStatus
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if status.bodiesTotal > 0 && status.bodiesStored < status.bodiesTotal {
                ProgressView(value: Double(status.bodiesStored), total: Double(status.bodiesTotal)).controlSize(.small)
                Text("Treść na dysku: \(status.bodiesStored) z \(status.bodiesTotal)")
            }
            if status.offline {
                Label("Brak połączenia — kopia z dysku", systemImage: "wifi.slash").foregroundStyle(.orange)
            } else if status.syncing {
                Label("Synchronizacja…", systemImage: "arrow.triangle.2.circlepath")
            } else if let last = status.lastSync {
                Label("Zsynchronizowano \(last.formatted(date: .omitted, time: .shortened))", systemImage: "checkmark.icloud")
            }
        }
        .font(.caption2).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .crmBar()
    }
}

