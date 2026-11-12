import SwiftUI
import AppKit

// MARK: Ustalenia sprzedawcy w pracy zespołu realizacji: karta w Przeglądzie (fakty, kontakty, potwierdzenie zapoznania przez
// kierownika realizacji, „zmienione po potwierdzeniu”) i paski „Ustalenia sprzedawcy” w zakładkach Harmonogram, Agenda,
// Sprzęt, Logistyka i Zespół. Dane: `tab=arrangements` (`get_event_arrangements`, bez kwot oferty).

struct EventArrangementsData: Decodable {
    struct Contact: Decodable, Hashable { var name: String?; var role: String?; var phone: String?; var email: String? }
    struct Day: Decodable, Hashable { var date: String?; var start: String?; var end: String? }
    struct Venue: Decodable, Hashable { var name: String?; var room: String?; var technical: String? }
    struct Acknowledgement: Decodable, Hashable { var employeeId: String; var name: String?; var revision: Int; var at: String? }
    struct Offer: Decodable, Identifiable, Hashable {
        var offerId: String
        var number: String?
        var title: String?
        var status: String?
        var revision: Int
        var updatedAt: String?
        var updatedBy: String?
        var room: String?
        var participants: Double?
        var setupAt: String?
        var startsAt: String?
        var endsAt: String?
        var teardownAt: String?
        var materialsDue: String?
        var technical: String?
        var logistics: String?
        var contacts: [Contact]
        var days: [Day]
        var venue: Venue?
        var acknowledgements: [Acknowledgement]
        var id: String { offerId }
        var label: String { [number, title].compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "Oferta" }
    }
    var available: Bool
    var message: String?
    var offers: [Offer]
    var managerId: String?
    var me: String

    var isManager: Bool { managerId != nil && managerId == me }
    /// Potwierdzenie osoby dla wszystkich ofert: brak / aktualne / nieaktualne (ustalenia zmieniły się później).
    func acknowledgement(of employee: String?) -> (state: String, at: String?) {
        guard let employee, !offers.isEmpty else { return ("none", nil) }
        var latest: String?
        for offer in offers {
            guard let ack = offer.acknowledgements.first(where: { $0.employeeId == employee }) else { return ("none", nil) }
            if ack.revision < offer.revision { return ("stale", ack.at) }
            latest = max(latest ?? "", ack.at ?? "")
        }
        return ("current", latest)
    }
}

enum ArrangementText {
    /// „2026-11-13T09:00” → „13.11, 09:00”.
    static func when(_ value: String?) -> String? {
        guard let value, value.count >= 16 else { return value }
        let date = value.prefix(10).split(separator: "-")
        guard date.count == 3 else { return value }
        return "\(date[2]).\(date[1]), " + String(value.dropFirst(11).prefix(5))
    }
    static func day(_ value: String?) -> String? {
        guard let value, value.count >= 10 else { return value }
        let parts = value.prefix(10).split(separator: "-")
        return parts.count == 3 ? "\(parts[2]).\(parts[1]).\(parts[0])" : value
    }
    static func stamp(_ value: String?) -> String? {
        guard let value, let date = MeetingDates.parse(value) else { return day(value) }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }
}

/// Obszar pracy, przy którym pokazujemy pasek ustaleń.
enum ArrangementArea {
    case timeline, agenda, equipment, logistics, team

