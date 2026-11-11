import SwiftUI
import AppKit

// MARK: Zarządzanie sprzętem wydarzenia — jedno okno do dodawania, zmiany ilości i usuwania (katalog z dysku, zapis od razu)
// oraz wspólny zapis zmian ilości dla listy sprzętu (− / +, wpisanie liczby, Delete) z cofaniem ostatniej zmiany.

/// Zmiany ilości sprzętu zapisywane od razu: seria kliknięć − / + to jeden zapis (po 0,6 s bez kolejnych zmian), zapisy idą
/// po kolei (bez wyścigów), a komunikat na dole okna ma „Cofnij”. Serwer: czynności `add` / `quantity` / `remove` / `restore`
/// zakładki Sprzęt (te same reguły dostępności co w CRM).
@MainActor final class EquipmentEditor: ObservableObject {
    /// Pozycja magazynu: rodzaj (`item` / `kit` / `cable`), identyfikator i klucz dostępności (`item-<id>`) jak na serwerze.
    struct Target: Hashable {
        var kind: String
        var id: String
        var name: String
        var key: String { "\(kind)-\(id)" }
    }
    struct Change { var target: Target; var from: Int; var to: Int }

    private struct Failure: LocalizedError {
        let text: String
        var errorDescription: String? { text }
    }

    /// Ilości wpisane, a jeszcze niepotwierdzone przez serwer (klucz dostępności → ilość).
    @Published private(set) var drafts: [String: Int] = [:]
    /// Klucze w trakcie zapisu.
    @Published private(set) var saving: Set<String> = []
    /// Liczba nowych pozycji dodanych przez ten zapis (okno „Zarządzaj sprzętem” rozpoznaje po niej, że coś dodano).
    @Published private(set) var added = 0

    private unowned let store: EventCardStore
    let eventID: String
    private var targets: [String: Target] = [:]
    private var notes: [String: String] = [:]
    private var timers: [String: Task<Void, Never>] = [:]
    private var queue: Task<Void, Never>?

    init(store: EventCardStore, eventID: String) {
        self.store = store
        self.eventID = eventID
    }

    private var data: EquipmentTabData? { store.tab(eventID, "equipment", as: EquipmentTabData.self) }

    /// Ilość w wydarzeniu według serwera (bez pozycji usuniętych z oferty).
    func current(_ key: String) -> Int {
        (data?.rows ?? []).filter { $0.key == key && !$0.removed }.reduce(0) { $0 + $1.qty }
    }

    /// Nowa ilość pozycji (0 — usunięcie). Zapis po krótkiej przerwie albo od razu (`immediate`).
    func set(_ target: Target, to quantity: Int, notes note: String? = nil, immediate: Bool = false) {
        let key = target.key
        targets[key] = target
        if let note { notes[key] = note }
        drafts[key] = max(0, quantity)
        timers[key]?.cancel()
        timers[key] = Task { [weak self] in
            if !immediate { try? await Task.sleep(for: .milliseconds(600)) }
            guard !Task.isCancelled else { return }
            self?.enqueue([key], undo: nil)
        }
    }

    /// Usunięcie kilku pozycji naraz — jeden zapis i jedno „Cofnij” dla wszystkich.
    func remove(_ list: [Target]) {
        for target in list {
            targets[target.key] = target
            drafts[target.key] = 0
            timers[target.key]?.cancel()
        }
        enqueue(list.map(\.key), undo: nil)
    }

    private func undo(_ changes: [Change]) {
        for change in changes {
            targets[change.target.key] = change.target
            drafts[change.target.key] = change.from
            timers[change.target.key]?.cancel()
        }
        enqueue(changes.map(\.target.key), undo: changes)
    }

    private func enqueue(_ keys: [String], undo reverting: [Change]?) {
        let previous = queue
        queue = Task { [weak self] in
            await previous?.value
            await self?.apply(keys, reverting: reverting)
        }
    }

