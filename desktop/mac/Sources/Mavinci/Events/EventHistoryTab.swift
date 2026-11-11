import SwiftUI
import AppKit

// MARK: Historia zmian (dane jak w widoku historii `EventDetailPageClient`): liczniki zmian i osób, odśwież, filtr rodzaju zmiany,
// natywna tabela (autor, kiedy, czynność, opis, przed → po) ze szczegółami zaznaczonej zmiany pod tabelą.

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
    @State private var filter = "all"
    @State private var selected: String?

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

    @ViewBuilder private func content(_ data: HistoryTabData) -> some View {
        let users = Set(data.entries.map(\.userKey)).count
        let counts = Dictionary(grouping: data.entries, by: \.action).mapValues(\.count)
        let options: [(String, String)] = [("create", "Utworzenia"), ("update", "Aktualizacje"), ("delete", "Usunięcia"), ("status_changed", "Zmiany statusu")]
        let entries = filter == "all" ? data.entries : data.entries.filter { $0.action == filter }
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Historia zmian").font(.title2.weight(.semibold))
                Text(NativeList.count(data.entries.count, "zmiana", "zmiany", "zmian") + " · " + NativeList.count(users, "osoba", "osoby", "osób"))
                    .foregroundStyle(.secondary)
                Spacer()
                Picker("Pokaż", selection: $filter) {
                    Text("Wszystkie (\(data.entries.count))").tag("all")
                    ForEach(options.filter { (counts[$0.0] ?? 0) > 0 }, id: \.0) { option in
                        Text(option.1 + " (\(counts[option.0] ?? 0))").tag(option.0)
                    }
                }
                .fixedSize()
                Button { Task { await store.loadTab(eventID, "history") } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.help("Odśwież historię")
            }
            .padding(.horizontal, 18).padding(.top, 12)
            if data.entries.isEmpty {
                ContentUnavailableView("Brak historii zmian", systemImage: "clock.arrow.circlepath")
            } else {
                VSplitView {
                    table(entries).frame(minHeight: 160, idealHeight: 360)
                    detail(entries).frame(minHeight: 100, idealHeight: 200, maxHeight: .infinity)
                }
            }
        }
    }

    /// Natywna tabela zmian (najnowsze na górze); szczegóły i wartości „Przed / Po” zaznaczonej zmiany pod tabelą.
    private func table(_ entries: [HistoryTabData.Entry]) -> some View {
        Table(entries, selection: $selected) {
            TableColumn("") { (entry: HistoryTabData.Entry) in avatar(entry) }.width(34)
            TableColumn("Kiedy") { (entry: HistoryTabData.Entry) in
                Text(Self.stamp(entry.createdAt)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1).help(Self.ago(entry.createdAt))
            }.width(min: 110, ideal: 130)
            TableColumn("Osoba") { (entry: HistoryTabData.Entry) in Text(entry.user).lineLimit(1) }.width(min: 100, ideal: 170)
            TableColumn("Czynność") { (entry: HistoryTabData.Entry) in
                HStack(spacing: 6) {
                    Image(systemName: entry.icon).font(.caption).foregroundStyle(Self.tint(entry.color)).frame(width: 14)
                    Text(entry.label).lineLimit(1)
                }
            }.width(min: 110, ideal: 150)
            TableColumn("Dotyczy") { (entry: HistoryTabData.Entry) in Text(entry.entity ?? "—").foregroundStyle(.secondary).lineLimit(1) }
                .width(min: 80, ideal: 130)
            TableColumn("Opis") { (entry: HistoryTabData.Entry) in
                Text(entry.description).lineLimit(1).help(entry.description)
            }.width(min: 160, ideal: 360)
            TableColumn("Zmiana") { (entry: HistoryTabData.Entry) in
                if entry.showChanges && (entry.before != nil || entry.after != nil) {
                    Text((entry.before ?? "—") + " → " + (entry.after ?? "—")).foregroundStyle(.secondary).lineLimit(1)
                        .help("Przed: " + (entry.before ?? "—") + "\nPo: " + (entry.after ?? "—"))
                } else {
                    Text("")
                }
            }.width(min: 100, ideal: 220)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let entry = entries.first(where: { $0.id == id }) {
                if let employee = entry.employee {
                    Button("Karta pracownika", systemImage: "person.text.rectangle") { state.showEmployee(employee.id) }
                }
                Button("Kopiuj opis", systemImage: "doc.on.doc") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(entry.description, forType: .string)
                }
            }
        } primaryAction: { ids in
            if let id = ids.first, let employee = entries.first(where: { $0.id == id })?.employee { state.showEmployee(employee.id) }
        }
    }

    @ViewBuilder private func avatar(_ entry: HistoryTabData.Entry) -> some View {
        if let employee = entry.employee {
            EmployeeAvatarView(name: employee.name, url: employee.avatarUrl, crop: employee.avatar, size: 24).help(employeeHelp(entry, employee))
        } else {
            Image(systemName: "person.crop.circle").font(.title3).foregroundStyle(.secondary).frame(width: 24, height: 24)
        }
    }

    @ViewBuilder private func detail(_ entries: [HistoryTabData.Entry]) -> some View {
        if let entry = entries.first(where: { $0.id == selected }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        if let employee = entry.employee {
                            Button { state.showEmployee(employee.id) } label: {
                                EmployeeAvatarView(name: employee.name, url: employee.avatarUrl, crop: employee.avatar, size: 40)
                            }
                            .buttonStyle(.plain).help(employeeHelp(entry, employee))
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 8) {
                                EventDotLabel(label: entry.label, color: Self.tint(entry.color)).font(.callout.weight(.semibold))
                                if let entity = entry.entity { Text(entity).font(.callout).foregroundStyle(.secondary) }
                            }
                            Text(entry.user + " · " + Self.stamp(entry.createdAt) + " · " + Self.ago(entry.createdAt)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if !entry.description.isEmpty { Text(entry.description).font(.callout).textSelection(.enabled) }
                    if entry.showChanges && (entry.before != nil || entry.after != nil) {
                        if let before = entry.before { change("Przed: ", before, "minus", CrmTheme.rgb(0xf87171)) }
                        if let after = entry.after { change("Po: ", after, "plus", CrmTheme.rgb(0x4ade80)) }
                    }
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            Text("Zaznacz zmianę, aby zobaczyć szczegóły. Dwuklik otwiera kartę osoby.")
                .foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func employeeHelp(_ entry: HistoryTabData.Entry, _ employee: HistoryTabData.Employee) -> String {
        var lines = [entry.user]
        if let occupation = employee.occupation?.nonEmpty { lines.append(occupation) }
        if let email = employee.email?.nonEmpty { lines.append(email) }
        lines.append("Kliknij aby przejść do profilu")
        return lines.joined(separator: "\n")
    }

    private func change(_ title: String, _ value: String, _ symbol: String, _ color: Color) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: symbol).font(.caption.weight(.bold)).foregroundStyle(color)
            (Text(title).foregroundColor(.secondary) + Text(value)).font(.callout).textSelection(.enabled)
        }
        .padding(8).frame(maxWidth: .infinity, alignment: .leading).background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

}
