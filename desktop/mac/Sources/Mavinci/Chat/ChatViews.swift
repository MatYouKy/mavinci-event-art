import SwiftUI
import AppKit

// MARK: Widżet komunikatora (jak `ChatWidget` w CRM): okrągły przycisk z licznikiem w prawym dolnym rogu okna i panel
// „Komunikator” (lista rozmów, rozmowa, nowa rozmowa) ze zwijaniem i zamykaniem. Każde okno ma własny panel
// (`WindowNavigation.chatOpen`, `chatRoute`); dane i połączenie są wspólne (`ChatStore`).

/// Przycisk i panel komunikatora w oknie.
@MainActor struct ChatWidgetHost: View {
    @ObservedObject var store: ChatStore
    @EnvironmentObject private var state: Workspace
    @EnvironmentObject private var nav: WindowNavigation
    @Environment(\.crmTheme) private var theme

    var body: some View {
        Group {
            if nav.chatOpen {
                ChatPanel(store: store)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if store.available {
                launcher
            }
        }
        .padding(20)
        .animation(.easeOut(duration: 0.18), value: nav.chatOpen)
        .onAppear { handleRequest() }
        .onChange(of: store.openRequest) { _, _ in handleRequest() }
    }

    private var launcher: some View {
        Button {
            nav.chatOpen = true
            nav.chatMinimized = false
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "message.fill")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(theme == .light ? Color.white : CrmTheme.rgb(0x0f1119))
                    .frame(width: 54, height: 54)
                    .background(LinearGradient(colors: [theme.accent, theme.accent.opacity(0.82)], startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
                    .shadow(color: theme.accent.opacity(0.3), radius: 10, y: 4)
                if store.unreadTotal > 0 {
                    ChatCountBadge(count: store.unreadTotal).offset(x: 4, y: -4)
                }
            }
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(store.unreadTotal > 0 ? "Komunikator — nieprzeczytane: \(store.unreadTotal)" : "Komunikator")
        .accessibilityLabel("Komunikator")
    }

    /// Powiadomienie albo „Czat” z karty pracownika — w oknie, w którym pracuje użytkownik.
    private func handleRequest() {
        guard let request = store.openRequest, state.activeNavigation === nav else { return }
        store.openRequest = nil
        nav.chatOpen = true
        nav.chatMinimized = false
        if let id = request.conversationID {
            nav.chatRoute = .conversation(id)
        } else if let employeeID = request.employeeID {
            if let existing = store.direct(with: employeeID) { nav.chatRoute = .conversation(existing.id) } else { nav.chatRoute = .new(employeeID) }
        }
    }
}

/// Przycisk komunikatora na pasku narzędzi (obok powiadomień) z licznikiem nieprzeczytanych.
@MainActor struct ChatToolbarButton: View {
    @ObservedObject var store: ChatStore
    @ObservedObject var nav: WindowNavigation
    var body: some View {
        Button {
            withAnimation(.easeOut(duration: 0.18)) {
                nav.chatOpen.toggle()
                nav.chatMinimized = false
            }
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "message")
                if store.unreadTotal > 0 {
                    Text(store.unreadTotal > 99 ? "99+" : String(store.unreadTotal))
                        .font(.system(size: 8, weight: .bold)).padding(3)
                        .background(.red, in: Capsule()).foregroundStyle(.white).offset(x: 9, y: -8)
                }
            }
            .frame(width: 28, height: 26)
        }
        .help(store.unreadTotal > 0 ? "Komunikator — nieprzeczytane: \(store.unreadTotal) (⌥⌘K)" : "Komunikator (⌥⌘K)")
        .accessibilityLabel("Komunikator")
    }
}

/// Czerwony licznik nieprzeczytanych (jak w CRM).
struct ChatCountBadge: View {
    let count: Int
    var body: some View {
        Text(count > 99 ? "99+" : String(count))
            .font(.system(size: 10, weight: .bold)).monospacedDigit()
            .padding(.horizontal, 5).frame(minWidth: 18, minHeight: 18)
            .background(Color.red, in: Capsule()).foregroundStyle(.white)
    }
}