    private func apply(_ keys: [String], reverting: [Change]?) async {
        var changes: [Change] = []
        var written: [String: Int] = [:]
        var failure: String?
        for key in keys {
            guard let target = targets[key], let wanted = drafts[key] else { continue }
            let before = current(key)
            if wanted == before {
                drafts[key] = nil
                continue
            }
            saving.insert(key)
            do {
                try await write(target, from: before, to: wanted)
                changes.append(Change(target: target, from: before, to: wanted))
                written[key] = wanted
            } catch {
                failure = store.failureText(error, "Nie udało się zapisać zmiany sprzętu.")
                drafts[key] = nil
            }
            saving.remove(key)
        }
        if !changes.isEmpty {
            await store.loadTab(eventID, "equipment")
            await store.loadTab(eventID, "equipment-checklist")
        }
        // Wersja z serwera zastępuje wpisaną ilość — chyba że w międzyczasie wpisano kolejną (jej zapis już czeka).
        for (key, value) in written where drafts[key] == value { drafts[key] = nil }
        if let failure { store.workspace?.error = failure }
        guard !changes.isEmpty else { return }
        let id = eventID
        Task { [weak self] in await self?.store.syncEquipmentCatalog(id) }
        if reverting != nil {
            store.workspace?.succeed("Cofnięto zmianę sprzętu")
        } else {
            announce(changes)
        }
    }

    private func write(_ target: Target, from before: Int, to wanted: Int) async throws {
        let rows = (data?.rows ?? []).filter { $0.key == target.key }
        let active = rows.filter { !$0.removed }
        if wanted == 0 {
            for row in active { try await action("remove", ["rowId": .string(row.id)]) }
        } else if let first = active.first {
            let others = before - first.qty
            guard wanted - others >= 1 else { throw Failure(text: "„\(target.name)” występuje na liście kilka razy — zmniejsz ilość w konkretnej pozycji.") }
            try await action("quantity", ["rowId": .string(first.id), "quantity": .number(Double(wanted - others))])
        } else if let hidden = rows.first(where: \.removed) {
            // Pozycja z oferty ukryta wcześniej — przywrócenie i ustawienie ilości.
            try await action("restore", ["rowId": .string(hidden.id)])
            try await action("quantity", ["rowId": .string(hidden.id), "quantity": .number(Double(wanted))])
        } else {
            var item: [String: JSONValue] = ["id": .string(target.id), "type": .string(target.kind), "quantity": .number(Double(wanted))]
            if let note = notes[target.key]?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty { item["notes"] = .string(note) }
            try await action("add", ["items": .array([.object(item)])])
            notes[target.key] = nil
            added += 1
        }
    }

    private func action(_ name: String, _ body: [String: JSONValue]) async throws {
        try await store.tabAction(eventID, "equipment", name, body, reload: [], success: nil, pending: nil)
    }

    private func announce(_ changes: [Change]) {
        let text: String
        if changes.count == 1, let change = changes.first {
            if change.to == 0 {
                text = "Usunięto: \(change.target.name)"
            } else if change.from == 0 {
                text = "Dodano: \(change.target.name) — \(change.to) szt."
            } else {
                text = "\(change.target.name): \(change.from) → \(change.to) szt."
            }
        } else if changes.allSatisfy({ $0.to == 0 }) {
            text = "Usunięto pozycji: \(changes.count)"
        } else {
            text = "Zmieniono pozycji: \(changes.count)"
        }
        let undone = changes
        store.workspace?.snack = Snack(kind: .success, text: text, action: Snack.Action(title: "Cofnij") { [weak self] in self?.undo(undone) })
    }
}

