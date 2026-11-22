import SwiftUI

// MARK: Dodawanie z kalendarza — „Co chcesz dodać?” jak `EventTypeSelector` w CRM (kliknięcie dnia albo „Dodaj”):
// wydarzenie biznesowe / indywidualne (kreator wydarzenia z terminem tego dnia), spotkanie (formularz spotkania 9:00–10:00)
// i zapytanie (formularz „Nowe zapytanie” z terminem tego dnia — `NewInquirySheet`).

enum CalendarCreateKind: String, CaseIterable, Identifiable {
    case business, individual, meeting, inquiry
    var id: String { rawValue }
    var title: String {
        switch self {
        case .business: return "Event biznesowy"
        case .individual: return "Event indywidualny"
        case .meeting: return "Spotkanie"
        case .inquiry: return "Zapytanie"
        }
    }
    var subtitle: String {
        switch self {
        case .business: return "Pełny event z organizacją/firmą"
        case .individual: return "Pełny event z osobą prywatną"
        case .meeting: return "Szybkie spotkanie lub przypomnienie"
        case .inquiry: return "Szybka notatka z rozmowy z klientem"
        }
    }
    var symbol: String {
        switch self {
        case .business: return "building.2"
        case .individual: return "person"
        case .meeting: return "calendar"
        case .inquiry: return "phone.arrow.down.left"
        }
    }
}

/// Arkusz otwarty z kalendarza: wybór rodzaju, kreator wydarzenia albo formularz spotkania (jeden arkusz — zmiana rodzaju
/// zamienia jego treść).
enum CalendarCreation: Identifiable {
    case chooser(Date)
    case event(Date, String)
    case meeting(MeetingEditorRequest)
    case inquiry(Date)
    var id: String {
        switch self {
        case .chooser(let date): return "chooser-\(date.timeIntervalSince1970)"
        case .event(let date, let clientType): return "event-\(clientType)-\(date.timeIntervalSince1970)"
        case .meeting(let request): return "meeting-\(request.id.uuidString)"
        case .inquiry(let date): return "inquiry-\(date.timeIntervalSince1970)"
        }
    }
}

/// „Co chcesz dodać?” — karty jak w CRM; bez uprawnień do wydarzeń tylko spotkanie i zapytanie.
@MainActor struct CalendarCreateChooser: View {
    let date: Date
    let canCreateEvents: Bool
    let canCreateInquiries: Bool
    let choose: (CalendarCreateKind) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    private var kinds: [CalendarCreateKind] {
        CalendarCreateKind.allCases.filter { kind in
            switch kind {
            case .business, .individual: return canCreateEvents
            case .meeting: return true
            case .inquiry: return canCreateInquiries
            }
        }
    }

    private var subtitle: String {
        let day: String = CalendarDates.title(date, format: "EEEE, d MMMM yyyy")
        return canCreateEvents ? "Wybierz, co chcesz utworzyć — \(day)" : "Możesz utworzyć nowe spotkanie lub zapytanie — \(day)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Co chcesz dodać?").font(.title2.weight(.semibold))
                Text(subtitle).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: min(kinds.count, 4)), spacing: 14) {
                ForEach(kinds) { kind in card(kind) }
            }
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }
        .padding(26)
        .frame(width: kinds.count > 2 ? 820 : 520)
    }

    private func card(_ kind: CalendarCreateKind) -> some View {
        Button { choose(kind) } label: {
            VStack(spacing: 12) {
                Image(systemName: kind.symbol).font(.system(size: 26)).foregroundStyle(theme.accent)
                    .frame(width: 58, height: 58).background(theme.accent.opacity(0.12), in: Circle())
                VStack(spacing: 4) {
                    Text(kind.title).font(.headline).multilineTextAlignment(.center)
                    Text(kind.subtitle).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(18).frame(maxWidth: .infinity, minHeight: 190, alignment: .top)
            .background(theme.accent.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.25)))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
