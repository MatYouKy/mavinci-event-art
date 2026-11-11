import SwiftUI
import AppKit

// MARK: Karta weselna (1:1 z `EventWeddingCardTab` i `WeddingPeopleSchedulePanel`): status i postęp, sekcje karty z edycją
// (pola tak/nie, listy wyboru, krótkie i długie odpowiedzi, linki), kolejność podziękowań, osoby obu stron, harmonogram
// i posiłki, zabawy oczepinowe, atrakcje, Familiada, muzyka; PDF karty drukowany na Macu i zapisywany w Plikach.

struct WeddingTabData: Decodable {
    struct Card: Decodable { var id: String; var status: String; var progress: Double; var submittedAt: String?; var updatedAt: String? }
    struct Familiada: Decodable { var gameId: String; var gameName: String; var pdfPath: String?; var pdfFileName: String?; var generatedAt: String? }
    struct Pdf: Decodable { var filePath: String; var fileName: String; var generatedAt: String? }
    struct Track: Decodable, Identifiable { var id: String; var listType: String; var title: String; var artist: String?; var url: String?; var notes: String? }
    struct Attraction: Decodable, Identifiable { var id: String; var key: String; var name: String; var choice: String; var notes: String?; var game: Bool }
    struct Person: Codable, Identifiable, Hashable {
        var id: String; var side: String; var role: String; var firstName: String; var lastName: String; var phone: String; var email: String
        var instagram: String; var instagramConsent: Bool; var notes: String
    }
    struct ScheduleItem: Codable, Identifiable, Hashable {
        var id: String; var title: String; var scheduledAt: String; var category: String; var location: String; var responsible: String; var notes: String; var confirmed: Bool
    }
    struct ThanksRecipient: Codable, Hashable, Identifiable { var id: String; var name: String; var side: String }
    struct ThanksEntry: Codable, Hashable, Identifiable { var id: String; var group: String; var recipients: [ThanksRecipient]; var notes: String }
    var canManage: Bool
    var familiada: Familiada?
    var pdf: Pdf?
    var card: Card?
    var answers: [String: JSONValue]
    var thanksEntries: [ThanksEntry]?
    var tracks: [Track]
    var attractions: [Attraction]
    var people: [Person]
    var schedule: [ScheduleItem]
}