    /// Wiersze paska dla obszaru (tytuł, treść) — tylko to, co dotyczy danej zakładki.
    func lines(_ offer: EventArrangementsData.Offer) -> [(String, String)] {
        var result: [(String, String)] = []
        let add: (String, String?) -> Void = { title, value in
            if let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty { result.append((title, value)) }
        }
        let days = offer.days.map { day in
            (ArrangementText.day(day.date) ?? "") + ((day.start ?? "").isEmpty ? "" : " " + (day.start ?? "") + "–" + (day.end ?? ""))
        }.joined(separator: " · ")
        switch self {
        case .timeline:
            add("Montaż", ArrangementText.when(offer.setupAt))
            add("Start", ArrangementText.when(offer.startsAt))
            add("Koniec", ArrangementText.when(offer.endsAt))
            add("Demontaż", ArrangementText.when(offer.teardownAt))
            add("Dni wydarzenia", days)
        case .agenda:
            add("Start", ArrangementText.when(offer.startsAt))
            add("Koniec", ArrangementText.when(offer.endsAt))
            add("Dni wydarzenia", days)
            add("Sala", offer.room ?? offer.venue?.room)
            add("Liczba osób", offer.participants.map { String(Int($0)) })
        case .equipment:
            add("Wymagania techniczne", offer.technical)
            add("Technika na miejscu", offer.venue?.technical)
            add("Sala", offer.room ?? offer.venue?.room)
            add("Liczba osób", offer.participants.map { String(Int($0)) })
        case .logistics:
            add("Wymagania logistyczne", offer.logistics)
            add("Miejsce", offer.venue?.name)
            add("Montaż", ArrangementText.when(offer.setupAt))
            add("Demontaż", ArrangementText.when(offer.teardownAt))
            add("Materiały do", ArrangementText.day(offer.materialsDue))
        case .team:
            add("Kontakty na miejscu", offer.contacts.map { contact in
                [contact.name, contact.role, contact.phone, contact.email].compactMap { $0 }.joined(separator: " · ")
            }.joined(separator: "\n"))
            add("Liczba osób", offer.participants.map { String(Int($0)) })
        }
        return result
    }
}