/// Panel „Komunikator”.
@MainActor struct ChatPanel: View {
    @ObservedObject var store: ChatStore
    @EnvironmentObject private var state: Workspace
    @EnvironmentObject private var nav: WindowNavigation
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            header
            if !nav.chatMinimized {
                Divider()
                content.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: nav.chatMinimized ? 300 : 390)
        .frame(height: nav.chatMinimized ? 50 : nil)
        .frame(maxHeight: nav.chatMinimized ? 50 : 580)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(theme.accent.opacity(0.2)))
        .shadow(color: .black.opacity(0.35), radius: 22, y: 8)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "message").foregroundStyle(theme.accent)
            Text("Komunikator").font(.callout.weight(.semibold))
            if store.unreadTotal > 0 { ChatCountBadge(count: store.unreadTotal) }
            if !store.live && store.loaded {
                Image(systemName: "arrow.triangle.2.circlepath").font(.caption).foregroundStyle(.secondary)
                    .help("Brak połączenia na żywo — wiadomości odświeżają się co kilka sekund.")
            }
            Spacer()
            Button { nav.chatMinimized.toggle() } label: { Image(systemName: nav.chatMinimized ? "chevron.up" : "minus") }
                .buttonStyle(.borderless).help(nav.chatMinimized ? "Rozwiń" : "Zwiń")
            Button { nav.chatOpen = false; nav.chatMinimized = false } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless).help("Zamknij komunikator")
        }
        .padding(.horizontal, 14).frame(height: 50)
        .contentShape(Rectangle())
        .onTapGesture { if nav.chatMinimized { nav.chatMinimized = false } }
    }

    @ViewBuilder private var content: some View {
        if let me = store.me {
            switch nav.chatRoute {
            case .list:
                ChatConversationListView(store: store, me: me) { nav.chatRoute = .conversation($0.id) } onNew: { nav.chatRoute = .new(nil) }
            case .conversation(let id):
                if let conversation = store.conversations.first(where: { $0.id == id }) {
                    ChatThreadView(store: store, conversation: conversation, me: me) { nav.chatRoute = .list; Task { await store.reload() } }
                        .id(id)
                } else {
                    VStack(spacing: 10) {
                        ProgressView().controlSize(.small)
                        Text(store.loaded ? "Ta rozmowa nie jest już dostępna." : "Wczytywanie rozmowy…").font(.caption).foregroundStyle(.secondary)
                        Button("Wróć do listy") { nav.chatRoute = .list }.buttonStyle(.link)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .task { if !store.loaded || !store.conversations.contains(where: { $0.id == id }) { await store.reload() } }
                }
            case .new(let employeeID):
                ChatNewConversationView(store: store, initialEmployeeID: employeeID) { nav.chatRoute = .list } onCreated: { nav.chatRoute = .conversation($0.id) }
                    .id(employeeID ?? "manual")
            }
        } else if let error = store.loadError {
            VStack(spacing: 10) {
                Image(systemName: "exclamationmark.bubble").font(.title2).foregroundStyle(.secondary)
                Text(error).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Okrągły awatar rozmowy: zdjęcie pracownika, inicjały albo liczba uczestników grupy; zielona kropka „online”.
@MainActor struct ChatAvatar: View {
    let employee: ChatEmployee?
    var group: Int? = nil
    let size: CGFloat
    var online = false
    @Environment(\.crmTheme) private var theme

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let group {
                ZStack {
                    Circle().fill(theme.accent.opacity(0.15))
                    Text(String(group)).font(.system(size: size / 3, weight: .semibold)).foregroundStyle(theme.accent)
                }
                .frame(width: size, height: size)
            } else if let url = employee?.avatar_url, !url.isEmpty {
                EmployeeAvatarView(name: employee?.displayName ?? "?", url: url, crop: nil, size: size)
            } else {
                ZStack {
                    Circle().fill(theme.accent.opacity(0.15))
                    Text(employee?.initials ?? "?").font(.system(size: size / 2.8, weight: .semibold)).foregroundStyle(theme.accent)
                }
                .frame(width: size, height: size)
            }
            if online {
                Circle().fill(Color.green).frame(width: size / 4, height: size / 4)
                    .overlay(Circle().strokeBorder(theme.card, lineWidth: 2))
            }
        }
        .frame(width: size, height: size)
    }
}

/// Pole wyszukiwania komunikatora.
struct ChatSearchField: View {
    let prompt: String
    @Binding var text: String
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.caption).foregroundStyle(.secondary)
            TextField(prompt, text: $text).textFieldStyle(.plain).font(.callout)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Lista rozmów

/// Lista rozmów (jak `ChatConversationList`): wyszukiwanie, nowa rozmowa, awatar z obecnością, nazwa, czas, podgląd
/// z „Ty: …” i statusem własnej wiadomości, licznik nieprzeczytanych.
@MainActor struct ChatConversationListView: View {
    @ObservedObject var store: ChatStore
    let me: String
    let onSelect: (ChatConversation) -> Void
    let onNew: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var search = ""

    private var filtered: [ChatConversation] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return store.conversations }
        return store.conversations.filter { $0.name(me).lowercased().contains(needle) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                ChatSearchField(prompt: "Szukaj…", text: $search)
                Button(action: onNew) { Image(systemName: "plus").frame(width: 28, height: 28) }
                    .buttonStyle(.plain).foregroundStyle(theme.accent)
                    .background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                    .help("Nowa rozmowa")
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            Divider()
            if store.loading && !store.loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = store.loadError, store.conversations.isEmpty {
                VStack(spacing: 10) {
                    Text(error).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("Spróbuj ponownie") { Task { await store.reload() } }
                }
                .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if filtered.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.largeTitle).foregroundStyle(.tertiary)
                    Text(search.isEmpty ? "Brak konwersacji" : "Brak wyników").font(.caption).foregroundStyle(.secondary)
                    if search.isEmpty { Button("Rozpocznij czat", action: onNew).buttonStyle(.bordered) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(filtered) { conversation in
                            row(conversation)
                            Divider().opacity(0.4)
                        }
                    }
                }
            }
        }
    }

    private func row(_ conversation: ChatConversation) -> some View {
        let other = conversation.other(me)
        let online = conversation.isGroup ? conversation.others(me).contains { store.isOnline($0.employeeID) } : other.map { store.isOnline($0.employeeID) } ?? false
        let ownStatus: ChatReceipt? = conversation.lastMessageSenderID == me && conversation.lastMessageAt != nil
            ? ChatRules.receipt(conversation.lastMessageAt!, markers: conversation.markers, me: me) : nil
        let unread = conversation.unread > 0
        return Button { onSelect(conversation) } label: {
            HStack(spacing: 10) {
                // Jak w CRM: zdjęcie drugiej osoby (także w grupie), bez zdjęcia — w grupie liczba uczestników, w rozmowie 1:1 inicjały.
                ChatAvatar(employee: other?.employee,
                           group: conversation.isGroup && (other?.employee?.avatar_url ?? "").isEmpty ? conversation.participants.count : nil,
                           size: 40, online: online)
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(conversation.name(me)).font(.callout.weight(unread ? .semibold : .medium)).lineLimit(1)
                            .foregroundStyle(unread ? Color.primary : Color.primary.opacity(0.85))
                        Spacer(minLength: 6)
                        Text(ChatDates.listLabel(conversation.lastMessageAt)).font(.caption2).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 4) {
                        if let ownStatus { ChatReceiptIcon(status: ownStatus) }
                        Text(conversation.lastMessagePreview.map { ChatRules.previewPrefix(conversation, me: me) + $0 } ?? "Brak wiadomości")
                            .font(.caption).lineLimit(1)
                            .foregroundStyle(unread ? Color.primary.opacity(0.85) : Color.secondary)
                            .fontWeight(unread ? .medium : .regular)
                        Spacer(minLength: 4)
                        if unread {
                            Text(String(conversation.unread)).font(.system(size: 10, weight: .bold)).monospacedDigit()
                                .padding(.horizontal, 5).frame(minWidth: 16, minHeight: 16)
                                .background(theme.accent, in: Capsule())
                                .foregroundStyle(theme == .light ? Color.white : CrmTheme.rgb(0x0f1119))
                        }
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Status własnej wiadomości: ✓ wysłano, ✓✓ dostarczono, ✓✓ (złote) wyświetlono.
struct ChatReceiptIcon: View {
    let status: ChatReceipt
    @Environment(\.crmTheme) private var theme
    var body: some View {
        switch status {
        case .sent: Image(systemName: "checkmark").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary).help("Wysłano")
        case .delivered: ChatDoubleCheck(color: .secondary).help("Dostarczono")
        case .read: ChatDoubleCheck(color: theme.accent).help("Wyświetlono")
        }
    }
}

/// Podwójny znaczek „dostarczono / wyświetlono”.
struct ChatDoubleCheck: View {
    let color: Color
    var body: some View {
        ZStack(alignment: .leading) {
            Image(systemName: "checkmark").font(.system(size: 9, weight: .semibold))
            Image(systemName: "checkmark").font(.system(size: 9, weight: .semibold)).offset(x: 4)
        }
        .frame(width: 14, alignment: .leading)
        .foregroundStyle(color)
    }
}

// MARK: Nowa rozmowa

/// Nowa rozmowa (jak `ChatNewConversation`): wybór osób (kilka — grupa z opcjonalną nazwą), wyszukiwanie, „Utwórz”;
/// rozmowa 1:1, która już istnieje, otwiera się zamiast tworzenia nowej.
@MainActor struct ChatNewConversationView: View {
    @ObservedObject var store: ChatStore
    let initialEmployeeID: String?
    let onBack: () -> Void
    let onCreated: (ChatConversation) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var employees: [ChatEmployee] = []
    @State private var selected: [String] = []
    @State private var search = ""
    @State private var groupName = ""
    @State private var loading = true
    @State private var creating = false
    @State private var error: String?

    private var filtered: [ChatEmployee] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return employees }
        return employees.filter { "\($0.name ?? "") \($0.surname ?? "") \($0.nickname ?? "")".lowercased().contains(needle) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button(action: onBack) { Image(systemName: "chevron.left") }.buttonStyle(.borderless).help("Wróć")
                Text("Nowy czat").font(.callout.weight(.medium))
                Spacer()
                Button(creating ? "…" : "Utwórz") { Task { await create() } }
                    .buttonStyle(.borderedProminent).controlSize(.small)
                    .disabled(selected.isEmpty || creating)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            Divider()
            if selected.count > 1 {
                HStack(spacing: 6) {
                    Image(systemName: "person.3").font(.caption).foregroundStyle(theme.accent)
                    TextField("Nazwa grupy (opcjonalnie)", text: $groupName).textFieldStyle(.plain).font(.callout)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                Divider()
            }
            if !selected.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(selected, id: \.self) { id in
                            if let employee = employees.first(where: { $0.id == id }) ?? store.employee(id) {
                                Button { toggle(id) } label: {
                                    HStack(spacing: 3) { Text(employee.displayName); Image(systemName: "xmark").font(.system(size: 8, weight: .bold)) }
                                        .font(.caption).padding(.horizontal, 8).padding(.vertical, 3)
                                        .foregroundStyle(theme.accent)
                                        .background(theme.accent.opacity(0.12), in: Capsule())
                                        .overlay(Capsule().strokeBorder(theme.accent.opacity(0.3)))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 7)
                }
                Divider()
            }
            ChatSearchField(prompt: "Szukaj pracownika…", text: $search).padding(.horizontal, 12).padding(.vertical, 8)
            Divider()
            if let error { Text(error).font(.caption).foregroundStyle(.red).padding(8) }
            if loading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(filtered) { employee in employeeRow(employee) }
                    }
                }
            }
        }
        .task {
            if let initialEmployeeID, !selected.contains(initialEmployeeID) { selected = [initialEmployeeID] }
            do { employees = try await store.colleagues(); error = nil }
            catch { self.error = "Nie udało się wczytać pracowników." }
            loading = false
        }
    }

    private func employeeRow(_ employee: ChatEmployee) -> some View {
        let isSelected = selected.contains(employee.id)
        return Button { toggle(employee.id) } label: {
            HStack(spacing: 10) {
                ChatAvatar(employee: employee, size: 34, online: store.isOnline(employee.id))
                VStack(alignment: .leading, spacing: 1) {
                    Text(employee.displayName).font(.callout.weight(.medium)).lineLimit(1)
                    if employee.nickname?.isEmpty == false { Text(employee.fullName).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                    if let role = employee.role, !role.isEmpty { Text(TeamLabels.role(role)).font(.caption2).foregroundStyle(.tertiary).lineLimit(1) }
                }
                Spacer()
                ZStack {
                    Circle().strokeBorder(isSelected ? theme.accent : Color.secondary.opacity(0.4), lineWidth: 2)
                    if isSelected {
                        Circle().fill(theme.accent)
                        Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(theme == .light ? Color.white : CrmTheme.rgb(0x0f1119))
                    }
                }
                .frame(width: 18, height: 18)
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(isSelected ? theme.accent.opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func toggle(_ id: String) {
        if let index = selected.firstIndex(of: id) { selected.remove(at: index) } else { selected.append(id) }
    }

    private func create() async {
        guard !selected.isEmpty, !creating else { return }
        creating = true
        defer { creating = false }
        do {
            let conversation = try await store.createConversation(with: selected, title: groupName)
            error = nil
            onCreated(conversation)
        } catch {
            self.error = (error as? ChatError)?.message ?? "Nie udało się utworzyć rozmowy. Spróbuj ponownie."
        }
    }
}
