import SwiftUI
import AppKit

// MARK: Przetargi → Konfiguracja filtrów — 1:1 z CRM (`/crm/tenders/config`) i telefonem (`TenderFilterConfigSheet`).
// Lista konfiguracji (aktywna oznaczona), ustawienia podstawowe (nazwa, minimalna ocena trafności, maks. dni do terminu,
// „Powiadom od oceny”, „Konfiguracja aktywna”) i cztery listy: słowa kluczowe, słowa wykluczające, kody CPV, lokalizacje.
// Pozycje: ↩ albo „Dodaj” (kilka naraz — rozdzielone nowymi liniami, przecinkami, średnikami lub kropkami), wklejenie kilku
// linii (⌘V) albo „Wklej listę” ze schowka; powtórzenia są pomijane. Zapis, nowa konfiguracja, usunięcie i „Przelicz przetargi”
// wykonuje serwer (`/bridge/native/v1/tenders`, RLS `tender_filter_config`): zmiany — administrator, pozostali pracownicy
// z dostępem do przetargów widzą konfigurację do odczytu. Aktywna może być jedna konfiguracja; aktywnej nie można usunąć.

struct TenderFilterConfig: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var positiveKeywords: [String]
    var negativeKeywords: [String]
    var cpvCodes: [String]
    var locations: [String]
    var sources: [String]
    var minRelevanceScore: Int
    var notificationScoreThreshold: Int
    var maxDaysToDeadline: Int
    var isActive: Bool
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, locations, sources
        case positiveKeywords = "positive_keywords", negativeKeywords = "negative_keywords", cpvCodes = "cpv_codes"
        case minRelevanceScore = "min_relevance_score", notificationScoreThreshold = "notification_score_threshold"
        case maxDaysToDeadline = "max_days_to_deadline", isActive = "is_active", updatedAt = "updated_at"
    }

    subscript(field: TenderFilterField) -> [String] {
        get {
            switch field {
            case .positive: return positiveKeywords
            case .negative: return negativeKeywords
            case .cpv: return cpvCodes
            case .locations: return locations
            }
        }
        set {
            switch field {
            case .positive: positiveKeywords = newValue
            case .negative: negativeKeywords = newValue
            case .cpv: cpvCodes = newValue
            case .locations: locations = newValue
            }
        }
    }
}

enum TenderFilterField: String, CaseIterable, Identifiable {
    case positive, negative, cpv, locations
    var id: String { rawValue }
    var label: String {
        switch self {
        case .positive: return "Słowa kluczowe (pozytywne)"
        case .negative: return "Słowa wykluczające"
        case .cpv: return "Kody CPV"
        case .locations: return "Lokalizacje"
        }
    }
    var placeholder: String {
        switch self {
        case .positive: return "Dodaj słowo kluczowe..."
        case .negative: return "Dodaj frazę wykluczającą..."
        case .cpv: return "np. 79952000-2"
        case .locations: return "np. Warszawa, małopolskie..."
        }
    }
    var symbol: String { self == .locations ? "mappin.and.ellipse" : "tag" }
    func tint(_ theme: CrmTheme) -> Color {
        switch self {
        case .positive: return .green
        case .negative: return .red
        case .cpv: return theme.accent
        case .locations: return .blue
        }
    }
}

/// Pola zapisu konfiguracji po uporządkowaniu (jak `tenderFilterInput` w `src/lib/tenders/tenderFilterConfig.ts`).
struct TenderFilterForm: Equatable {
    var name: String
    var positive: [String]
    var negative: [String]
    var cpv: [String]
    var locations: [String]
    var minScore: Int
    var notifyScore: Int
    var maxDays: Int
    var active: Bool

    var json: [String: JSONValue] {
        [
            "name": .string(name),
            "positive_keywords": .array(positive.map(JSONValue.string)),
            "negative_keywords": .array(negative.map(JSONValue.string)),
            "cpv_codes": .array(cpv.map(JSONValue.string)),
            "locations": .array(locations.map(JSONValue.string)),
            "min_relevance_score": .number(Double(minScore)),
            "notification_score_threshold": .number(Double(notifyScore)),
            "max_days_to_deadline": .number(Double(maxDays)),
            "is_active": .bool(active),
        ]
    }
}

/// Reguły list i formularza — te same co `src/lib/tenders/tenderFilterConfig.ts` (CRM, telefon i serwer).
enum TenderFilterRules {
    static let nameLimit = 120
    static let itemLimit = 200
    static let itemsLimit = 500