/// Definicje pól karty (`SECTIONS`, `SELECT_OPTIONS`, `BOOLEAN_FIELDS`, `SHORT_FIELDS`, `LINK_FIELDS`).
enum WeddingFields {
    struct Section { let id: String; let title: String; let symbol: String; let fields: [(String, String)] }
    static let sections: [Section] = [
        Section(id: "ceremony", title: "Ceremonia", symbol: "heart", fields: [
            ("ceremony_type", "Rodzaj ceremonii"), ("ceremony_time", "Godzina ślubu"), ("church_address", "Adres kościoła"),
            ("civil_ceremony_setting", "Miejsce ceremonii cywilnej"), ("ceremony_address", "Adres ceremonii"), ("church_wishes_enabled", "Życzenia pod kościołem")]),
        Section(id: "technical", title: "Przebieg i logistyka", symbol: "clock", fields: [
            ("guest_count", "Liczba gości"), ("ceremony", "Dodatkowe informacje o ceremonii"), ("venue_arrival_time", "Przyjazd na salę"),
            ("venue_access", "Dostęp i schody"), ("hot_vodka", "Gorzka wódka"), ("first_dance", "Pierwszy taniec"),
            ("first_dance_title", "Pierwszy taniec — tytuł utworu"), ("first_dance_artist", "Pierwszy taniec — wykonawca / wersja"),
            ("first_dance_url", "Pierwszy taniec — link do utworu"), ("first_dance_duration", "Pierwszy taniec — czas trwania"),
            ("first_dance_special_moments", "Pierwszy taniec — punkty specjalne"), ("first_dance_file_url", "Pierwszy taniec — własny plik audio"),
            ("special_toasts", "Specjalne toasty")]),
        Section(id: "welcome", title: "Przyjazd i powitanie", symbol: "mappin.and.ellipse", fields: [
            ("couple_wait_before_welcome", "Para czeka przed wjazdem na główne powitanie"), ("bread_and_salt_enabled", "Powitanie chlebem i solą"),
            ("welcome_glass_throwing", "Czy i kiedy rzucacie kieliszkami?"), ("welcome_sequence", "Kolejność powitania")]),
        Section(id: "cake", title: "Tort weselny", symbol: "sparkles", fields: [
            ("cake_time", "Godzina podania"), ("cake_presentation", "Aranżacja podania"), ("cake_proposal_url", "Wybrana propozycja tortu"), ("cake_location", "Miejsce podania")]),
        Section(id: "parents_thanks", title: "Podziękowania dla bliskich", symbol: "heart.circle", fields: [
            ("parents_thanks_enabled", "Czy planowane"), ("parents_thanks_recipients", "Komu dziękujemy"), ("parents_thanks_entries", "Kolejność wyjść"),
            ("parents_thanks_plan", "Forma podziękowań"), ("parents_thanks_proposal_url", "Wybrana propozycja podziękowań")]),
        Section(id: "oczepiny", title: "Oczepiny", symbol: "checkmark.circle", fields: [("oczepiny_enabled", "Czy planowane"), ("oczepiny_notes", "Uwagi")]),
        Section(id: "music", title: "Playlisty", symbol: "music.note", fields: [("spotify_playlist_url", "Playlista Spotify"), ("youtube_playlist_url", "Playlista YouTube")]),
        Section(id: "notes", title: "Dodatkowe informacje", symbol: "pencil", fields: [("general_notes", "Uwagi dla zespołu")]),
    ]
    static let navigation: [(String, String)] = [
        ("bride_side", "Strona Panny Młodej"), ("groom_side", "Strona Pana Młodego"), ("ceremony", "Ceremonia"), ("technical", "Informacje ogólne"),
        ("welcome", "Przyjazd i powitanie"), ("schedule", "Harmonogram i posiłki"), ("cake", "Tort weselny"), ("parents_thanks", "Podziękowania"),
        ("oczepiny", "Oczepiny i zabawy"), ("familiada", "Familiada"), ("attractions", "Atrakcje i dodatki"), ("music", "Muzyka i playlisty"),
        ("notes", "Dodatkowe informacje"), ("shared_people", "Pozostałe osoby organizacyjne"),
    ]
    static let booleans: Set<String> = ["church_wishes_enabled", "couple_wait_before_welcome", "bread_and_salt_enabled", "hot_vodka", "parents_thanks_enabled", "oczepiny_enabled"]
    static let short: Set<String> = ["guest_count", "ceremony_time", "church_address", "ceremony_address", "venue_arrival_time", "cake_time", "first_dance_title",
                                     "first_dance_artist", "first_dance_url", "first_dance_duration", "first_dance_file_url"]
    static let links: Set<String> = ["cake_proposal_url", "parents_thanks_proposal_url", "first_dance_url", "first_dance_file_url", "spotify_playlist_url", "youtube_playlist_url"]
    static let options: [String: [(String, String)]] = [
        "welcome_glass_throwing": [("vodka_before_entry", "Rzucamy kieliszkami po wódce przy powitaniu, przed wejściem na salę"),
                                   ("champagne_after_entry", "Rzucamy szampanówkami po wejściu na salę"), ("none", "Nie rzucamy kieliszkami"),
                                   ("other", "Inny przebieg — opiszemy poniżej")],
        "ceremony_type": [("church", "Kościelna"), ("civil", "Cywilna"), ("humanist", "Humanistyczna")],
        "civil_ceremony_setting": [("registry_office", "W urzędzie"), ("outdoor", "W plenerze")],
    ]
    static let statusLabels: [String: String] = [
        "not_started": "Nie rozpoczęto", "in_progress": "W trakcie uzupełniania", "submitted": "Przesłana do weryfikacji",
        "approved": "Zatwierdzona", "changes_requested": "Wymaga uzupełnienia",
    ]
    static let roleLabels: [String: String] = [
        "bride": "Panna Młoda", "groom": "Pan Młody", "witness": "Świadek / Świadkowa", "mother": "Mama", "father": "Tata",
        "godparent": "Chrzestny / Chrzestna", "guardian": "Opiekun / Opiekunka", "subcontractor": "Podwykonawca", "venue_contact": "Osoba po stronie sali", "other": "Inna osoba",
    ]
    static let thanksGroups: [(String, String)] = [("parents", "Rodzice"), ("witnesses", "Świadkowie"), ("grandparents", "Dziadkowie"), ("godparents", "Chrzestni"), ("other", "Inne osoby")]
    static let thanksSides: [(String, String)] = [("bride", "Strona Panny Młodej"), ("groom", "Strona Pana Młodego"), ("shared", "Wspólni")]
    static let scheduleCategories: [(String, String)] = [
        ("other", "Inne"), ("ceremony", "Ceremonia"), ("arrival", "Przyjazd"), ("meal", "Posiłek"), ("first_dance", "Pierwszy taniec"), ("cake", "Tort"),
        ("parents_thanks", "Podziękowania"), ("oczepiny", "Oczepiny"), ("attraction", "Atrakcja"), ("ending", "Zakończenie"),
    ]

    /// `isWeddingFieldVisible`.
    static func visible(_ key: String, ceremony: String?, thanksEnabled: Bool, thanksCount: Int) -> Bool {
        if ["church_address", "church_wishes_enabled"].contains(key) { return ceremony == "church" }
        if key == "civil_ceremony_setting" { return ceremony == "civil" }
        if key == "ceremony_address" { return ceremony == "civil" || ceremony == "humanist" }
        if key == "parents_thanks_recipients" && thanksCount > 0 { return false }
        if ["parents_thanks_recipients", "parents_thanks_plan", "parents_thanks_entries", "parents_thanks_proposal_url"].contains(key) { return thanksEnabled }
        return true
    }

    /// `formatValue`.
    static func format(_ value: JSONValue?) -> String {
        switch value {
        case nil, .null?: return "—"
        case .string(let text)?: return text.isEmpty ? "—" : text
        case .bool(let flag)?: return flag ? "Tak" : "Nie"
        case .number(let number)?: return number == number.rounded() ? String(Int(number)) : String(number)
        case .array(let items)?: return items.isEmpty ? "—" : items.map { format($0) }.joined(separator: ", ")
        case .object(let object)?:
            let entries = object.values.filter { $0 != .null && $0 != .string("") && $0 != .bool(false) }.map { format($0) }
            return entries.isEmpty ? "—" : entries.joined(separator: " · ")
        }
    }