/// Pasek „Ustalenia sprzedawcy” u góry zakładki (zwijany; pokazuje się tylko, gdy są ustalenia dla tego obszaru).
@MainActor struct EventArrangementsBanner: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let area: ArrangementArea
    @Environment(\.crmTheme) private var theme
    @AppStorage("eventArrangements.bannerOpen") private var open = true

    private var data: EventArrangementsData? { store.tab(eventID, "arrangements", as: EventArrangementsData.self) }

    var body: some View {
        Group {
            if let data, data.available {
                let groups = data.offers.map { ($0, area.lines($0)) }.filter { !$0.1.isEmpty }
                if !groups.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Button { withAnimation(.easeInOut(duration: 0.15)) { open.toggle() } } label: {
                            HStack(spacing: 6) {
                                Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption.weight(.semibold)).frame(width: 12)
                                Label("Ustalenia sprzedawcy", systemImage: "bubble.left.and.text.bubble.right")
                                    .font(.callout.weight(.semibold))
                                if data.acknowledgement(of: data.managerId).state == "stale" {
                                    Text("zmienione po potwierdzeniu").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                                }
                                Spacer()
                                if let first = data.offers.first, let stamp = ArrangementText.stamp(first.updatedAt) {
                                    Text("aktualizacja " + stamp + (first.updatedBy.map { " · " + $0 } ?? "")).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if open {
                            ForEach(groups, id: \.0.id) { group in
                                VStack(alignment: .leading, spacing: 3) {
                                    if groups.count > 1 { Text(group.0.label).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 3) {
                                        ForEach(Array(group.1.enumerated()), id: \.offset) { line in
                                            GridRow(alignment: .top) {
                                                Text(line.element.0).font(.caption).foregroundStyle(.secondary)
                                                Text(line.element.1).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "arrangements") }
    }
}

/// Karta „Ustalenia” w Przeglądzie: najważniejsze fakty, kontakty na miejscu i potwierdzenie zapoznania się z ustaleniami
/// (kierownik realizacji przy przejęciu imprezy; zmiany po potwierdzeniu są oznaczone).
@MainActor struct EventArrangementsCard: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var busy = false

    private var data: EventArrangementsData? { store.tab(eventID, "arrangements", as: EventArrangementsData.self) }

    var body: some View {
        Group {
            if let data {
                if !data.available {
                    if let message = data.message {
                        cardBody {
                            Text(message).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                } else if !data.offers.isEmpty {
                    cardBody { content(data) }
                }
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "arrangements") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await store.loadTab(eventID, "arrangements") }
        }
    }

    private func cardBody<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Ustalenia sprzedawcy", systemImage: "bubble.left.and.text.bubble.right").font(.callout.weight(.semibold))
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private func content(_ data: EventArrangementsData) -> some View {
        let manager = data.acknowledgement(of: data.managerId)
        let mine = data.acknowledgement(of: data.me)
        ForEach(data.offers) { offer in
            VStack(alignment: .leading, spacing: 4) {
                if data.offers.count > 1 { Text(offer.label).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                facts(offer)
            }
        }
        Divider()
        if data.managerId == nil {
            EventDotLabel(label: "Brak kierownika realizacji — potwierdzenie po jego wyznaczeniu", color: .secondary).font(.caption)
        } else {
            switch manager.state {
            case "current":
                EventDotLabel(label: "Kierownik potwierdził " + (ArrangementText.stamp(manager.at) ?? ""), color: CrmTheme.rgb(0x4ade80)).font(.caption)
            case "stale":
                EventDotLabel(label: "Ustalenia zmieniły się po potwierdzeniu kierownika", color: .orange).font(.caption)
            default:
                EventDotLabel(label: "Kierownik nie potwierdził jeszcze ustaleń", color: CrmTheme.rgb(0xfacc15)).font(.caption)
            }
        }
        if mine.state != "current" {
            Button {
                Task { await acknowledge() }
            } label: {
                Label(mine.state == "stale" ? "Zapoznałem się ze zmianami" : "Zapoznałem się z ustaleniami", systemImage: "checkmark.seal")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(busy)
            .help(data.isManager ? "Potwierdzenie przejęcia ustaleń przez kierownika realizacji" : "Potwierdzenie, że znasz ustalenia ze sprzedawcą")
        }
    }

    private func facts(_ offer: EventArrangementsData.Offer) -> some View {
        let rows: [(String, String?)] = [
            ("Montaż", ArrangementText.when(offer.setupAt)),
            ("Wydarzenie", [ArrangementText.when(offer.startsAt), ArrangementText.when(offer.endsAt)].compactMap { $0 }.joined(separator: " – ").nonEmpty),
            ("Demontaż", ArrangementText.when(offer.teardownAt)),
            ("Sala", offer.room ?? offer.venue?.room),
            ("Osoby", offer.participants.map { String(Int($0)) }),
            ("Materiały do", ArrangementText.day(offer.materialsDue)),
        ]
        let visible = rows.compactMap { row in row.1.map { (row.0, $0) } }
        return VStack(alignment: .leading, spacing: 4) {
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 3) {
                ForEach(Array(visible.enumerated()), id: \.offset) { item in
                    GridRow {
                        Text(item.element.0).foregroundStyle(.secondary)
                        Text(item.element.1).monospacedDigit()
                    }
                }
            }
            .font(.caption)
            if let technical = offer.technical { Text("Technika: " + technical).font(.caption).lineLimit(3).help(technical) }
            if let logistics = offer.logistics { Text("Logistyka: " + logistics).font(.caption).lineLimit(3).help(logistics) }
            ForEach(offer.contacts, id: \.self) { contact in
                HStack(spacing: 6) {
                    Image(systemName: "person.crop.circle").foregroundStyle(.secondary)
                    Text([contact.name, contact.role].compactMap { $0 }.joined(separator: " · ")).lineLimit(1)
                    Spacer(minLength: 4)
                    if let phone = contact.phone {
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(phone, forType: .string)
                            state.succeed("Skopiowano numer: " + phone)
                        } label: { Image(systemName: "phone") }
                        .buttonStyle(.borderless).help(phone)
                    }
                    if let email = contact.email, let url = URL(string: "mailto:" + email) {
                        Link(destination: url) { Image(systemName: "envelope") }.help(email)
                    }
                }
                .font(.caption)
            }
            if let stamp = ArrangementText.stamp(offer.updatedAt) {
                Text("Aktualizacja " + stamp + (offer.updatedBy.map { " · " + $0 } ?? "") + " · wersja \(offer.revision)")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private func acknowledge() async {
        busy = true
        defer { busy = false }
        do {
            try await store.tabAction(eventID, "arrangements", "acknowledge", [:], reload: ["arrangements"],
                                      success: "Potwierdzono zapoznanie się z ustaleniami", pending: "Zapisywanie potwierdzenia…")
        } catch {
            state.error = store.failureText(error, "Nie udało się potwierdzić ustaleń.")
        }
    }
}