    /// Spacje w środku zwinięte do jednej, bez spacji na końcach.
    static func clean(_ value: String) -> String { value.split(whereSeparator: \.isWhitespace).joined(separator: " ") }

    /// Rozdzielenie tekstu dodawanego naraz: nowe linie, przecinki, średniki i kropki.
    static func split(_ value: String) -> [String] {
        value.components(separatedBy: CharacterSet(charactersIn: "\r\n,;."))
            .map { String(clean($0).prefix(itemLimit)) }
            .filter { !$0.isEmpty }
    }

    /// Dopisuje pozycje bez powtórzeń (wielkość liter bez znaczenia); `duplicates` — czy coś pominięto.
    static func add(_ list: [String], _ input: String) -> (list: [String], added: Int, duplicates: Bool) {
        var seen = Set(list.map { clean($0).lowercased() })
        var next = list
        var duplicates = false
        for item in split(input) {
            let key = item.lowercased()
            if seen.contains(key) { duplicates = true; continue }
            seen.insert(key)
            next.append(item)
        }
        return (next, next.count - list.count, duplicates)
    }

    /// Zapisane pozycje bez pustych i powtórzeń (bez dzielenia separatorami).
    static func tidy(_ list: [String]) -> [String] {
        var seen = Set<String>()
        return list.map { String(clean($0).prefix(itemLimit)) }.filter { item in
            guard !item.isEmpty, !seen.contains(item.lowercased()) else { return false }
            seen.insert(item.lowercased())
            return true
        }
    }

    static func form(_ config: TenderFilterConfig) -> TenderFilterForm {
        TenderFilterForm(
            name: clean(config.name),
            positive: tidy(config.positiveKeywords), negative: tidy(config.negativeKeywords),
            cpv: tidy(config.cpvCodes), locations: tidy(config.locations),
            minScore: config.minRelevanceScore, notifyScore: config.notificationScoreThreshold,
            maxDays: config.maxDaysToDeadline, active: config.isActive
        )
    }

    /// Komunikat pierwszego błędu albo `nil` (te same zakresy co w CRM).
    static func validate(_ form: TenderFilterForm) -> String? {
        if form.name.isEmpty { return "Podaj nazwę konfiguracji." }
        if form.name.count > nameLimit { return "Nazwa konfiguracji może mieć najwyżej \(nameLimit) znaków." }
        if !(0...100).contains(form.minScore) { return "Minimalna ocena trafności musi być liczbą od 0 do 100." }
        if !(0...100).contains(form.notifyScore) { return "„Powiadom od oceny” musi być liczbą od 0 do 100." }
        if !(1...365).contains(form.maxDays) { return "„Max dni do terminu” musi być liczbą od 1 do 365." }
        let lists: [(TenderFilterField, [String])] = [(.positive, form.positive), (.negative, form.negative), (.cpv, form.cpv), (.locations, form.locations)]
        for (field, values) in lists where values.count > itemsLimit { return "\(field.label): najwyżej \(itemsLimit) pozycji." }
        return nil
    }
}

private struct TenderConfigReply: Decodable {
    let configs: [TenderFilterConfig]
    let canEdit: Bool
    let canRecalculate: Bool
    let selectedId: String?
    let message: String?
}

private struct TenderRecalculationReply: Decodable {
    let checked: Int
    let updated: Int
    let message: String
}

@MainActor struct TenderFilterConfigView: View {
    let close: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var configs: [TenderFilterConfig] = []
    @State private var canEdit = false
    @State private var canRecalculate = false
    @State private var selectedID: String?
    @State private var draft: TenderFilterConfig?
    @State private var inputs: [TenderFilterField: String] = [:]
    @State private var duplicates: Set<TenderFilterField> = []
    @State private var flashes: [TenderFilterField: UUID] = [:]
    @State private var loading = true
    @State private var loadError: String?
    @State private var leave: Leave?
    @State private var confirmDelete = false

    /// Czynność, która odrzuca niezapisane zmiany (pytanie przed wykonaniem).
    private enum Leave: Equatable { case select(String), create, close }

    init(close: @escaping () -> Void) { self.close = close }