    /// `formatThanksEntries`.
    static func thanksSummary(_ entries: [WeddingTabData.ThanksEntry]) -> String {
        entries.enumerated().map { (index, entry) -> String in
            let group = thanksGroups.first { $0.0 == entry.group }?.1 ?? entry.group
            var lines = ["Wyjście \(index + 1): \(group)"]
            for person in entry.recipients where !person.name.trimmingCharacters(in: .whitespaces).isEmpty {
                let side = thanksSides.first { $0.0 == person.side }?.1
                lines.append("• " + person.name + (side.map { " — " + $0 } ?? ""))
            }
            if !entry.notes.isEmpty { lines.append("Notatki: " + entry.notes) }
            return lines.joined(separator: "\n")
        }.joined(separator: "\n\n")
    }
}

private enum DraftValue: Hashable { case text(String), flag(Bool) }

@MainActor struct EventWeddingCardTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var category = "bride_side"
    @State private var editing = false
    @State private var draft: [String: DraftValue] = [:]
    @State private var thanks: [WeddingTabData.ThanksEntry] = []
    @State private var saving = false
    @State private var creating = false
    @State private var generating = false
    @State private var preview: NativePreview?

    private var data: WeddingTabData? { store.tab(eventID, "wedding", as: WeddingTabData.self) }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|wedding"] {
                ContentUnavailableView {
                    Label("Nie udało się pobrać karty weselnej", systemImage: "heart.text.square")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "wedding") } } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "wedding") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            if !editing { Task { await store.loadTab(eventID, "wedding") } }
        }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
    }

    @ViewBuilder private func content(_ data: WeddingTabData) -> some View {
        if let card = data.card {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header(data, card)
                    HStack(alignment: .top, spacing: 14) {
                        navigation(data)
                        VStack(alignment: .leading, spacing: 14) { panel(data, card) }.frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                }
                .padding(18)
            }
        } else {
            VStack(spacing: 12) {
                Image(systemName: "heart.text.square").font(.system(size: 44)).foregroundStyle(theme.accent)
                Text("Karta weselna nie została jeszcze rozpoczęta").font(.title3)
                Text("To tutaj pojawią się ustalenia uzupełniane przez Parę Młodą w Event Rulers. Para nie otrzymuje dostępu ani konta do CRM.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary).frame(maxWidth: 460)
                if data.canManage {
                    Button(creating ? "Tworzenie…" : "Utwórz i edytuj kartę") { Task { await create() } }.buttonStyle(.borderedProminent).disabled(creating)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity).padding(40)
        }
    }

    private func header(_ data: WeddingTabData, _ card: WeddingTabData.Card) -> some View {
        let generateTitle: String = generating ? "Generowanie…" : (data.pdf != nil ? "Aktualizuj PDF" : "Generuj PDF")
        return HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Karta weselna", systemImage: "heart.text.square").font(.title2.weight(.light))
                Text(WeddingFields.statusLabels[card.status] ?? card.status).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text("Uzupełnienie").font(.caption).foregroundStyle(.secondary)
                    ProgressView(value: min(100, max(0, card.progress)), total: 100).frame(width: 180)
                    Text("\(Int(card.progress))%").font(.caption.monospacedDigit())
                }
            }
            Spacer()
            if data.canManage {
                if editing {
                    Button { editing = false } label: { Label("Anuluj", systemImage: "xmark") }.disabled(saving)
                    Button { Task { await save() } } label: { Label(saving ? "Zapisywanie…" : "Zapisz", systemImage: "square.and.arrow.down") }
                        .buttonStyle(.borderedProminent).disabled(saving)
                } else {
                    if let pdf = data.pdf {
                        Button { Task { await open(pdf.filePath) } } label: { Label("Otwórz PDF", systemImage: "arrow.down.doc") }
                    }
                    Button { Task { await generate() } } label: { Label(generateTitle, systemImage: "printer") }
                        .disabled(generating)
                    Button { beginEditing(data) } label: { Label("Edytuj kartę", systemImage: "pencil") }
                }
            }
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func navigation(_ data: WeddingTabData) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(WeddingFields.navigation.filter { $0.0 != "familiada" || data.familiada != nil }, id: \.0) { item in
                Button { category = item.0 } label: {
                    Text(item.1).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .foregroundStyle(category == item.0 ? Color.black : Color.primary)
                        .background(category == item.0 ? theme.accent : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .frame(width: 230)
        .padding(8)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private func panel(_ data: WeddingTabData, _ card: WeddingTabData.Card) -> some View {
        switch category {
        case "bride_side", "groom_side", "shared_people", "schedule":
            WeddingPeoplePanel(store: store, eventID: eventID, data: data, view: category)
        case "familiada":
            if let familiada = data.familiada { familiadaPanel(familiada) }
        case "attractions":
            attractionsPanel(data)
        case "music":
            if let section = WeddingFields.sections.first(where: { $0.id == "music" }) { sectionPanel(data, section) }
            musicPanel(data)
        default:
            if let section = WeddingFields.sections.first(where: { $0.id == category }) { sectionPanel(data, section) }
            if category == "oczepiny" { gamesPanel(data) }
        }
    }

    // MARK: Sekcje pól

    private func ceremonyValue(_ data: WeddingTabData) -> String? {
        if editing, case .text(let value)? = draft["ceremony_type"] { return value }
        return editing ? nil : data.answers["ceremony_type"]?.text
    }
    private func thanksEnabled(_ data: WeddingTabData) -> Bool {
        if editing { if case .flag(let value)? = draft["parents_thanks_enabled"] { return value }; return false }
        return data.answers["parents_thanks_enabled"] == .bool(true)
    }

    private func sectionPanel(_ data: WeddingTabData, _ section: WeddingFields.Section) -> some View {
        let ceremony = ceremonyValue(data)
        let enabled = thanksEnabled(data)
        let thanksCount = editing ? thanks.count : (data.thanksEntries ?? []).count
        let fields = section.fields.filter { WeddingFields.visible($0.0, ceremony: ceremony, thanksEnabled: enabled, thanksCount: thanksCount) }
        let noThanks = section.id == "parents_thanks" && !editing && isExplicitlyFalse(data.answers["parents_thanks_enabled"])
        return VStack(alignment: .leading, spacing: 12) {
            Label(section.title, systemImage: section.symbol).font(.headline)
            if section.id == "welcome" {
                Text("Rekomendacja: po przyjeździe Para Młoda czeka przed głównym wjazdem, aż goście wysiądą, odłożą rzeczy i ustawią się do powitania. Dzięki temu nie wjeżdża na puste wejście.")
                    .font(.callout).padding(10).background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            if noThanks {
                Text("Bez podziękowań dla bliskich").foregroundStyle(.secondary)
            } else {
                ForEach(fields, id: \.0) { field in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(field.1).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        fieldValue(data, field.0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func isExplicitlyFalse(_ value: JSONValue?) -> Bool {
        value == .bool(false) || value == .string("false") || value == .number(0) || value == .string("0")
    }

    @ViewBuilder private func fieldValue(_ data: WeddingTabData, _ key: String) -> some View {
        if key == "parents_thanks_entries" {
            if editing { WeddingThanksEditor(entries: $thanks, people: data.people) }
            else { Text(WeddingFields.thanksSummary(data.thanksEntries ?? []).nonEmpty ?? "—").font(.callout) }
        } else if editing {
            editor(key)
        } else if WeddingFields.links.contains(key), let url = safeURL(data.answers[key]) {
            Link(destination: url) {
                Label(key == "first_dance_file_url" ? "Otwórz przesłany plik audio" : WeddingFields.format(data.answers[key]), systemImage: "arrow.up.right.square")
            }
            .font(.callout)
        } else {
            let selected = WeddingFields.options[key]?.first { $0.0 == data.answers[key]?.text }?.1
            Text(selected ?? WeddingFields.format(data.answers[key])).font(.callout).textSelection(.enabled)
        }
    }

    @ViewBuilder private func editor(_ key: String) -> some View {
        if let options = WeddingFields.options[key] {
            Picker("", selection: textBinding(key)) {
                Text("Wybierz…").tag("")
                ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
            }
            .labelsHidden()
        } else if WeddingFields.booleans.contains(key) {
            Picker("", selection: Binding<Int>(get: {
                if case .flag(let value)? = draft[key] { return value ? 1 : 0 }
                return -1
            }, set: { draft[key] = .flag($0 == 1) })) {
                Text("Tak").tag(1)
                Text("Nie").tag(0)
            }
            .labelsHidden().pickerStyle(.segmented).frame(width: 160)
        } else if WeddingFields.short.contains(key) {
            TextField("", text: textBinding(key)).textFieldStyle(.roundedBorder)
        } else {
            TextField("", text: textBinding(key), axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
        }
    }

    private func textBinding(_ key: String) -> Binding<String> {
        Binding(get: {
            if case .text(let value)? = draft[key] { return value }
            return ""
        }, set: { draft[key] = .text($0) })
    }

    private func safeURL(_ value: JSONValue?) -> URL? {
        guard let text = value?.text.trimmingCharacters(in: .whitespaces), let url = URL(string: text), ["http", "https"].contains(url.scheme ?? "") else { return nil }
        return url
    }

    // MARK: Zabawy, atrakcje, Familiada, muzyka

    @ViewBuilder private func gamesPanel(_ data: WeddingTabData) -> some View {
        let games = data.attractions.filter { $0.game && $0.choice == "selected" }
        if !games.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label("Wybrane zabawy oczepinowe", systemImage: "gamecontroller").font(.headline)
                ForEach(games) { game in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(game.name).font(.callout.weight(.medium))
                        if let notes = game.notes?.nonEmpty { Text(notes).font(.caption).foregroundStyle(.secondary) }
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(16)
            .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func attractionsPanel(_ data: WeddingTabData) -> some View {
        let list = data.attractions.filter { !$0.game }
        return VStack(alignment: .leading, spacing: 8) {
            Label("Atrakcje i dodatki", systemImage: "sparkles").font(.headline)
            if list.isEmpty {
                Text("Brak wybranych atrakcji.").foregroundStyle(.secondary)
            } else {
                ForEach(list) { item in
                    HStack {
                        Text(item.name).font(.callout)
                        Spacer()
                        Text(Self.choiceLabel(item.choice)).font(.caption).foregroundStyle(item.choice == "selected" ? Color.green : Color.secondary)
                    }
                    .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private static func choiceLabel(_ choice: String) -> String {
        switch choice {
        case "selected": return "Wybrano"
        case "interested": return "Rozważane"
        case "rejected": return "Odrzucono"
        default: return "Bez decyzji"
        }
    }

    private func familiadaPanel(_ familiada: WeddingTabData.Familiada) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Image(systemName: "gamecontroller").font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Mavinci LIVE · Familiada").font(.caption).foregroundStyle(.secondary)
                    Text(familiada.gameName).font(.title3)
                    Text("Ta rozgrywka jest przypisana do wydarzenia. Materiał jest osobnym, czytelnym arkuszem zawierającym wyłącznie pytania — bez odpowiedzi i punktacji.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                if let path = familiada.pdfPath {
                    Button { Task { await open(path) } } label: { Label("Otwórz i drukuj pytania", systemImage: "printer") }.buttonStyle(.borderedProminent)
                }
            }
            if familiada.pdfPath != nil {
                let date = familiada.generatedAt.flatMap { MeetingDates.parse($0) }.map { " · " + MeetingDates.format($0, "dd.MM.yyyy, HH:mm") } ?? ""
                Label("Arkusz pytań gotowy do druku — " + (familiada.pdfFileName ?? "Pytania Familiady") + date, systemImage: "doc.text").font(.callout)
            } else {
                Text("Gra została wybrana, ale arkusz pytań nie został jeszcze wygenerowany. Użyj przycisku „Generuj arkusz pytań” w zakładce Mavinci LIVE.")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func musicPanel(_ data: WeddingTabData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Muzyka", systemImage: "music.note").font(.headline)
            if data.tracks.isEmpty {
                Text("Lista utworów nie została jeszcze dodana.").foregroundStyle(.secondary)
            } else {
                trackGroup("Co gramy", data.tracks.filter { $0.listType != "do_not_play" })
                trackGroup("Czego nie gramy", data.tracks.filter { $0.listType == "do_not_play" })
            }
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func trackGroup(_ title: String, _ tracks: [WeddingTabData.Track]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.callout.weight(.semibold))
            if tracks.isEmpty { Text("Brak utworów.").font(.caption).foregroundStyle(.secondary) }
            ForEach(tracks) { track in
                VStack(alignment: .leading, spacing: 2) {
                    Text((track.artist.map { $0 + " — " } ?? "") + track.title).font(.callout)
                    if let url = safeURL(track.url.map { JSONValue.string($0) }) { Link("Otwórz utwór", destination: url).font(.caption) }
                    if let notes = track.notes?.nonEmpty { Text(notes).font(.caption).foregroundStyle(.secondary) }
                }
                .padding(8).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    // MARK: Czynności

    private func beginEditing(_ data: WeddingTabData) {
        var next: [String: DraftValue] = [:]
        for (key, value) in data.answers {
            switch value {
            case .bool(let flag): next[key] = .flag(flag)
            case .string(let text): next[key] = .text(text)
            case .number(let number): next[key] = .text(number == number.rounded() ? String(Int(number)) : String(number))
            case .null: next[key] = .text("")
            default: next[key] = .text(WeddingFields.format(value))
            }
        }
        draft = next
        thanks = data.thanksEntries ?? []
        if ["bride_side", "groom_side", "shared_people", "schedule", "attractions", "familiada"].contains(category) { category = "ceremony" }
        editing = true
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        var payload: [String: JSONValue] = [:]
        for (key, value) in draft {
            switch value {
            case .text(let text): payload[key] = .string(text)
            case .flag(let flag): payload[key] = .bool(flag)
            }
        }
        let encodedThanks: [JSONValue] = thanks.map { entry -> JSONValue in
            let recipients: [JSONValue] = entry.recipients.map { person -> JSONValue in
                JSONValue.object(["id": .string(person.id), "name": .string(person.name), "side": .string(person.side)])
            }
            return JSONValue.object(["id": .string(entry.id), "group": .string(entry.group), "notes": .string(entry.notes), "recipients": .array(recipients)])
        }
        payload["parents_thanks_entries"] = .array(encodedThanks)
        do {
            try await store.tabAction(eventID, "wedding", "save", ["draft": .object(payload)], reload: ["wedding"], success: "Karta Weselna została zapisana", pending: "Zapisywanie karty…")
            editing = false
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać Karty Weselnej")
        }
    }

    private func create() async {
        creating = true
        defer { creating = false }
        do {
            try await store.tabAction(eventID, "wedding", "create", [:], reload: ["wedding"], success: "Karta weselna została utworzona", pending: "Tworzenie karty…")
            draft = [:]
            thanks = []
            category = "ceremony"
            editing = true
        } catch {
            state.error = store.failureText(error, "Nie udało się utworzyć karty weselnej")
        }
    }

    /// „Generuj / Aktualizuj PDF”: karta drukowana na Macu (Chrome) albo przez serwer, zapisana w Dokumenty → Karta weselna.
    private func generate() async {
        if editing { state.snack = Snack(kind: .info, text: "Zapisz zmiany przed wygenerowaniem Karty Weselnej."); return }
        guard !generating else { return }
        generating = true
        defer { generating = false }
        await state.withPending("Generowanie Karty Weselnej — zbieramy ustalenia, osoby, harmonogram, atrakcje i muzykę…") {
            do {
                let body = try JSONEncoder().encode(["eventId": eventID])
                let result = try await state.generateStoredDocument(path: "/bridge/events/wedding-card-pdf", body: body)
                state.succeed("Karta Weselna PDF została wygenerowana.")
                if let pdf = result.pdf {
                    preview = NativePreview(name: "karta-weselna.pdf", data: pdf)
                } else {
                    if let path = (try? JSONDecoder().decode(StoredReply.self, from: result.reply))?.storagePath { await open(path) }
                }
                await store.loadTab(eventID, "wedding")
            } catch {
                state.error = store.failureText(error, "Nie udało się wygenerować Karty Weselnej.")
            }
        }
    }

    private struct FileLink: Decodable { var url: String; var name: String }
    private struct StoredReply: Decodable { var storagePath: String? }

    private func open(_ path: String) async {
        do {
            let file = try await store.tabQuery(eventID, "wedding", "file", ["path": path], as: FileLink.self)
            guard let url = URL(string: file.url) else { throw AppError.invalidResponse }
            let (data, _) = try await URLSession.shared.data(from: url)
            preview = NativePreview(name: file.name, data: data)
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć pliku.")
        }
    }
}

// MARK: Kolejność podziękowań (`WeddingThanksEditor`)

private struct WeddingThanksEditor: View {
    @Binding var entries: [WeddingTabData.ThanksEntry]
    let people: [WeddingTabData.Person]

    private func fromCard(_ group: String) -> [WeddingTabData.ThanksRecipient] {
        let roles = group == "parents" ? ["mother", "father"] : group == "witnesses" ? ["witness"] : []
        return people.filter { roles.contains($0.role) && !$0.firstName.trimmingCharacters(in: .whitespaces).isEmpty }.map {
            WeddingTabData.ThanksRecipient(id: UUID().uuidString.lowercased(), name: [$0.firstName, $0.lastName].filter { !$0.isEmpty }.joined(separator: " "),
                                           side: ["bride", "groom", "shared"].contains($0.side) ? $0.side : "")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Kolejność wyjść do podziękowań").font(.callout.weight(.semibold))
            Text("Dodajcie osobne wyjście dla każdej grupy. Rodziców i świadków pobierzemy z Karty Weselnej. Kolejność możecie zmieniać strzałkami.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(Array(entries.enumerated()), id: \.element.id) { item in entryEditor(item.offset) }
            HStack {
                ForEach(WeddingFields.thanksGroups, id: \.0) { group in
                    Button { add(group.0) } label: { Label(group.1, systemImage: "plus") }.controlSize(.small)
                }
            }
        }
    }

    private func entryEditor(_ index: Int) -> some View {
        let entry = entries[index]
        let groupLabel = WeddingFields.thanksGroups.first { $0.0 == entry.group }?.1 ?? entry.group
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Wyjście \(index + 1): \(groupLabel)").font(.callout.weight(.medium))
                Spacer()
                Button { entries.swapAt(index, index - 1) } label: { Image(systemName: "arrow.up") }.disabled(index == 0)
                Button { entries.swapAt(index, index + 1) } label: { Image(systemName: "arrow.down") }.disabled(index == entries.count - 1)
                Button { entries.remove(at: index) } label: { Image(systemName: "trash") }.foregroundStyle(.red)
            }
            .buttonStyle(.borderless)
            ForEach(Array(entry.recipients.enumerated()), id: \.element.id) { person in
                HStack {
                    TextField("Imię osoby", text: Binding(get: { entries.indices.contains(index) && entries[index].recipients.indices.contains(person.offset) ? entries[index].recipients[person.offset].name : "" },
                                                          set: { if entries.indices.contains(index) && entries[index].recipients.indices.contains(person.offset) { entries[index].recipients[person.offset].name = $0 } }))
                        .textFieldStyle(.roundedBorder)
                    Picker("", selection: Binding(get: { entries.indices.contains(index) && entries[index].recipients.indices.contains(person.offset) ? entries[index].recipients[person.offset].side : "" },
                                                  set: { if entries.indices.contains(index) && entries[index].recipients.indices.contains(person.offset) { entries[index].recipients[person.offset].side = $0 } })) {
                        Text("Wybierz stronę…").tag("")
                        ForEach(WeddingFields.thanksSides, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .labelsHidden().frame(width: 200)
                    Button { entries[index].recipients.remove(at: person.offset) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red)
                }
            }
            HStack {
                Button { entries[index].recipients.append(WeddingTabData.ThanksRecipient(id: UUID().uuidString.lowercased(), name: "", side: "")) } label: { Label("Dodaj osobę", systemImage: "plus") }
                if ["parents", "witnesses"].contains(entry.group) {
                    Button { addMissing(index) } label: { Label("Dodaj brakujące osoby z karty", systemImage: "arrow.clockwise") }
                }
            }
            .controlSize(.small)
            if ["parents", "witnesses"].contains(entry.group) && fromCard(entry.group).isEmpty {
                Text("Brak imion w poprzednich krokach. Możecie je uzupełnić w karcie lub wpisać tutaj.").font(.caption).foregroundStyle(.secondary)
            }
            TextField("Notatki do tego wyjścia (opcjonalnie)", text: Binding(get: { entries.indices.contains(index) ? entries[index].notes : "" },
                                                                             set: { if entries.indices.contains(index) { entries[index].notes = $0 } }), axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.roundedBorder)
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func add(_ group: String) {
        let recipients = fromCard(group)
        entries.append(WeddingTabData.ThanksEntry(id: UUID().uuidString.lowercased(), group: group,
                                                  recipients: recipients.isEmpty ? [WeddingTabData.ThanksRecipient(id: UUID().uuidString.lowercased(), name: "", side: "")] : recipients,
                                                  notes: ""))
    }
    private func addMissing(_ index: Int) {
        let entry = entries[index]
        let candidates = fromCard(entry.group).filter { candidate in
            !entry.recipients.contains { $0.name.trimmingCharacters(in: .whitespaces) == candidate.name.trimmingCharacters(in: .whitespaces) && $0.side == candidate.side }
        }
        entries[index].recipients = entry.recipients.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty || !$0.side.isEmpty } + candidates
    }
}

// MARK: Osoby i harmonogram (`WeddingPeopleSchedulePanel`)

@MainActor private struct WeddingPeoplePanel: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let data: WeddingTabData
    let view: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editing = false
    @State private var saving = false
    @State private var people: [WeddingTabData.Person] = []
    @State private var schedule: [WeddingTabData.ScheduleItem] = []

    private var side: String? { view == "bride_side" ? "bride" : view == "groom_side" ? "groom" : view == "shared_people" ? "shared" : nil }
    private var copy: (String, String) {
        switch view {
        case "bride_side": return ("Strona Panny Młodej", "Panna Młoda, świadek, rodzice i inne bliskie osoby.")
        case "groom_side": return ("Strona Pana Młodego", "Pan Młody, świadek, rodzice i inne bliskie osoby.")
        case "shared_people": return ("Pozostałe osoby organizacyjne", "Osoby po stronie sali i pozostali uczestnicy — zapisz imię, telefon oraz opcjonalny e-mail.")
        default: return ("Harmonogram i posiłki", "Wspólna kolejność dnia widoczna również w Strefie Pary Młodej.")
        }
    }

    /// `withRequiredPeople`: Panna/Pan Młody, świadek, mama i tata zawsze na liście strony.
    private static func padded(_ people: [WeddingTabData.Person]) -> [WeddingTabData.Person] {
        func side(_ name: String) -> [WeddingTabData.Person] {
            let roles = [name == "bride" ? "bride" : "groom", "witness", "mother", "father"]
            let existing = people.filter { $0.side == name }
            let required = roles.map { role in existing.first { $0.role == role } ?? blank(name, role) }
            return required + existing.filter { !roles.contains($0.role) }
        }
        return side("bride") + side("groom") + people.filter { $0.side == "shared" }
    }
    private static func blank(_ side: String, _ role: String) -> WeddingTabData.Person {
        WeddingTabData.Person(id: UUID().uuidString.lowercased(), side: side, role: role, firstName: "", lastName: "", phone: "", email: "", instagram: "", instagramConsent: false, notes: "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(copy.0).font(.headline)
                    Text(copy.1).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if data.canManage {
                    if editing {
                        Button { editing = false; reset() } label: { Image(systemName: "xmark") }.disabled(saving)
                        Button { Task { await save() } } label: { Label(saving ? "Zapisywanie…" : "Zapisz", systemImage: "square.and.arrow.down") }
                            .buttonStyle(.borderedProminent).disabled(saving)
                    } else {
                        Button { reset(); editing = true } label: { Label("Edytuj", systemImage: "pencil") }
                    }
                }
            }
            if let side { peopleList(side) } else { scheduleList }
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .onAppear(perform: reset)
        .onChange(of: data.people) { _, _ in if !editing { reset() } }
        .onChange(of: data.schedule) { _, _ in if !editing { reset() } }
    }

    private func reset() {
        people = Self.padded(data.people)
        schedule = data.schedule
    }

    private func peopleList(_ side: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(side == "bride" ? "Strona Panny Młodej" : side == "groom" ? "Strona Pana Młodego" : "Pozostałe osoby organizacyjne", systemImage: "person.2")
                .font(.callout.weight(.semibold))
            ForEach($people) { $person in
                if person.side == side { personRow($person) }
            }
            if editing {
                Button { people.append(Self.blank(side, side == "shared" ? "venue_contact" : "godparent")) } label: { Label("Dodaj osobę", systemImage: "plus") }.controlSize(.small)
            }
        }
    }

    private func personRow(_ person: Binding<WeddingTabData.Person>) -> some View {
        let value = person.wrappedValue
        let couple = ["bride", "groom"].contains(value.role)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(WeddingFields.roleLabels[value.role] ?? value.role).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                Spacer()
                if editing && value.role == "other" {
                    Button { let id = value.id; people.removeAll { $0.id == id } } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red)
                }
            }
            if editing {
                HStack {
                    TextField("Imię", text: person.firstName)
                    TextField("Telefon", text: person.phone)
                    TextField("E-mail (opcjonalnie)", text: person.email)
                }
                .textFieldStyle(.roundedBorder)
                if couple {
                    HStack {
                        TextField("Instagram, np. @ania", text: Binding(get: { person.wrappedValue.instagram }, set: { person.wrappedValue.instagram = $0.replacingOccurrences(of: "^@+", with: "", options: .regularExpression) }))
                            .textFieldStyle(.roundedBorder)
                        Toggle("Zgoda na oznaczanie profilu przez Event Rulers", isOn: person.instagramConsent)
                    }
                }
            } else {
                Text([value.firstName, value.lastName].filter { !$0.isEmpty }.joined(separator: " ").nonEmpty ?? "Nie uzupełniono").font(.callout.weight(.medium))
                if !value.phone.isEmpty { Text(value.phone).font(.caption).textSelection(.enabled) }
                if !value.email.isEmpty { Text(value.email).font(.caption).textSelection(.enabled) }
                if couple && !value.instagram.isEmpty {
                    Text("@\(value.instagram) · " + (value.instagramConsent ? "zgoda na oznaczanie" : "bez zgody na oznaczanie")).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private var scheduleList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Harmonogram wesela", systemImage: "calendar.badge.clock").font(.callout.weight(.semibold))
            Text("Rekomendujemy planowanie wydawania posiłków o pełnych godzinach. Pozycje typu „Posiłek” są wspólnym harmonogramem CRM i Strefy Pary Młodej.")
                .font(.caption).padding(8).background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            ForEach($schedule) { $item in scheduleRow($item) }
            if editing {
                HStack {
                    Button { schedule.append(newItem("", "other")) } label: { Label("Dodaj punkt harmonogramu", systemImage: "plus") }
                    Button { schedule.append(newItem("Wydanie posiłku", "meal")) } label: { Label("Dodaj posiłek", systemImage: "plus") }
                }
                .controlSize(.small)
            }
        }
    }

    private func newItem(_ title: String, _ category: String) -> WeddingTabData.ScheduleItem {
        WeddingTabData.ScheduleItem(id: UUID().uuidString.lowercased(), title: title, scheduledAt: "", category: category, location: "", responsible: "", notes: "", confirmed: false)
    }

    /// Termin punktu to pełny znacznik ISO z bazy (strefa zachowana) — wyświetlany i edytowany w czasie polskim.
    private func scheduleDate(_ text: String) -> Date? { text.isEmpty ? nil : MeetingDates.parse(text) }

    private func scheduleRow(_ item: Binding<WeddingTabData.ScheduleItem>) -> some View {
        let value = item.wrappedValue
        let index = schedule.firstIndex { $0.id == value.id } ?? 0
        let when: String = scheduleDate(value.scheduledAt).map { MeetingDates.format($0, "dd.MM.yyyy, HH:mm") } ?? "Punkt \(index + 1)"
        return HStack(spacing: 8) {
            if editing {
                DatePicker("", selection: Binding(get: { scheduleDate(item.wrappedValue.scheduledAt) ?? Date() }, set: { item.wrappedValue.scheduledAt = MeetingDates.iso($0) }))
                    .labelsHidden().frame(width: 170)
                Picker("", selection: item.category) { ForEach(WeddingFields.scheduleCategories, id: \.0) { Text($0.1).tag($0.0) } }
                    .labelsHidden().frame(width: 140)
                TextField("Punkt harmonogramu", text: item.title).textFieldStyle(.roundedBorder)
                TextField("Miejsce / odpowiedzialny", text: item.location).textFieldStyle(.roundedBorder)
                Button { let id = value.id; schedule.removeAll { $0.id == id } } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red)
            } else {
                Text(when).font(.callout).foregroundStyle(theme.accent)
                    .frame(width: 150, alignment: .leading)
                Text(value.category == "meal" ? "Posiłek" : value.category).font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: 100, alignment: .leading)
                Text(value.title).font(.callout)
                Spacer()
                Text(value.location.nonEmpty ?? value.responsible.nonEmpty ?? "—").font(.callout).foregroundStyle(.secondary)
            }
        }
        .padding(8).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        let encodedPeople: [JSONValue] = people.map { p -> JSONValue in
            .object(["id": .string(p.id), "side": .string(p.side), "role": .string(p.role), "firstName": .string(p.firstName), "lastName": .string(p.lastName),
                     "phone": .string(p.phone), "email": .string(p.email), "instagram": .string(p.instagram), "instagramConsent": .bool(p.instagramConsent), "notes": .string(p.notes)])
        }
        let encodedSchedule: [JSONValue] = schedule.map { i -> JSONValue in
            let at: JSONValue = scheduleDate(i.scheduledAt).map { JSONValue.string(MeetingDates.iso($0)) } ?? JSONValue.null
            return .object(["id": .string(i.id), "title": .string(i.title), "scheduledAt": at, "category": .string(i.category), "location": .string(i.location),
                            "responsible": .string(i.responsible), "notes": .string(i.notes), "confirmed": .bool(i.confirmed)])
        }
        do {
            try await store.tabAction(eventID, "wedding", "saveTeam", ["people": .array(encodedPeople), "schedule": .array(encodedSchedule)], reload: ["wedding"],
                                      success: "Osoby i harmonogram zostały zapisane", pending: "Zapisywanie…")
            editing = false
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać osób lub harmonogramu")
        }
    }
}
