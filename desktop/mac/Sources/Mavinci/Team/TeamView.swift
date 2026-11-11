import SwiftUI
import AppKit

// MARK: Zespół — „Pracownicy CRM” 1:1 ze stroną `/crm/employees`: wyszukiwanie, widoki Kafelki / Lista / Szczegółowy / Oś czasu
// (administrator), czynności (szczegóły, zmiana hasła, trwałe usunięcie), dodawanie pracownika i poziomy dostępu. Kliknięcie
// otwiera kartę pracownika (`EmployeeProfileView`, jak `/crm/employees/[id]`).

/// Czynności kafelka, wiersza i karty.
struct TeamActions {
    let open: (TeamMember) -> Void
    let resetPassword: (TeamMember) -> Void
    let remove: (TeamMember) -> Void
}

@MainActor struct TeamView: View {
    @ObservedObject var store: TeamStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("team.mode") private var mode: TeamViewMode = .grid
    @State private var search = ""
    @State private var selectedID: String?
    @State private var resetting: TeamMember?
    @State private var removing: TeamMember?
    @State private var adding = false

    private var isAdmin: Bool { store.access?.isAdmin ?? state.employee?.isAdmin ?? false }
    private var activeMode: TeamViewMode { mode == .timeline && !isAdmin ? .grid : mode }
    private var visible: [TeamMember] { store.members.filter { $0.matches(search) } }

    var body: some View {
        Group {
            if let id = store.openedID {
                EmployeeProfileView(store: store, employeeID: id, initialTab: store.openedTab, actions: actions).id(id)
            } else {
                list
            }
        }
        .sheet(item: $resetting) { member in
            ResetPasswordSheet(store: store, member: member)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $adding) {
            AddEmployeeSheet(store: store)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń pracownika trwale", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let member = removing {
                Button("Usuń trwale", role: .destructive) { Task { _ = await store.delete(member) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Czy na pewno chcesz trwale usunąć pracownika \(removing?.fullName ?? "")? Tej operacji nie można cofnąć. Autorstwo wydarzeń i wymaganych dokumentów przejmie Twoje konto administratora, a przypisania tego pracownika zostaną usunięte.")
        }
        .task(id: state.employee?.id) {
            if store.members.isEmpty { await store.backgroundSync() }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    var actions: TeamActions {
        TeamActions(
            open: { member in store.openedTab = nil; store.openedDate = nil; store.openedID = member.id },
            resetPassword: { resetting = $0 },
            remove: { removing = $0 }
        )
    }

    // MARK: Lista
    private var list: some View {
        VStack(spacing: 0) {
            header
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Pracownicy CRM")
        .navigationSubtitle("Zarządzaj zespołem i uprawnieniami")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj pracowników...")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if store.access?.canCreate == true {
                    Button { state.openCRM("/crm/settings/access-levels") } label: { Label("Poziomy dostępu", systemImage: "lock") }
                        .help("Poziomy dostępu (ustawienia CRM w przeglądarce)")
                    Button { adding = true } label: { Label("Dodaj pracownika", systemImage: "plus") }
                        .help("Dodaj pracownika")
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("\(visible.count) z \(store.members.count)").font(.callout).foregroundStyle(.secondary).monospacedDigit()
            Spacer(minLength: 8)
            if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja zespołu") }
            Picker("Widok", selection: Binding(get: { activeMode }, set: { mode = $0 })) {
                ForEach(TeamViewMode.allCases.filter { $0 != .timeline || isAdmin }) { Label($0.label, systemImage: $0.symbol).tag($0) }
            }.pickerStyle(.segmented).labelsHidden().fixedSize()
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
    }

    @ViewBuilder private var content: some View {
        if store.access != nil && store.access?.canView == false {
            ContentUnavailableView("Brak dostępu", systemImage: "lock", description: Text("Nie masz uprawnień do przeglądania pracowników"))
        } else if store.members.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Pracownicy CRM", systemImage: "person.3")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
            } else {
                ProgressView("Ładowanie pracowników…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if visible.isEmpty {
            ContentUnavailableView(search.isEmpty ? "Brak pracowników" : "Nie znaleziono pracowników", systemImage: "person")
        } else {
            switch activeMode {
            case .grid: grid
            case .list: rows
            case .table: TeamTable(members: visible, store: store, selectedID: $selectedID, isAdmin: isAdmin, actions: actions)
            case .timeline: TeamTimelineView(store: store, members: visible)
            }
        }
    }

    private var grid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 250, maximum: 380), spacing: 12)], spacing: 12) {
                ForEach(visible) { member in TeamCardView(member: member, isAdmin: isAdmin, me: store.me, actions: actions) }
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
        }
    }

    private var rows: some View {
        ScrollView {
            LazyVStack(spacing: 6) {
                ForEach(visible) { member in TeamRowView(member: member, isAdmin: isAdmin, me: store.me, actions: actions) }
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
        }
    }
}

// MARK: Awatar z kropką aktywności

@MainActor struct TeamAvatar: View {
    let member: TeamMember
    let size: CGFloat
    var showPresence = true
    var body: some View {
        let presence = member.presence()
        EmployeeAvatarView(name: member.name, url: member.avatarUrl, crop: member.avatar, size: size)
            .overlay(alignment: .bottomTrailing) {
                if showPresence && presence != .offline {
                    let dot = max(6, min(14, (size * 0.18).rounded()))
                    Circle().fill(presence.color).frame(width: dot, height: dot)
                        .padding(2).background(Circle().fill(Color(nsColor: .windowBackgroundColor)))
                        .help(presence.label)
                }
            }
    }
}

/// „Aktywny” / „Nieaktywny” i poziom dostępu (jak odznaki w CRM).
struct TeamBadges: View {
    let member: TeamMember
    var showAccess = true
    var body: some View {
        HStack(spacing: 5) {
            pill(member.active ? "Aktywny" : "Nieaktywny", member.active ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171), symbol: nil)
            if showAccess && !member.accessLevel.isEmpty {
                pill(TeamLabels.accessLevel(member.accessLevel), TeamLabels.accessLevelColor(member.accessLevel), symbol: "shield")
            }
        }
    }
    private func pill(_ text: String, _ color: Color, symbol: String?) -> some View {
        HStack(spacing: 3) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(text)
        }
        .font(.caption2.weight(.medium)).lineLimit(1).padding(.horizontal, 8).padding(.vertical, 3)
        .background(color.opacity(0.18), in: Capsule()).foregroundStyle(color)
    }
}

