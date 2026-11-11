import SwiftUI

// MARK: Historia zmian (1:1 z widokiem historii w `EventDetailPageClient`): liczniki zmian i osób, odśwież, widok „Timeline”
// z filtrami akcji (oś z awatarami autorów, wartości „Przed / Po”) i widok „Po dacie” (grupy dni).

struct HistoryTabData: Decodable {
    struct Employee: Decodable, Hashable { var id: String; var name: String; var occupation: String?; var email: String?; var avatarUrl: String?; var avatar: AvatarCrop? }
    struct Entry: Decodable, Identifiable, Hashable {
        var id: String; var action: String; var label: String; var color: String; var icon: String; var entity: String?
        var user: String; var userKey: String; var employee: Employee?; var description: String; var createdAt: String
        var showChanges: Bool; var before: String?; var after: String?
    }
    var entries: [Entry]
}

@MainActor struct EventHistoryTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("eventHistory.mode") private var mode = "timeline"
    @State private var filter = "all"

    private var data: HistoryTabData? { store.tab(eventID, "history", as: HistoryTabData.self) }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|history"] {
                ContentUnavailableView {
                    Label("Nie udało się pobrać historii zmian", systemImage: "clock.arrow.circlepath")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "history") } } }
            } else {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Ładowanie historii zmian...").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "history") }
    }

    private static func tint(_ name: String) -> Color {
        switch name {
        case "green": return CrmTheme.rgb(0x4ade80)
        case "blue": return CrmTheme.rgb(0x60a5fa)
        case "red": return CrmTheme.rgb(0xf87171)
        case "purple": return CrmTheme.rgb(0xc084fc)
        case "orange": return CrmTheme.rgb(0xfb923c)
        case "cyan": return CrmTheme.rgb(0x22d3ee)
        case "teal": return CrmTheme.rgb(0x2dd4bf)
        default: return CrmTheme.rgb(0x9ca3af)
        }
    }

    /// `getTimeAgo`.
    private static func ago(_ value: String) -> String {
        guard let date = MeetingDates.parse(value) else { return "" }
        let seconds = Int(Date().timeIntervalSince(date))
        let minutes = seconds / 60, hours = minutes / 60, days = hours / 24
        if seconds < 60 { return "przed chwilą" }
        if minutes < 60 { return "\(minutes) min temu" }
        if hours < 24 { return "\(hours) godz. temu" }
        if days == 1 { return "wczoraj" }
        if days < 7 { return "\(days) dni temu" }
        if days < 30 { return "\(days / 7) tyg. temu" }
        if days < 365 { return "\(days / 30) mies. temu" }
        return "\(days / 365) lat temu"
    }
    private static func stamp(_ value: String) -> String {
        guard let date = MeetingDates.parse(value) else { return value }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }
    private static func dayTitle(_ value: String) -> String {
        guard let date = MeetingDates.parse(value) else { return value }
        return MeetingDates.format(date, "d MMMM yyyy")
    }

    private func content(_ data: HistoryTabData) -> some View {
        let users = Set(data.entries.map(\.userKey)).count
        let counts = Dictionary(grouping: data.entries, by: \.action).mapValues(\.count)
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Historia zmian").font(.title2.weight(.light))
                        Text("\(data.entries.count) zmian • \(users) użytkowników").font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { Task { await store.loadTab(eventID, "history") } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.help("Odśwież historię")
                    Picker("", selection: $mode) {
                        Label("Timeline", systemImage: "list.bullet").tag("timeline")
                        Label("Po dacie", systemImage: "calendar").tag("byDate")
                    }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 220)
                }
                if mode == "timeline" { filters(data, counts) }
                if data.entries.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "clock.arrow.circlepath").font(.system(size: 40)).foregroundStyle(.tertiary)
                        Text("Brak historii zmian").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(40)
                } else if mode == "timeline" {
                    timeline(filter == "all" ? data.entries : data.entries.filter { $0.action == filter })
                } else {
                    byDate(data.entries)
                }
            }
            .padding(18)
        }
    }

    private func filters(_ data: HistoryTabData, _ counts: [String: Int]) -> some View {
        let options: [(String, String)] = [("create", "Utworzenia"), ("update", "Aktualizacje"), ("delete", "Usunięcia"), ("status_changed", "Zmiany statusu")]
        return HStack(spacing: 8) {
            chip("Wszystkie (\(data.entries.count))", "all")
            ForEach(options.filter { (counts[$0.0] ?? 0) > 0 }, id: \.0) { option in
                chip(option.1 + " (\(counts[option.0] ?? 0))", option.0)
            }
            Spacer()
        }
        .padding(12)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func chip(_ title: String, _ value: String) -> some View {
        let active = filter == value
        return Button { filter = value } label: {
            Text(title).font(.callout.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 6)
                .foregroundStyle(active ? Color.black : Color.secondary)
                .background(active ? theme.accent : Color.primary.opacity(0.06), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func timeline(_ entries: [HistoryTabData.Entry]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(entries) { entry in
                HStack(alignment: .top, spacing: 14) {
                    avatar(entry)
                    entryCard(entry)
                }
                .padding(.bottom, 14)
                .background(alignment: .leading) {
                    Rectangle().fill(theme.accent.opacity(0.18)).frame(width: 2).padding(.leading, 27).padding(.top, 56)
                }
            }
        }
    }

    @ViewBuilder private func avatar(_ entry: HistoryTabData.Entry) -> some View {
        let color = Self.tint(entry.color)
        ZStack(alignment: .bottomTrailing) {
            if let employee = entry.employee {
                Button { state.showEmployee(employee.id) } label: {
                    EmployeeAvatarView(name: employee.name, url: employee.avatarUrl, crop: employee.avatar, size: 56)
                }
                .buttonStyle(.plain)
                .help(employeeHelp(entry, employee))
            } else {
                Image(systemName: "person").font(.title2).foregroundStyle(.secondary).frame(width: 56, height: 56)
                    .background(Color.primary.opacity(0.06), in: Circle())
            }
            Image(systemName: entry.icon).font(.system(size: 10, weight: .bold)).foregroundStyle(color)
                .frame(width: 22, height: 22).background(theme.card, in: Circle()).overlay(Circle().fill(color.opacity(0.2)))
        }
        .frame(width: 56, height: 56)
    }

    private func employeeHelp(_ entry: HistoryTabData.Entry, _ employee: HistoryTabData.Employee) -> String {
        var lines = [entry.user]
        if let occupation = employee.occupation?.nonEmpty { lines.append(occupation) }
        if let email = employee.email?.nonEmpty { lines.append(email) }
        lines.append("Kliknij aby przejść do profilu")
        return lines.joined(separator: "\n")
    }

    private func entryCard(_ entry: HistoryTabData.Entry) -> some View {
        let color = Self.tint(entry.color)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(entry.label).font(.caption.weight(.semibold)).foregroundStyle(color)
                            .padding(.horizontal, 8).padding(.vertical, 3).background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 5))
                        if let entity = entry.entity {
                            Text(entity).font(.caption).foregroundStyle(.secondary)
                                .padding(.horizontal, 8).padding(.vertical, 3).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 5))
                        }
                    }
                    if !entry.description.isEmpty { Text(entry.description).font(.callout).textSelection(.enabled) }
                    HStack(spacing: 6) {
                        Label(entry.user, systemImage: "person")
                        Text("•")
                        Label(Self.ago(entry.createdAt), systemImage: "clock")
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(Self.stamp(entry.createdAt)).font(.caption).foregroundStyle(.secondary)
            }
            if entry.showChanges && (entry.before != nil || entry.after != nil) {
                VStack(alignment: .leading, spacing: 6) {
                    if let before = entry.before { change("Przed: ", before, "minus", CrmTheme.rgb(0xf87171)) }
                    if let after = entry.after { change("Po: ", after, "plus", CrmTheme.rgb(0x4ade80)) }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func change(_ title: String, _ value: String, _ symbol: String, _ color: Color) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: symbol).font(.caption.weight(.bold)).foregroundStyle(color)
            (Text(title).foregroundColor(.secondary) + Text(value)).font(.callout).textSelection(.enabled)
        }
        .padding(8).frame(maxWidth: .infinity, alignment: .leading).background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private func byDate(_ entries: [HistoryTabData.Entry]) -> some View {
        var groups: [(String, [HistoryTabData.Entry])] = []
        for entry in entries {
            let title = Self.dayTitle(entry.createdAt)
            if let index = groups.firstIndex(where: { $0.0 == title }) { groups[index].1.append(entry) } else { groups.append((title, [entry])) }
        }
        return VStack(alignment: .leading, spacing: 16) {
            ForEach(groups, id: \.0) { group in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(group.0).font(.headline)
                        Spacer()
                        Text("\(group.1.count) zmian").font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(group.1) { entry in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: entry.icon).foregroundStyle(Self.tint(entry.color)).frame(width: 28, height: 28)
                                .background(Self.tint(entry.color).opacity(0.18), in: RoundedRectangle(cornerRadius: 7))
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(entry.label).font(.callout.weight(.medium))
                                    Spacer()
                                    Text(Self.ago(entry.createdAt)).font(.caption).foregroundStyle(.secondary)
                                }
                                if !entry.description.isEmpty { Text(entry.description).font(.callout).foregroundStyle(.secondary) }
                                Text(entry.user).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding(14)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}