    private var saved: TenderFilterConfig? { configs.first { $0.id == selectedID } }
    private var dirty: Bool {
        guard let saved, let draft, draft.id == saved.id else { return false }
        return TenderFilterRules.form(saved) != TenderFilterRules.form(draft)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if loading && configs.isEmpty {
                ProgressView("Wczytywanie konfiguracji…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let loadError, configs.isEmpty {
                ContentUnavailableView {
                    Label("Nie udało się wczytać konfiguracji", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if configs.isEmpty {
                ContentUnavailableView("Brak konfiguracji filtrów", systemImage: "slider.horizontal.3",
                                       description: Text(canEdit ? "Dodaj pierwszą przyciskiem „Nowa konfiguracja”." : "Konfigurację dodaje administrator CRM."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(spacing: 0) {
                    sidebar.frame(width: 250)
                    Divider()
                    if let draft { editor(draft) } else { Spacer() }
                }
            }
        }
        .task { await load() }
        .confirmationDialog("Masz niezapisane zmiany w konfiguracji", isPresented: Binding(get: { leave != nil }, set: { if !$0 { leave = nil } }),
                            titleVisibility: .visible, presenting: leave) { choice in
            Button("Odrzuć zmiany", role: .destructive) { perform(choice) }
            Button("Zostań", role: .cancel) {}
        } message: { _ in
            Text("Odrzucić niezapisane zmiany?")
        }
        .confirmationDialog("Usunąć konfigurację „\(saved?.name ?? "")”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń konfigurację", role: .destructive) { Task { await delete() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Tej operacji nie można cofnąć.")
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button("Przetargi", systemImage: "chevron.left") { attempt(.close) }.help("Wróć do listy przetargów")
            Text("Konfiguracja filtrów").font(.headline)
            Text("Kryteria dopasowania przetargów do profilu firmy").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer()
            if canEdit {
                Button("Nowa konfiguracja", systemImage: "plus") { attempt(.create) }.disabled(!state.canWrite)
            }
        }
        .padding(.horizontal, 14).frame(height: 46).crmBar()
    }

    private var sidebar: some View {
        ScrollView {
            VStack(spacing: 6) {
                ForEach(configs) { config in
                    let selected = config.id == selectedID
                    Button { attempt(.select(config.id)) } label: {
                        HStack(spacing: 6) {
                            Text(config.name).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                            if selected && dirty {
                                Circle().fill(theme.accent).frame(width: 7, height: 7).help("Niezapisane zmiany")
                            }
                            if config.isActive {
                                Text("Aktywna").font(.caption2.weight(.semibold)).foregroundStyle(.green)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color.green.opacity(0.18), in: RoundedRectangle(cornerRadius: 4))
                            }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(selected ? theme.accent.opacity(0.14) : theme.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(selected ? 0.45 : 0.12)))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(12)
        }
    }

    private func editor(_ current: TenderFilterConfig) -> some View {
        let config = Binding<TenderFilterConfig>(get: { draft ?? current }, set: { draft = $0 })
        return VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !canEdit {
                        Label("Podgląd konfiguracji — zmiany zapisuje administrator CRM.", systemImage: "lock")
                            .font(.callout).foregroundStyle(.secondary)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    }
                    basics(config)
                    ForEach(TenderFilterField.allCases) { field in listPanel(field, values: config.wrappedValue[field]) }
                }
                .padding(20)
                .frame(maxWidth: 1000, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if canEdit || canRecalculate { footer }
        }
    }

    private func basics(_ config: Binding<TenderFilterConfig>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Ustawienia podstawowe", systemImage: "gearshape").font(.headline)
            VStack(alignment: .leading, spacing: 4) {
                Text("Nazwa konfiguracji").font(.caption).foregroundStyle(.secondary)
                TextField("Nazwa konfiguracji", text: config.name).textFieldStyle(.roundedBorder).labelsHidden()
            }
            HStack(alignment: .top, spacing: 24) {
                number("Minimalna ocena trafności", symbol: "gauge.medium", value: config.minRelevanceScore, range: 0...100)
                number("Max dni do terminu", symbol: "clock", value: config.maxDaysToDeadline, range: 1...365)
                number("Powiadom od oceny", symbol: "bell.badge", value: config.notificationScoreThreshold, range: 0...100)
            }
            Text("Dla nowych przetargów z oceną co najmniej „Powiadom od oceny” CRM utworzy powiadomienie i banner push.")
                .font(.caption).foregroundStyle(.secondary)
            Toggle("Konfiguracja aktywna", isOn: config.isActive).toggleStyle(.checkbox)
            Text("Pobieranie przetargów i przeliczenie ocen używają jednej konfiguracji — zapis aktywnej wyłącza pozostałe.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .disabled(!canEdit)
        .padding(16).frame(maxWidth: .infinity, alignment: .leading).crmPanel()
    }

    private func number(_ title: String, symbol: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: symbol).font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 4) {
                TextField(title, value: value, format: .number.grouping(.never))
                    .textFieldStyle(.roundedBorder).labelsHidden().multilineTextAlignment(.trailing).frame(width: 70)
                Stepper(title, value: value, in: range).labelsHidden()
                Text("\(range.lowerBound)–\(range.upperBound)").font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }

    private func listPanel(_ field: TenderFilterField, values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Label {
                    Text(field.label)
                } icon: {
                    Image(systemName: field.symbol).foregroundStyle(field.tint(theme))
                }
                .font(.headline)
                Text("\(values.count)").font(.caption).foregroundStyle(.secondary)
            }
            if canEdit {
                HStack(spacing: 8) {
                    TextField(field.label, text: inputBinding(field), prompt: Text(field.placeholder))
                        .textFieldStyle(.roundedBorder).labelsHidden()
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.red.opacity(duplicates.contains(field) ? 0.9 : 0), lineWidth: 1.5))
                        .onSubmit { submit(field) }
                    Button("Dodaj", systemImage: "plus") { submit(field) }
                        .disabled((inputs[field] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Wklej listę", systemImage: "doc.on.clipboard") { pasteList(field) }
                        .help("Dodaje pozycje ze schowka — rozdzielone nowymi liniami, przecinkami, średnikami lub kropkami")
                }
                if duplicates.contains(field) {
                    Text("Pominięto pozycje, które już są na liście.").font(.caption).foregroundStyle(.red)
                }
            }
            if values.isEmpty {
                Text("Brak pozycji.").font(.caption).foregroundStyle(.secondary)
            } else {
                WrapLayout(spacing: 6) {
                    ForEach(Array(values.enumerated()), id: \.offset) { entry in chip(field, index: entry.offset, value: entry.element) }
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading).crmPanel()
    }

    private func chip(_ field: TenderFilterField, index: Int, value: String) -> some View {
        let tint = field.tint(theme)
        return HStack(spacing: 4) {
            Text(value).font(.caption).lineLimit(1)
            if canEdit {
                Button { remove(field, at: index) } label: {
                    Image(systemName: "xmark").font(.caption2.weight(.bold))
                }
                .buttonStyle(.plain).help("Usuń").accessibilityLabel("Usuń „\(value)”")
            }
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(tint.opacity(0.25)))
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if canEdit {
                Button("Usuń konfigurację", systemImage: "trash", role: .destructive) { confirmDelete = true }
                    .disabled(saved == nil || saved?.isActive == true || !state.canWrite)
                    .help(saved?.isActive == true ? "Aktywnej konfiguracji nie można usunąć — najpierw zapisz inną jako aktywną." : "Usuń wybraną konfigurację")
            }
            Spacer()
            if dirty { Text("Niezapisane zmiany").font(.caption).foregroundStyle(theme.accent) }
            if canRecalculate {
                Button("Przelicz przetargi", systemImage: "arrow.clockwise") { Task { await recalculate() } }
                    .disabled(!state.canWrite)
                    .help("Przelicza ocenę trafności wszystkich przetargów według aktywnej konfiguracji")
            }
            if canEdit {
                Button("Zapisz konfigurację", systemImage: "checkmark") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut("s", modifiers: .command)
                    .disabled(!dirty || !state.canWrite)
            }
        }
        .padding(.horizontal, 16).frame(height: 52).crmBar()
    }

    // MARK: Listy

    private func inputBinding(_ field: TenderFilterField) -> Binding<String> {
        Binding(get: { inputs[field] ?? "" }, set: { value in
            // Wklejenie kilku linii naraz (⌘V) — pozycje trafiają od razu na listę.
            if value.contains(where: \.isNewline) {
                add(field, value)
                inputs[field] = ""
            } else {
                inputs[field] = value
            }
        })
    }

    private func submit(_ field: TenderFilterField) {
        add(field, inputs[field] ?? "")
        inputs[field] = ""
    }

    private func add(_ field: TenderFilterField, _ text: String) {
        guard canEdit, var next = draft, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let result = TenderFilterRules.add(next[field], text)
        if result.duplicates { flash(field) }
        guard result.added > 0 else { return }
        next[field] = result.list
        draft = next
    }

    private func pasteList(_ field: TenderFilterField) {
        guard let text = NSPasteboard.general.string(forType: .string), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            state.notice = "Schowek jest pusty — skopiuj listę i spróbuj ponownie."
            return
        }
        add(field, text)
    }

    private func remove(_ field: TenderFilterField, at index: Int) {
        guard canEdit, var next = draft, next[field].indices.contains(index) else { return }
        next[field].remove(at: index)
        draft = next
    }

    private func flash(_ field: TenderFilterField) {
        let token = UUID()
        flashes[field] = token
        duplicates.insert(field)
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            if flashes[field] == token { duplicates.remove(field); flashes[field] = nil }
        }
    }

    // MARK: Wybór i niezapisane zmiany

    private func attempt(_ choice: Leave) {
        if case .select(let id) = choice, id == selectedID { return }
        if dirty { leave = choice } else { perform(choice) }
    }

    private func perform(_ choice: Leave) {
        leave = nil
        switch choice {
        case .select(let id):
            selectedID = id
            draft = configs.first { $0.id == id }
            inputs = [:]
            duplicates = []
        case .create:
            Task { await create() }
        case .close:
            close()
        }
    }

    // MARK: Serwer

    private static func message(_ error: Error) -> String { (error as? NativeFailure)?.message ?? friendlyError(error) }

    private func apply(_ reply: TenderConfigReply, prefer: String?) {
        configs = reply.configs
        canEdit = reply.canEdit
        canRecalculate = reply.canRecalculate
        let chosen = reply.configs.first { $0.id == (reply.selectedId ?? prefer) } ?? reply.configs.first
        selectedID = chosen?.id
        draft = chosen
        inputs = [:]
        duplicates = []
    }

    private func load() async {
        guard let api = state.nativeAPI() else {
            loading = false
            loadError = "Brak połączenia z serwerem CRM."
            return
        }
        loading = true
        defer { loading = false }
        do {
            let data = try await api.get("/tenders", query: ["op": "config"])
            apply(try JSONDecoder().decode(TenderConfigReply.self, from: data), prefer: selectedID)
            loadError = nil
        } catch {
            loadError = Self.message(error)
        }
    }

    /// Czynność z modalnym wskaźnikiem; odpowiedź serwera to nowy stan listy (wybrana konfiguracja i komunikat).
    private func send(_ label: String, prefer: String?, _ body: [String: JSONValue]) async {
        guard let api = state.nativeAPI() else { state.error = "Brak połączenia z serwerem CRM."; return }
        do {
            let reply = try await state.withPending(label) {
                try JSONDecoder().decode(TenderConfigReply.self, from: try await api.post("/tenders", body))
            }
            apply(reply, prefer: prefer)
            state.succeed(reply.message ?? "Zapisano.")
        } catch {
            state.error = Self.message(error)
        }
    }

    private func save() async {
        guard canEdit, let draft, let saved else { return }
        let form = TenderFilterRules.form(draft)
        if let problem = TenderFilterRules.validate(form) { state.error = problem; return }
        await send("Zapisywanie konfiguracji…", prefer: draft.id, [
            "op": .string("configSave"), "id": .string(draft.id), "config": .object(form.json),
            "updatedAt": saved.updatedAt.map(JSONValue.string) ?? .null,
        ])
    }

    private func create() async {
        guard canEdit else { return }
        await send("Dodawanie konfiguracji…", prefer: nil, ["op": .string("configCreate")])
    }

    private func delete() async {
        guard canEdit, let saved, !saved.isActive else { return }
        await send("Usuwanie konfiguracji…", prefer: nil, ["op": .string("configDelete"), "id": .string(saved.id)])
    }

    private func recalculate() async {
        guard canRecalculate, let api = state.nativeAPI() else { return }
        if dirty {
            state.notice = "Najpierw zapisz zmiany — przeliczenie używa zapisanej aktywnej konfiguracji."
            return
        }
        do {
            let reply = try await state.withPending("Przeliczanie przetargów według aktywnej konfiguracji…") {
                try JSONDecoder().decode(TenderRecalculationReply.self, from: try await api.post("/tenders", ["op": .string("recalculate")], timeout: 180))
            }
            state.succeed(reply.message)
            // Nowe oceny na liście przetargów (synchronizacja pobiera tylko zmienione zbiory).
            Task { await state.refresh(force: true) }
        } catch {
            state.error = Self.message(error)
        }
    }
}