@MainActor struct TeamMenu: View {
    let member: TeamMember
    let isAdmin: Bool
    let me: String?
    let actions: TeamActions
    var body: some View {
        Button("Szczegóły", systemImage: "eye") { actions.open(member) }
        if isAdmin {
            Button("Resetuj hasło", systemImage: "key") { actions.resetPassword(member) }
            if member.id != me {
                Divider()
                Button("Usuń", systemImage: "trash", role: .destructive) { actions.remove(member) }
            }
        }
    }
}

@MainActor struct TeamCardView: View {
    let member: TeamMember
    let isAdmin: Bool
    let me: String?
    let actions: TeamActions
    @Environment(\.crmTheme) private var theme
    @State private var hover = false
    var body: some View {
        VStack(spacing: 10) {
            VStack(spacing: 5) {
                TeamAvatar(member: member, size: 76)
                Text(member.cardName).font(.headline).lineLimit(1)
                if !member.nickname.isEmpty { Text(member.fullName).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Text(member.subtitle).font(.callout).foregroundStyle(theme.accent).lineLimit(1)
                TeamBadges(member: member)
            }
            VStack(alignment: .leading, spacing: 4) {
                Label(member.email, systemImage: "envelope").lineLimit(1).truncationMode(.middle)
                if !member.phone.isEmpty { Label(member.phone, systemImage: "phone").lineLimit(1) }
            }
            .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 230, alignment: .top)
        .background(hover ? theme.accent.opacity(0.08) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .topTrailing) {
            Menu { TeamMenu(member: member, isAdmin: isAdmin, me: me, actions: actions) } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().padding(10)
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { actions.open(member) }
        .onHover { hover = $0 }
        .contextMenu { TeamMenu(member: member, isAdmin: isAdmin, me: me, actions: actions) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(member.fullName), \(member.subtitle)")
    }
}

@MainActor struct TeamRowView: View {
    let member: TeamMember
    let isAdmin: Bool
    let me: String?
    let actions: TeamActions
    @Environment(\.crmTheme) private var theme
    @State private var hover = false
    var body: some View {
        HStack(spacing: 12) {
            TeamAvatar(member: member, size: 46)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.listName).fontWeight(.medium).lineLimit(1)
                Text(member.subtitle).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            TeamBadges(member: member, showAccess: false)
            Menu { TeamMenu(member: member, isAdmin: isAdmin, me: me, actions: actions) } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(hover ? theme.accent.opacity(0.08) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { actions.open(member) }
        .onHover { hover = $0 }
        .contextMenu { TeamMenu(member: member, isAdmin: isAdmin, me: me, actions: actions) }
    }
}

/// Widok „Szczegółowy” — natywna tabela z danymi kontaktowymi, regionem, poziomem dostępu i kolejnością.
@MainActor struct TeamTable: View {
    let members: [TeamMember]
    @ObservedObject var store: TeamStore
    @Binding var selectedID: String?
    let isAdmin: Bool
    let actions: TeamActions
    @Environment(\.crmTheme) private var theme
    var body: some View {
        Table(members, selection: $selectedID) {
            TableColumn("Pracownik") { (m: TeamMember) in
                HStack(spacing: 8) {
                    TeamAvatar(member: m, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(m.listName).fontWeight(.medium).lineLimit(1)
                        if !m.nickname.isEmpty { Text(m.fullName).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                }
            }.width(min: 180, ideal: 240)
            TableColumn("Stanowisko") { (m: TeamMember) in Text(m.subtitle).foregroundStyle(theme.accent).lineLimit(1) }.width(min: 110, ideal: 160)
            TableColumn("E-mail") { (m: TeamMember) in Text(m.email).lineLimit(1).truncationMode(.middle) }.width(min: 150, ideal: 220)
            TableColumn("Telefon") { (m: TeamMember) in Text(m.phone).monospacedDigit().lineLimit(1) }.width(min: 90, ideal: 120)
            TableColumn("Region") { (m: TeamMember) in Text(m.region).lineLimit(1) }.width(min: 70, ideal: 110)
            TableColumn("Poziom dostępu") { (m: TeamMember) in
                Label(TeamLabels.accessLevel(m.accessLevel), systemImage: "shield").font(.caption).foregroundStyle(TeamLabels.accessLevelColor(m.accessLevel))
            }.width(min: 100, ideal: 130)
            TableColumn("Kolejność") { (m: TeamMember) in Text("#\(m.orderIndex)").monospacedDigit().foregroundStyle(.secondary) }.width(min: 50, ideal: 70)
            TableColumn("Status") { (m: TeamMember) in
                Text(m.active ? "Aktywny" : "Nieaktywny").font(.caption).foregroundStyle(m.active ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171))
            }.width(min: 60, ideal: 80)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let member = store.member(id) { TeamMenu(member: member, isAdmin: isAdmin, me: store.me, actions: actions) }
        } primaryAction: { ids in
            if let id = ids.first, let member = store.member(id) { actions.open(member) }
        }
    }
}