/// Ilość z przyciskami − / + i polem do wpisania liczby (↩ albo wyjście z pola zapisuje).
struct EquipmentStepper: View {
    let value: Int
    let lower: Int
    let upper: Int
    var unit: String?
    var saving = false
    let set: (Int) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        let over = value > upper
        HStack(spacing: 3) {
            Button { set(max(lower, value - 1)) } label: { Image(systemName: "minus").frame(width: 16, height: 16).contentShape(Rectangle()) }
                .disabled(value <= lower)
                .help("Mniej")
            TextField("", text: $text)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.center)
                .font(.callout.weight(.semibold).monospacedDigit())
                .foregroundStyle(over ? Color.red : Color.primary)
                .frame(width: 46)
                .focused($focused)
                .onSubmit { commit() }
            Button { set(min(upper, value + 1)) } label: { Image(systemName: "plus").frame(width: 16, height: 16).contentShape(Rectangle()) }
                .disabled(value >= upper)
                .help(value >= upper ? "Brak kolejnych sztuk w terminie" : "Więcej")
            if let unit { Text(unit).font(.caption).foregroundStyle(.secondary) }
            ProgressView().controlSize(.mini).opacity(saving ? 1 : 0)
        }
        .buttonStyle(.borderless)
        .help(over ? "Przekroczona dostępność w terminie — maksymalnie \(upper)" : "Maksymalnie \(upper)")
        .onAppear { text = String(value) }
        .onChange(of: value) { _, new in if !focused { text = String(new) } }
        .onChange(of: focused) { _, now in if !now { commit() } }
    }

    private func commit() {
        let parsed = Int(text.trimmingCharacters(in: .whitespaces)) ?? value
        let clamped = min(max(parsed, lower), max(upper, lower))
        text = String(clamped)
        if clamped != value { set(clamped) }
    }
}

/// „Kto zarezerwował?” — rezerwacje pozycji w innych wydarzeniach w terminie (`tabQuery equipment/reservations`).
struct EquipmentReservations: Decodable {
    struct Person: Decodable, Hashable { var id: String; var name: String; var avatarUrl: String?; var avatar: AvatarCrop?; var email: String?; var phone: String? }
    struct Reservation: Decodable, Identifiable, Hashable {
        var eventId: String
        var name: String
        var status: String?
        var quantity: Double
        var start: String?
        var end: String?
        var author: Person?
        var id: String { eventId }
    }
    var reservations: [Reservation]
    var hiddenQuantity: Double
}

// MARK: Okno „Zarządzaj sprzętem”

@MainActor struct EquipmentManagerSheet: View {
    @ObservedObject var store: EventCardStore
    @ObservedObject var editor: EquipmentEditor
    let eventID: String
    var focus: String?
    let onFinished: (Bool) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var size = EquipmentManagerSheet.preferredSize()
    @State private var reservations: [String: EquipmentReservations] = [:]
    @State private var reservationErrors: [String: String] = [:]
    @State private var search = ""
    @State private var scope: String? = "all"
    @AppStorage("equipmentManager.onlyAvailable") private var onlyAvailable = false
    @State private var selection: String?
    @State private var preview: String?
    @State private var noteFor: EquipmentEditor.Target?
    @State private var noteText = ""
    @State private var addedAtOpen = 0

    /// Wiersz okna: pozycja katalogu i jej ilość w wydarzeniu.
    struct Line: Identifiable, Hashable {
        var entry: EquipmentCatalogEntry
        var current: Int
        var rows: Int
        var maxAdd: Int
        var upper: Int
        var reserved: Int
        var inTerm: Int
        var id: String { entry.syncKey }
        var key: String { "\(entry.kind)-\(entry.id)" }
        var isKit: Bool { entry.kind == "kit" }
        var target: EquipmentEditor.Target { EquipmentEditor.Target(kind: entry.kind, id: entry.id, name: entry.name) }
    }

    private var entries: [EquipmentCatalogEntry] { store.equipmentCatalogEntries(eventID) }
    private var tabData: EquipmentTabData? { store.tab(eventID, "equipment", as: EquipmentTabData.self) }
    private var error: String? { store.tabErrors["\(eventID)|equipment-catalog"] }
    private var refreshing: Bool { store.tabLoading.contains("\(eventID)|equipment-catalog") }

    private func lines() -> [Line] {
        var quantity: [String: Int] = [:]
        var count: [String: Int] = [:]
        for row in tabData?.rows ?? [] where !row.removed {
            guard let key = row.key else { continue }
            quantity[key, default: 0] += row.qty
            count[key, default: 0] += 1
        }
        return entries.map { entry in
            let key = "\(entry.kind)-\(entry.id)"
            let live = tabData?.availability[key]
            let maxAdd = Int(live?.maxAdd ?? entry.maxAdd)
            let maxSet = Int(live?.maxSet ?? entry.maxSet)
            let current = quantity[key] ?? 0
            return Line(entry: entry, current: current, rows: count[key] ?? 0, maxAdd: maxAdd, upper: current > 0 ? max(maxSet, current) : max(0, maxAdd),
                        reserved: Int(live?.reserved ?? entry.reserved), inTerm: Int(live?.availableInTerm ?? entry.availableInTerm))
        }
    }

    private func value(_ line: Line) -> Int { editor.drafts[line.key] ?? line.current }

    private func visible(_ all: [Line]) -> [Line] {
        let terms = EquipmentSearch.normalize(search).split(separator: " ").map { String($0) }.filter { !$0.isEmpty }
        let current = scope ?? "all"
        let matching = all.filter { line in
            if current == "event" && value(line) == 0 && line.current == 0 { return false }
            if current == "kits" && !line.isKit { return false }
            if current.hasPrefix("cat:") && (line.isKit || (line.entry.category ?? "") != String(current.dropFirst(4))) { return false }
            if onlyAvailable && line.maxAdd <= 0 && line.current == 0 { return false }
            if terms.isEmpty { return true }
            let parts: [String] = [line.entry.name, line.entry.brand ?? "", line.entry.model ?? "", line.entry.category ?? ""] + (line.entry.contents ?? []).map(\.name)
            let text = EquipmentSearch.normalize(parts.joined(separator: " "))
            return terms.allSatisfy { text.contains($0) }
        }
        // Pozycje już dodane do wydarzenia na samej górze (kolejność nazw w obu grupach bez zmian).
        return matching.filter { $0.current > 0 } + matching.filter { $0.current == 0 }
    }

    /// Okno prawie na całą szerokość i wysokość okna aplikacji (MacBook Air 13" i Pro 16").
    static func preferredSize() -> CGSize {
        let frame = (NSApp.keyWindow ?? NSApp.mainWindow)?.frame.size ?? CGSize(width: 1400, height: 880)
        return CGSize(width: max(1000, frame.width - 40), height: max(620, frame.height - 70))
    }

    private func categories(_ all: [Line]) -> [(name: String, count: Int)] {
        var counts: [String: Int] = [:]
        for line in all where !line.isKit {
            if let name = line.entry.category?.trimmingCharacters(in: .whitespaces), !name.isEmpty { counts[name, default: 0] += 1 }
        }
        return counts.map { (name: $0.key, count: $0.value) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        let all = lines()
        let shown = visible(all)
        let inEvent = all.filter { $0.current > 0 }
        let pieces = inEvent.reduce(0) { $0 + $1.current }
        HStack(spacing: 0) {
            sidebar(all, inEvent: inEvent.count)
                .frame(width: 220)
                .background(Color.primary.opacity(0.03))
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Zarządzaj sprzętem").font(.title3.weight(.semibold))
                        Text("W wydarzeniu: \(inEvent.count) poz. · \(pieces) szt. · zmiany zapisują się od razu")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if refreshing { ProgressView().controlSize(.small).help("Sprawdzanie zmian dostępności") }
                    Toggle("Tylko dostępne", isOn: $onlyAvailable).toggleStyle(.checkbox)
                    TextField("Szukaj: nazwa, marka, model, zawartość zestawu…", text: $search)
                        .textFieldStyle(.roundedBorder).frame(width: 300)
                }
                .padding(14)
                Group {
                    if entries.isEmpty {
                        if let error {
                            ContentUnavailableView {
                                Label("Nie udało się wczytać katalogu", systemImage: "shippingbox")
                            } description: { Text(error) } actions: {
                                Button("Spróbuj ponownie") { Task { await store.syncEquipmentCatalog(eventID) } }
                            }
                        } else {
                            ProgressView("Pobieranie katalogu i dostępności…").frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    } else if shown.isEmpty {
                        ContentUnavailableView("Brak pozycji", systemImage: "magnifyingglass",
                                               description: Text(search.isEmpty ? "W tym widoku nie ma sprzętu." : "Nic nie pasuje do „\(search)”."))
                    } else {
                        VSplitView {
                            table(shown).frame(minHeight: 220, idealHeight: size.height * 0.62)
                            detail(all).frame(minHeight: 170, idealHeight: 230, maxHeight: .infinity)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                HStack(spacing: 10) {
                    Text("Dwuklik albo ↩ dodaje 1 szt. · + / − zmienia ilość zaznaczonej pozycji · 0 usuwa z wydarzenia")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Gotowe") { close() }.buttonStyle(.borderedProminent).keyboardShortcut(.cancelAction)
                }
                .padding(14)
            }
        }
        .frame(width: size.width, height: size.height)
        .onAppear {
            addedAtOpen = editor.added
            if let focus { selection = focus }
        }
        .task { await store.syncEquipmentCatalog(eventID) }
        .task(id: selection) { await loadReservations() }
        .alert("Dodaj z notatką", isPresented: Binding(get: { noteFor != nil }, set: { if !$0 { noteFor = nil } })) {
            TextField("Notatka (opcjonalnie)", text: $noteText)
            Button("Dodaj") {
                if let target = noteFor { editor.set(target, to: 1, notes: noteText, immediate: true) }
                noteFor = nil
            }
            Button("Anuluj", role: .cancel) { noteFor = nil }
        } message: { Text(noteFor?.name ?? "") }
    }

    private func sidebar(_ all: [Line], inEvent: Int) -> some View {
        List(selection: $scope) {
            Section {
                Label("Cały katalog", systemImage: "square.grid.2x2").badge(all.count).tag("all")
                Label("W wydarzeniu", systemImage: "checklist").badge(inEvent).tag("event")
                Label("Zestawy", systemImage: "shippingbox.fill").badge(all.filter(\.isKit).count).tag("kits")
            }
            Section("Kategorie") {
                ForEach(categories(all), id: \.name) { category in
                    Label(category.name, systemImage: "folder").lineLimit(1).badge(category.count).tag("cat:" + category.name)
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
    }

    private func table(_ lines: [Line]) -> some View {
        Table(lines, selection: $selection) {
            TableColumn("") { (line: Line) in thumb(line) }.width(40)
            TableColumn("Nazwa") { (line: Line) in
                VStack(alignment: .leading, spacing: 1) {
                    Text(line.entry.name).fontWeight(value(line) > 0 ? .semibold : .regular).lineLimit(1)
                    Text(subtitle(line)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .help(line.entry.name)
            }.width(min: 200, ideal: 340)
            TableColumn("Kategoria") { (line: Line) in
                Text(line.isKit ? "Zestaw" : (line.entry.category?.nonEmpty ?? "—")).foregroundStyle(.secondary).lineLimit(1)
            }.width(min: 90, ideal: 160)
            TableColumn("Magazyn") { (line: Line) in
                Text("\(Int(line.entry.total))").monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 56, ideal: 70)
            TableColumn("W terminie") { (line: Line) in
                Text("\(line.inTerm)").monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
                    .help("Dostępne w terminie wydarzenia (magazyn minus rezerwacje innych wydarzeń)")
            }.width(min: 64, ideal: 80)
            TableColumn("Inne wydarzenia") { (line: Line) in
                if line.reserved > 0 {
                    Button { selection = line.id } label: {
                        Label("\(line.reserved) szt.", systemImage: "person.2").monospacedDigit()
                    }
                    .buttonStyle(.borderless)
                    .help("Kto rezerwuje w tym terminie — szczegóły pod tabelą")
                } else {
                    Text("—").foregroundStyle(.tertiary)
                }
            }.width(min: 90, ideal: 120)
            TableColumn("Dostępność w terminie") { (line: Line) in availability(line) }.width(min: 120, ideal: 170)
            TableColumn("W wydarzeniu") { (line: Line) in stepper(line) }.width(min: 160, ideal: 180)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let line = lines.first(where: { $0.id == id }) { menu(line) }
        } primaryAction: { ids in
            if let id = ids.first, let line = lines.first(where: { $0.id == id }) { bump(line, by: 1) }
        }
        .onKeyPress(characters: CharacterSet(charactersIn: "+=-")) { press in
            guard let id = selection, let line = lines.first(where: { $0.id == id }) else { return .ignored }
            bump(line, by: press.characters == "-" ? -1 : 1)
            return .handled
        }
    }

    private func subtitle(_ line: Line) -> String {
        if line.isKit {
            let count = line.entry.contents?.count ?? 0
            return count > 0 ? "Zestaw · \(count) elementów" : "Zestaw"
        }
        let meta = [line.entry.brand ?? "", line.entry.model ?? ""].filter { !$0.isEmpty }.joined(separator: " • ")
        return meta.isEmpty ? " " : meta
    }

    private func thumb(_ line: Line) -> some View {
        Button { preview = line.id } label: {
            WarehouseThumb(url: line.entry.thumbnail, size: 30, symbol: line.isKit ? "shippingbox.fill" : "shippingbox")
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Podgląd: zdjęcie i szczegóły")
        .popover(isPresented: Binding(get: { preview == line.id }, set: { if !$0 { preview = nil } }), arrowEdge: .trailing) {
            EquipmentCatalogPreview(entry: line.entry, inEvent: line.current, maxAdd: line.maxAdd, openDetail: detailAction(line))
        }
    }

    private func detailAction(_ line: Line) -> (() -> Void)? {
        guard !line.isKit else { return nil }
        let id = line.entry.id
        return {
            preview = nil
            close()
            state.showEquipment(id)
        }
    }

    private func availability(_ line: Line) -> some View {
        let color: Color
        let label: String
        if line.maxAdd < 0 {
            color = CrmTheme.rgb(0xf87171)
            label = "przekroczona o \(-line.maxAdd)"
        } else if line.maxAdd > 0 {
            color = CrmTheme.rgb(0x4ade80)
            label = "można dodać \(line.maxAdd)"
        } else if line.current > 0 {
            color = CrmTheme.rgb(0xfacc15)
            label = "całość w wydarzeniu"
        } else {
            color = CrmTheme.rgb(0xf87171)
            label = "brak w terminie"
        }
        return EventDotLabel(label: label, color: color)
            .help("W terminie: \(Int(line.entry.availableInTerm)) · zarezerwowane: \(Int(line.entry.reserved)) · magazyn: \(Int(line.entry.total))")
    }

    @ViewBuilder private func stepper(_ line: Line) -> some View {
        if line.rows > 1 {
            Text("\(line.current) szt. (kilka pozycji)").font(.caption).foregroundStyle(.secondary)
                .help("Ta pozycja występuje na liście kilka razy — zmień ilość na liście sprzętu.")
        } else {
            EquipmentStepper(value: value(line), lower: 0, upper: line.upper, unit: line.isKit ? "kpl." : "szt.",
                             saving: editor.saving.contains(line.key)) { editor.set(line.target, to: $0) }
        }
    }

    private func bump(_ line: Line, by delta: Int) {
        guard line.rows <= 1 else {
            state.snack = Snack(kind: .info, text: "„\(line.entry.name)” występuje na liście kilka razy — zmień ilość na liście sprzętu.")
            return
        }
        let current = value(line)
        let next = current + delta
        if next < 0 { return }
        if delta > 0 && next > line.upper {
            state.snack = Snack(kind: .info, text: "Brak kolejnych sztuk w terminie: \(line.entry.name)")
            return
        }
        editor.set(line.target, to: next)
    }

    @ViewBuilder private func menu(_ line: Line) -> some View {
        Button("Dodaj 1 szt.", systemImage: "plus") { bump(line, by: 1) }.disabled(value(line) >= line.upper || line.rows > 1)
        if line.current == 0 && line.rows == 0 {
            Button("Dodaj z notatką…", systemImage: "note.text.badge.plus") {
                noteText = ""
                noteFor = line.target
            }
            .disabled(line.maxAdd <= 0)
        }
        if value(line) > 0 && line.rows <= 1 {
            Button("Odejmij 1 szt.", systemImage: "minus") { bump(line, by: -1) }
            Button("Usuń z wydarzenia", systemImage: "trash", role: .destructive) { editor.set(line.target, to: 0, immediate: true) }
        }
        Divider()
        if line.reserved > 0 {
            Button("Kto rezerwuje w tym terminie?", systemImage: "person.2") { selection = line.id }
        }
        Button("Podgląd", systemImage: "eye") { preview = line.id }
        if let open = detailAction(line) { Button("Karta sprzętu", systemImage: "arrow.up.right.square", action: open) }
    }

    // MARK: Szczegóły zaznaczonej pozycji i rezerwacje innych wydarzeń

    private func loadReservations() async {
        guard let id = selection, reservations[id] == nil, let line = lines().first(where: { $0.id == id }), line.reserved > 0 else { return }
        reservationErrors[id] = nil
        do {
            reservations[id] = try await store.tabQuery(eventID, "equipment", "reservations", ["kind": line.entry.kind, "id": line.entry.id],
                                                        as: EquipmentReservations.self)
        } catch {
            reservationErrors[id] = store.failureText(error, "Nie udało się sprawdzić rezerwacji.")
        }
    }

    @ViewBuilder private func detail(_ all: [Line]) -> some View {
        if let line = all.first(where: { $0.id == selection }) {
            let meta = [line.entry.brand ?? "", line.entry.model ?? "", line.isKit ? "Zestaw" : (line.entry.category ?? "")].filter { !$0.isEmpty }.joined(separator: " • ")
            ScrollView {
                HStack(alignment: .top, spacing: 22) {
                    HStack(alignment: .top, spacing: 12) {
                        Button { preview = line.id } label: {
                            WarehouseThumb(url: line.entry.thumbnail, size: 84, symbol: line.isKit ? "shippingbox.fill" : "shippingbox")
                        }
                        .buttonStyle(.plain).help("Powiększ")
                        VStack(alignment: .leading, spacing: 4) {
                            Text(line.entry.name).font(.headline)
                            if !meta.isEmpty { Text(meta).font(.callout).foregroundStyle(.secondary) }
                            if let description = line.entry.description?.nonEmpty {
                                Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                            }
                            if let contents = line.entry.contents, !contents.isEmpty {
                                Text(contents.prefix(6).map { "\(Int($0.quantity))× \($0.name)" }.joined(separator: " · ") + (contents.count > 6 ? " …" : ""))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                    .frame(width: 340, alignment: .leading)
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                        GridRow { Text("W wydarzeniu").foregroundStyle(.secondary); Text("\(line.current) szt.").fontWeight(.semibold) }
                        GridRow { Text("Można dodać").foregroundStyle(.secondary); Text("\(max(0, line.maxAdd)) szt.") }
                        GridRow { Text("Dostępne w terminie").foregroundStyle(.secondary); Text("\(line.inTerm) szt.") }
                        GridRow { Text("Inne wydarzenia").foregroundStyle(.secondary); Text("\(line.reserved) szt.") }
                        GridRow { Text("Magazyn").foregroundStyle(.secondary); Text("\(Int(line.entry.total)) szt.") }
                    }
                    .font(.callout).monospacedDigit()
                    .frame(width: 230, alignment: .leading)
                    reservationsView(line).frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(16)
            }
        } else {
            Text("Zaznacz pozycję, aby zobaczyć szczegóły i to, kto rezerwuje ją w terminie wydarzenia.")
                .foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private func reservationsView(_ line: Line) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Kto rezerwuje w tym terminie").font(.callout.weight(.semibold))
            if line.reserved <= 0 {
                Text("Żadne inne wydarzenie nie rezerwuje tej pozycji w terminie.").font(.callout).foregroundStyle(.secondary)
            } else if let data = reservations[line.id] {
                ForEach(data.reservations) { reservation in reservationRow(reservation, line) }
                if data.hiddenQuantity > 0 {
                    Text("+ \(Int(data.hiddenQuantity)) szt. w wydarzeniach, których nie widzisz").font(.caption).foregroundStyle(.secondary)
                }
                if data.reservations.isEmpty && data.hiddenQuantity <= 0 {
                    Text("Brak szczegółów rezerwacji (mogły zostać zwolnione — odśwież okno).").font(.caption).foregroundStyle(.secondary)
                }
            } else if let error = reservationErrors[line.id] {
                HStack(spacing: 6) {
                    Text(error).font(.caption).foregroundStyle(.red)
                    Button("Ponów") { Task { await loadReservations() } }.buttonStyle(.link).font(.caption)
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
    }

    private func reservationRow(_ reservation: EquipmentReservations.Reservation, _ line: Line) -> some View {
        let from = SubcontractorLabels.when(reservation.start, time: true) ?? "—"
        let to = SubcontractorLabels.when(reservation.end, time: true) ?? "—"
        let subject = "Sprzęt: \(line.entry.name) — \(reservation.name)"
        let mail: URL? = reservation.author?.email?.nonEmpty.flatMap { email in
            URL(string: "mailto:" + email + "?subject=" + (subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""))
        }
        return HStack(spacing: 10) {
            if let author = reservation.author {
                EmployeeAvatarView(name: author.name, url: author.avatarUrl, crop: author.avatar, size: 24)
            } else {
                Image(systemName: "person.crop.circle").foregroundStyle(.secondary).frame(width: 24, height: 24)
            }
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(reservation.author?.name ?? "Autor nieznany").fontWeight(.medium)
                    Text("·").foregroundStyle(.secondary)
                    Button(reservation.name) {
                        close()
                        state.showEvent(reservation.eventId, cardTab: "equipment")
                    }
                    .buttonStyle(.link).lineLimit(1).help("Otwórz kartę tego wydarzenia (zakładka Sprzęt)")
                }
                Text(from + " – " + to).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer(minLength: 8)
            Text("\(Int(reservation.quantity)) szt.").monospacedDigit().fontWeight(.semibold)
            if let mail {
                Link(destination: mail) { Image(systemName: "envelope") }.help("Napisz e-mail z pytaniem o odstąpienie")
            }
            if let phone = reservation.author?.phone?.nonEmpty {
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(phone, forType: .string)
                    state.succeed("Skopiowano numer: " + phone)
                } label: { Image(systemName: "phone") }
                .buttonStyle(.borderless).help("Kopiuj numer telefonu: " + phone)
            }
        }
        .font(.callout)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
    }

    private func close() {
        onFinished(editor.added > addedAtOpen)
        dismiss()
    }
}

/// Podgląd pozycji katalogu: powiększone zdjęcie, stany i zawartość zestawu.
struct EquipmentCatalogPreview: View {
    let entry: EquipmentCatalogEntry
    let inEvent: Int
    let maxAdd: Int
    let openDetail: (() -> Void)?

    var body: some View {
        let meta = [entry.brand ?? "", entry.model ?? ""].filter { !$0.isEmpty }.joined(separator: " • ")
        let contents = entry.contents ?? []
        VStack(alignment: .leading, spacing: 10) {
            WarehouseThumb(url: entry.thumbnail, size: 240, symbol: entry.kind == "kit" ? "shippingbox.fill" : "shippingbox")
                .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name).font(.headline)
                if !meta.isEmpty { Text(meta).font(.callout).foregroundStyle(.secondary) }
                if let category = entry.category?.nonEmpty { Text(category).font(.caption).foregroundStyle(.secondary) }
            }
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                GridRow { Text("W wydarzeniu").foregroundStyle(.secondary); Text("\(inEvent) szt.") }
                GridRow { Text("Można dodać").foregroundStyle(.secondary); Text("\(max(0, maxAdd)) szt.") }
                GridRow { Text("Dostępne w terminie").foregroundStyle(.secondary); Text("\(Int(entry.availableInTerm)) szt.") }
                GridRow { Text("Zarezerwowane").foregroundStyle(.secondary); Text("\(Int(entry.reserved)) szt.") }
                GridRow { Text("Magazyn").foregroundStyle(.secondary); Text("\(Int(entry.total)) szt.") }
            }
            .font(.callout)
            if let description = entry.description?.nonEmpty {
                Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(4)
            }
            if !contents.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Zawartość zestawu").font(.caption.weight(.semibold))
                    ForEach(Array(contents.prefix(12).enumerated()), id: \.offset) { item in
                        HStack {
                            Text(item.element.name).font(.caption).lineLimit(1)
                            Spacer()
                            Text("\(Int(item.element.quantity))×").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                    }
                    if contents.count > 12 { Text("…i \(contents.count - 12) więcej").font(.caption2).foregroundStyle(.secondary) }
                }
            }
            if let openDetail {
                Button("Otwórz kartę sprzętu", systemImage: "arrow.up.right.square", action: openDetail)
            }
        }
        .padding(14)
        .frame(width: 300)
    }
}
