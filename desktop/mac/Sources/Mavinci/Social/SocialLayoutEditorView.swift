import SwiftUI

// MARK: Edytor układów grafik — 1:1 z `SocialLayoutEditor` w CRM (Etap F): układy marki jako dane na płótnie. Lista układów
// marki (także archiwalnych) i gotowych układów jako punktów wyjścia, płótno w proporcjach formatu z podglądem z serwera (ta sama
// warstwa co render: logo, fonty i kolory z szablonu marki = księgi znaku; w miejscach zdjęć — zdjęcia zastępcze z numerami),
// elementy do przesuwania i zmiany rozmiaru (mysz, strzałki — 0,5%, z Shift — 2%; Delete — usunięcie), położenie wspólne albo
// osobne dla formatu, kolejność warstw i właściwości elementów. Zapis, kopia, archiwum i usunięcie nieużywanego układu —
// akceptujący w marce. Lista układów jest też na dysku (edytor otwiera się od razu).

/// Edytowany układ (nowy — bez `id`).
private struct SocialLayoutDraft: Equatable {
    var id: String?
    var name: String
    var definition: SocialLayoutDefinition
    var updatedAt: String?
}

/// Czynność czekająca na potwierdzenie porzucenia niezapisanych zmian.
private struct SocialLayoutDiscard: Identifiable {
    let id = UUID()
    let run: () -> Void
}

/// Wartość pola definicji z etykietą (role kolorów, wiązanie tekstu, kierunki, wyrównanie).
private struct SocialLayoutValue: Hashable {
    let value: String
    let label: String
    init(_ value: String, _ label: String) { self.value = value; self.label = label }
}

private let socialLayoutColorRoles = [SocialLayoutValue("overlay", "Przyciemnienie"), SocialLayoutValue("accent", "Akcent"), SocialLayoutValue("text", "Tekst")]
private let socialLayoutBindLabels = [SocialLayoutValue("headline", "Tytuł"), SocialLayoutValue("subline", "Podpis"), SocialLayoutValue("kicker", "Napis nad tytułem")]
private let socialLayoutHorizontal = [SocialLayoutValue("left", "Do lewej"), SocialLayoutValue("center", "Do środka"), SocialLayoutValue("right", "Do prawej")]

private func socialLayoutElementLabel(_ type: String) -> String {
    switch type {
    case "photo": return "Zdjęcie"
    case "shade": return "Przyciemnienie"
    case "box": return "Prostokąt / ramka"
    case "logo": return "Logo"
    default: return "Tekst"
    }
}

private func socialLayoutElementSymbol(_ type: String) -> String {
    switch type {
    case "photo": return "photo"
    case "shade": return "circle.lefthalf.filled"
    case "box": return "square"
    case "logo": return "seal"
    default: return "textformat"
    }
}

@MainActor struct SocialLayoutEditorView: View {
    @ObservedObject var store: SocialStore
    let companyID: String
    var templateID: String? = nil
    let onClose: () -> Void
    var onChanged: () -> Void = {}
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var reply: SocialLayoutsReply?
    @State private var loadError: String?
    @State private var draft: SocialLayoutDraft?
    @State private var baseline: SocialLayoutDraft?
    @State private var format: SocialFormat = .portrait
    @State private var selected: String?
    @State private var sampleHeadline = "Gala firmowa w Operze"
    @State private var sampleSubline = "Realizacja · Warszawa 2026"
    @State private var sampleKicker = "Realizacja"
    @State private var discard: SocialLayoutDiscard?
    @State private var confirmDelete = false
    @State private var moveStart: SocialLayoutRect?
    @State private var resizeStart: SocialLayoutRect?
    @State private var lastOverlay: NSImage?
    @FocusState private var canvasFocused: Bool

    private var editable: Bool { reply?.access.approve == true }
    /// Nowy układ (bez zapisu) albo zmiany względem zapisanej wersji.
    private var dirty: Bool {
        guard let draft else { return false }
        return draft.id == nil || draft != baseline
    }
    private var current: SocialLayoutItem? { draft?.id.flatMap { id in reply?.layouts.first { $0.id == id } } }
    private var colors: SocialTemplateColors? { reply?.template?.colors }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            HStack(alignment: .top, spacing: 12) {
                listColumn.frame(width: 230)
                canvasColumn.frame(maxWidth: .infinity, maxHeight: .infinity)
                propertiesColumn.frame(width: 320)
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: companyID) { await load(select: nil) }
        // Warstwa podglądu z serwera po zmianie układu, formatu albo przykładowych tekstów (z krótką zwłoką przy edycji).
        .task(id: overlayKey ?? "") {
            guard let draft, draft.definition.problem == nil, reply?.spec?.ready != false else { return }
            try? await Task.sleep(for: .milliseconds(450))
            if Task.isCancelled { return }
            await store.loadOverlay(company: companyID, template: overlayTemplate, format: format, headline: sampleHeadline, subline: sampleSubline,
                                    style: .classic, kicker: sampleKicker, layout: draft.definition)
        }
        .onChange(of: currentOverlayAvailable) { _, available in
            if available, let key = overlayKey, let image = store.overlays[key] { lastOverlay = image }
        }
        .onChange(of: format) { _, _ in lastOverlay = nil }
        .confirmationDialog("Niezapisane zmiany", isPresented: Binding(get: { discard != nil }, set: { if !$0 { discard = nil } }),
                            titleVisibility: .visible, presenting: discard) { action in
            Button("Porzuć zmiany", role: .destructive) { action.run() }
            Button("Wróć do edycji", role: .cancel) {}
        } message: { _ in Text("Układ ma niezapisane zmiany.") }
        .confirmationDialog("Usunąć układ?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń układ", role: .destructive) { Task { await remove() } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Układ zostanie trwale usunięty. Tej operacji nie można cofnąć.") }
    }

    // MARK: Dane

    private func load(select id: String?) async {
        if reply == nil, let cached = await store.cachedLayouts(company: companyID) { reply = cached }
        do {
            let fresh = try await store.fetchLayouts(company: companyID, template: templateID)
            reply = fresh
            loadError = nil
            if let id, let item = fresh.layouts.first(where: { $0.id == id }) { open(item) }
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać układów.")
        }
    }

    private func open(_ item: SocialLayoutItem) {
        let value = SocialLayoutDraft(id: item.id, name: item.name, definition: item.definition, updatedAt: item.updatedAt)
        draft = value
        baseline = value
        selected = nil
        lastOverlay = nil
    }

    /// Czynność po potwierdzeniu porzucenia niezapisanych zmian (bez zmian — od razu).
    private func guarded(_ action: @escaping () -> Void) {
        if dirty { discard = SocialLayoutDiscard(run: action) } else { action() }
    }

    private func startNew(_ definition: SocialLayoutDefinition, name: String) {
        guarded {
            let value = SocialLayoutDraft(id: nil, name: name, definition: definition, updatedAt: nil)
            draft = value
            baseline = value
            selected = nil
            lastOverlay = nil
        }
    }

    /// Kopia bieżącego układu (z niezapisanymi zmianami) jako nowy układ — oryginał zostaje bez zmian.
    private func duplicate() {
        guard let draft else { return }
        let value = SocialLayoutDraft(id: nil, name: String((draft.name + " (kopia)").prefix(SocialLayoutLimits.name)), definition: draft.definition, updatedAt: nil)
        self.draft = value
        baseline = value
    }

    private func save() async {
        guard let draft else { return }
        if let problem = draft.definition.problem { state.error = problem; return }
        let body: [String: JSONValue] = [
            "companyId": .string(companyID), "id": draft.id.map(JSONValue.string) ?? .null, "name": .string(draft.name),
            "definition": draft.definition.json, "updatedAt": draft.updatedAt.map(JSONValue.string) ?? .null,
            "templateId": templateID.map(JSONValue.string) ?? .null,
        ]
        guard let result = await store.layoutAction("Zapisuję układ", "saveLayout", body, success: "Zapisano układ") else { return }
        reply = result
        if let id = result.savedId, let item = result.layouts.first(where: { $0.id == id }) { open(item) }
        onChanged()
    }

    private func archive(_ archived: Bool) async {
        guard let id = draft?.id else { return }
        let pending: String = archived ? "Przenoszę do archiwum" : "Przywracam układ"
        let success: String = archived ? "Układ jest w archiwum" : "Przywrócono układ"
        let body: [String: JSONValue] = ["id": .string(id), "archived": .bool(archived), "templateId": templateID.map(JSONValue.string) ?? .null]
        guard let result = await store.layoutAction(pending, "archiveLayout", body, success: success) else { return }
        reply = result
        // Archiwum zmienia znacznik wersji — niezapisane zmiany w edytorze zostają i dalej dadzą się zapisać.
        if let item = result.layouts.first(where: { $0.id == id }) {
            if draft?.id == id { draft?.updatedAt = item.updatedAt }
            if baseline?.id == id { baseline?.updatedAt = item.updatedAt }
        }
        onChanged()
    }

    private func remove() async {
        guard let id = draft?.id else { return }
        let body: [String: JSONValue] = ["id": .string(id), "templateId": templateID.map(JSONValue.string) ?? .null]
        guard let result = await store.layoutAction("Usuwam układ", "deleteLayout", body, success: "Usunięto układ") else { return }
        reply = result
        draft = nil
        baseline = nil
        selected = nil
        onChanged()
    }

    // MARK: Zmiany definicji

    private func element(_ id: String) -> SocialLayoutElement? { draft?.definition.elements.first { $0.id == id } }

    private func updateDefinition(_ change: (inout SocialLayoutDefinition) -> Void) {
        guard var value = draft else { return }
        change(&value.definition)
        draft = value
    }

    private func updateElement(_ id: String, _ change: (inout SocialLayoutElement) -> Void) {
        updateDefinition { definition in
            guard let index = definition.elements.firstIndex(where: { $0.id == id }) else { return }
            change(&definition.elements[index])
        }
    }

    private static func round4(_ value: Double) -> Double { (value * 10000).rounded() / 10000 }
    private static func snap(_ value: Double) -> Double { (value / 0.005).rounded() * 0.005 }

    /// Prostokąt w granicach grafiki (jak w CRM).
    private static func clamp(_ rect: SocialLayoutRect) -> SocialLayoutRect {
        let w = min(1, max(0.01, rect.w))
        let h = min(1, max(0.005, rect.h))
        return SocialLayoutRect(x: round4(min(1 - w, max(0, rect.x))), y: round4(min(1 - h, max(0, rect.y))), w: round4(w), h: round4(h))
    }

    /// Położenie w aktywnym formacie: osobne dla formatu (gdy element je ma) albo wspólne.
    private func setRect(_ id: String, _ rect: SocialLayoutRect) {
        let value = Self.clamp(rect)
        let key = format.rawValue
        updateElement(id) { element in
            if element.formats?[key] != nil { element.formats?[key] = value } else { element.rect = value }
        }
    }

    private func removeElement(_ id: String) {
        updateDefinition { $0.elements.removeAll { $0.id == id } }
        if selected == id { selected = nil }
    }

    private func moveElement(_ id: String, by offset: Int) {
        updateDefinition { definition in
            guard let index = definition.elements.firstIndex(where: { $0.id == id }) else { return }
            let target = index + offset
            guard target >= 0, target < definition.elements.count else { return }
            definition.elements.swapAt(index, target)
        }
    }

    private static func newID(_ type: String) -> String {
        "\(type)-\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))\(String(Int.random(in: 36...1295), radix: 36))"
    }

    private static var emptyDefinition: SocialLayoutDefinition {
        SocialLayoutDefinition(v: 1, background: "overlay", elements: [
            SocialLayoutElement(id: "photo-1", type: "photo", rect: SocialLayoutRect(x: 0, y: 0, w: 1, h: 1), slot: 0, radius: 0),
        ])
    }

    private static func newElement(_ type: String, slots: Int) -> SocialLayoutElement {
        let id = newID(type)
        switch type {
        case "photo":
            return SocialLayoutElement(id: id, type: type, rect: SocialLayoutRect(x: 0.25, y: 0.25, w: 0.5, h: 0.5), slot: slots, radius: 0)
        case "shade":
            return SocialLayoutElement(id: id, type: type, rect: SocialLayoutRect(x: 0, y: 0.55, w: 1, h: 0.45), color: "overlay", direction: "down", from: 0, to: 0.85)
        case "box":
            return SocialLayoutElement(id: id, type: type, rect: SocialLayoutRect(x: 0.4, y: 0.88, w: 0.2, h: 0.005), radius: 0,
                                       fill: SocialLayoutFill(color: "accent", opacity: 1), stroke: nil)
        case "logo":
            return SocialLayoutElement(id: id, type: type, rect: SocialLayoutRect(x: 0.38, y: 0.04, w: 0.24, h: 0.1), align: "center", valign: "middle")
        default:
            return SocialLayoutElement(id: id, type: "text", rect: SocialLayoutRect(x: 0.08, y: 0.78, w: 0.84, h: 0.07), color: "text", align: "center",
                                       bind: "headline", font: "title", size: 36, tracking: 0.2)
        }
    }

    private func addElement(_ type: String) {
        guard let definition = draft?.definition else { return }
        if definition.elements.count >= SocialLayoutLimits.elements {
            state.error = "Układ może mieć najwyżej \(SocialLayoutLimits.elements) elementów."
            return
        }
        // Kolejne miejsce na zdjęcie (bez zdjęć — miejsce 1, czyli zdjęcie posta).
        let nextSlot = (definition.elements.compactMap { $0.type == "photo" ? ($0.slot ?? 0) : nil }.max() ?? -1) + 1
        if type == "photo", nextSlot >= SocialLayoutLimits.slots {
            state.error = "Kolaż może mieć najwyżej \(SocialLayoutLimits.slots) zdjęcia."
            return
        }
        let item = Self.newElement(type, slots: nextSlot)
        updateDefinition { value in
            // Zdjęcia rysują się pod resztą — nowe zdjęcie za ostatnim zdjęciem na liście.
            if type == "photo" {
                let index = (value.elements.lastIndex { $0.type == "photo" } ?? -1) + 1
                value.elements.insert(item, at: index)
            } else {
                value.elements.append(item)
            }
        }
        selected = item.id
    }

    // MARK: Podgląd z serwera

    private var overlayTemplate: String? { templateID ?? reply?.spec?.templateId }

    private var overlayKey: String? {
        guard let draft else { return nil }
        return SocialStore.overlayKey(company: companyID, template: overlayTemplate, format: format, headline: sampleHeadline, subline: sampleSubline,
                                      style: .classic, kicker: sampleKicker, layout: draft.definition)
    }

    private var currentOverlay: NSImage? { overlayKey.flatMap { store.overlays[$0] } }
    private var currentOverlayAvailable: Bool { currentOverlay != nil }

    private func roleColor(_ role: String?) -> Color {
        switch role {
        case "accent": return CrmTheme.hex(colors?.accent) ?? CrmTheme.rgb(0xd3bb73)
        case "text": return CrmTheme.hex(colors?.text) ?? Color.white
        default: return CrmTheme.hex(colors?.overlay) ?? CrmTheme.rgb(0x1c1f33)
        }
    }

    // MARK: Pasek

    private var toolbar: some View {
        HStack(spacing: 8) {
            Button { guarded { onClose() } } label: { Label("Zamknij", systemImage: "chevron.left") }
            Label("Układy grafik", systemImage: "rectangle.3.group").font(.headline)
            Text("Logo, fonty i kolory zawsze z księgi znaku marki — układ wskazuje tylko role.")
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            if dirty { Text("· niezapisane zmiany").font(.caption).foregroundStyle(.secondary) }
            Spacer(minLength: 8)
            if let draft, editable {
                if draft.id != nil {
                    Button { duplicate() } label: { Label("Kopia", systemImage: "plus.square.on.square") }
                        .help("Nowy układ na podstawie tego (oryginał zostaje bez zmian)")
                }
                if let item = current {
                    if item.archived {
                        Button { Task { await archive(false) } } label: { Label("Przywróć", systemImage: "arrow.uturn.backward") }
                    } else {
                        Button { Task { await archive(true) } } label: { Label("Do archiwum", systemImage: "archivebox") }
                            .help("Układ zniknie z kreatora posta; posty z tym układem działają dalej")
                    }
                    if item.usedBy == 0 {
                        Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń", systemImage: "trash") }
                    }
                }
                Button { Task { await save() } } label: { Label("Zapisz układ", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut("s", modifiers: .command)
                    .disabled(!dirty || draft.definition.problem != nil || draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    // MARK: Lewa kolumna — układy

    private var listColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if editable {
                    Text("Nowy układ").font(.caption.weight(.semibold))
                    Button { startNew(Self.emptyDefinition, name: "Nowy układ") } label: {
                        Label("Pusty (jedno zdjęcie)", systemImage: "plus").frame(maxWidth: .infinity)
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                        ForEach(reply?.presets ?? []) { preset in
                            Button { startNew(preset.definition, name: preset.name) } label: {
                                SocialLayoutThumb(definition: preset.definition, format: .portrait, width: 56, colors: colors)
                                    .padding(3)
                                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.15)))
                            }
                            .buttonStyle(.plain)
                            .help("Na podstawie: \(preset.name)")
                        }
                    }
                }
                Text("Układy marki").font(.caption.weight(.semibold))
                if let loadError, reply == nil {
                    Text(loadError).font(.caption2).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    Button("Spróbuj ponownie") { Task { await load(select: nil) } }
                } else if reply == nil {
                    ProgressView().controlSize(.small)
                } else if reply?.layouts.isEmpty == true {
                    Text("Marka nie ma jeszcze własnych układów — zacznij od gotowego albo pustego.")
                        .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(reply?.layouts ?? []) { item in layoutRow(item) }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func layoutRow(_ item: SocialLayoutItem) -> some View {
        let active = draft?.id == item.id
        let photos: String = item.slots == 1 ? "1 zdjęcie" : "\(item.slots) zdjęcia"
        let used: String = item.usedBy > 0 ? " · w \(item.usedBy) post." : ""
        return Button {
            guard draft?.id != item.id else { return }
            guarded { open(item) }
        } label: {
            HStack(spacing: 8) {
                SocialLayoutThumb(definition: item.definition, format: .portrait, width: 40, colors: colors)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).font(.caption).lineLimit(1)
                    Text(photos + used + (item.archived ? " · archiwum" : "")).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 8).fill(active ? theme.accent.opacity(0.12) : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(active ? theme.accent : Color.primary.opacity(0.12)))
            .opacity(item.archived ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Środek — płótno

    private var canvasColumn: some View {
        VStack(spacing: 10) {
            if let draft {
                Picker("Format", selection: $format) {
                    ForEach(SocialFormat.allCases) { item in Text(item.label).tag(item) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                GeometryReader { geometry in
                    let wide: Double = Double(geometry.size.width) - 8
                    let tall: Double = (Double(geometry.size.height) - 8) * format.aspect
                    let width: Double = max(200, min(wide, tall, 760))
                    let height: Double = width / format.aspect
                    canvas(draft.definition, width: width, height: height)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(minHeight: 320)
                if reply?.spec == nil || reply?.spec?.ready == false {
                    Text("Marka nie ma gotowego szablonu grafik — podgląd z logo, fontami i kolorami pojawi się po uzupełnieniu szablonu (księga znaku). Do tego czasu — schemat układu.")
                        .font(.caption2).foregroundStyle(.orange).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                }
                Text("Kliknij element, przeciągnij go albo jego narożnik; strzałki — przesunięcie o 0,5% (z Shift — 2%), Delete — usunięcie. Zdjęcia zastępcze pokazują miejsca kolażu.")
                    .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    sampleField("Przykład: napis nad tytułem", text: $sampleKicker)
                    sampleField("Przykład: tytuł", text: $sampleHeadline)
                    sampleField("Przykład: podpis", text: $sampleSubline)
                }
            } else {
                ContentUnavailableView {
                    Label("Układy grafik", systemImage: "rectangle.3.group")
                } description: {
                    Text("Wybierz układ marki z listy albo utwórz nowy — z gotowego układu albo pusty.")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func sampleField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            TextField(title, text: text).textFieldStyle(.roundedBorder).labelsHidden()
        }
    }

    /// Płótno: tło i zdjęcia zastępcze pod warstwą z serwera (nieaktualna — przygaszona z kółkiem; brak — schemat układu),
    /// strefy zasłaniane w relacji i ramki elementów do przesuwania.
    private func canvas(_ definition: SocialLayoutDefinition, width: Double, height: Double) -> some View {
        let overlay: NSImage? = currentOverlay ?? lastOverlay
        let stale: Bool = currentOverlay == nil
        let guides: SocialGuides? = reply?.spec?.guides[format.rawValue]
        return ZStack(alignment: .topLeading) {
            if let overlay {
                roleColor(definition.background)
                ForEach(definition.elements.filter { $0.type == "photo" }) { element in placeholder(element, width: width, height: height) }
                Image(nsImage: overlay).resizable().interpolation(.high).frame(width: width, height: height).opacity(stale ? 0.55 : 1)
            } else {
                SocialLayoutThumb(definition: definition, format: format, width: width, colors: colors)
            }
            if let top = guides?.unsafeTop {
                Rectangle().fill(Color.red.opacity(0.15)).frame(width: width, height: top.h * height).allowsHitTesting(false)
            }
            if let bottom = guides?.unsafeBottom {
                Rectangle().fill(Color.red.opacity(0.15)).frame(width: width, height: bottom.h * height)
                    .offset(y: height - bottom.h * height).allowsHitTesting(false)
            }
            ForEach(definition.elements) { element in elementBox(element, width: width, height: height) }
            if stale && definition.problem == nil && reply?.spec?.ready == true {
                ProgressView().controlSize(.small).padding(6).offset(x: width - 32, y: 4).allowsHitTesting(false)
            }
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .clipped()
        .contentShape(Rectangle())
        .onTapGesture { selected = nil; canvasFocused = true }
        .focusable()
        .focused($canvasFocused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .delete, .deleteForward]) { press in handleKey(press) }
    }

    private func placeholder(_ element: SocialLayoutElement, width: Double, height: Double) -> some View {
        let rect = element.rect(format)
        let slot = element.slot ?? 0
        let hue = Double((200 + slot * 47) % 360) / 360
        return ZStack {
            LinearGradient(colors: [Color(hue: hue, saturation: 0.18, brightness: 0.55),
                                    Color(hue: (hue + 30.0 / 360.0).truncatingRemainder(dividingBy: 1), saturation: 0.22, brightness: 0.3)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            Text("\(slot + 1)").font(.system(size: max(10, min(rect.w * width, rect.h * height) * 0.25), weight: .light)).foregroundStyle(.white.opacity(0.55))
        }
        .frame(width: max(1, rect.w * width), height: max(1, rect.h * height))
        .clipShape(RoundedRectangle(cornerRadius: (element.radius ?? 0) * width / 1080))
        .offset(x: rect.x * width, y: rect.y * height)
        .allowsHitTesting(false)
    }

    private func elementTitle(_ element: SocialLayoutElement) -> String {
        var title = socialLayoutElementLabel(element.type)
        if element.type == "photo" { title += " \((element.slot ?? 0) + 1)" }
        if element.type == "text" { title += " · " + (socialLayoutBindLabels.first { $0.value == element.bind }?.label ?? "Tytuł") }
        return title
    }

    private func elementBox(_ element: SocialLayoutElement, width: Double, height: Double) -> some View {
        let rect = element.rect(format)
        let active = element.id == selected
        let boxWidth = max(6, rect.w * width)
        let boxHeight = max(6, rect.h * height)
        let border: Color = active ? theme.accent : Color.white.opacity(0.45)
        let style = StrokeStyle(lineWidth: active ? 2 : 1, dash: active ? [] : [4, 3])
        return ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.white.opacity(0.001))
            Rectangle().strokeBorder(border, style: style)
            if active {
                Text(elementTitle(element) + (element.formats?[format.rawValue] != nil ? " · ten format" : ""))
                    .font(.caption2).lineLimit(1).padding(.horizontal, 4).padding(.vertical, 1)
                    .background(theme.accent).foregroundStyle(Color.black.opacity(0.85))
                if editable {
                    RoundedRectangle(cornerRadius: 2).fill(theme.accent).frame(width: 10, height: 10)
                        .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color.black.opacity(0.6)))
                        .offset(x: boxWidth - 10, y: boxHeight - 10)
                        .highPriorityGesture(resizeGesture(element.id, width: width, height: height))
                        .help("Zmień rozmiar")
                }
            }
        }
        .frame(width: boxWidth, height: boxHeight, alignment: .topLeading)
        .offset(x: rect.x * width, y: rect.y * height)
        .zIndex(active ? 1 : 0)
        .onTapGesture { selected = element.id; canvasFocused = true }
        .gesture(moveGesture(element.id, width: width, height: height))
        .help(elementTitle(element))
    }

    private func moveGesture(_ id: String, width: Double, height: Double) -> some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                guard editable, let element = element(id) else { return }
                if moveStart == nil { moveStart = element.rect(format); selected = id; canvasFocused = true }
                guard let start = moveStart else { return }
                setRect(id, SocialLayoutRect(x: Self.snap(start.x + value.translation.width / width), y: Self.snap(start.y + value.translation.height / height),
                                             w: start.w, h: start.h))
            }
            .onEnded { _ in moveStart = nil }
    }

    private func resizeGesture(_ id: String, width: Double, height: Double) -> some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                guard editable, let element = element(id) else { return }
                if resizeStart == nil { resizeStart = element.rect(format) }
                guard let start = resizeStart else { return }
                let w = min(1 - start.x, Self.snap(start.w + value.translation.width / width))
                let h = min(1 - start.y, max(0.005, Self.snap(start.h + value.translation.height / height)))
                setRect(id, SocialLayoutRect(x: start.x, y: start.y, w: w, h: h))
            }
            .onEnded { _ in resizeStart = nil }
    }

    private func handleKey(_ press: KeyPress) -> KeyPress.Result {
        guard editable, let id = selected, let element = element(id) else { return .ignored }
        let step: Double = press.modifiers.contains(.shift) ? 0.02 : 0.005
        var rect = element.rect(format)
        switch press.key {
        case .leftArrow: rect.x -= step
        case .rightArrow: rect.x += step
        case .upArrow: rect.y -= step
        case .downArrow: rect.y += step
        case .delete, .deleteForward:
            removeElement(id)
            return .handled
        default: return .ignored
        }
        setRect(id, rect)
        return .handled
    }

    // MARK: Prawa kolumna — właściwości

    private var propertiesColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let draft {
                    Text("Nazwa układu").font(.caption)
                    TextField("Nazwa układu", text: Binding(get: { self.draft?.name ?? "" }, set: { value in
                        self.draft?.name = String(value.prefix(SocialLayoutLimits.name))
                    }))
                    .textFieldStyle(.roundedBorder).disabled(!editable)
                    Text("Tło (miejsca bez zdjęć, odstępy kolażu)").font(.caption)
                    rolePicker(Binding(get: { self.draft?.definition.background ?? "overlay" }, set: { value in
                        updateDefinition { $0.background = value }
                    }))
                    if let problem = draft.definition.problem {
                        Text(problem).font(.caption).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 6).fill(Color.orange.opacity(0.15)))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if editable { addButtons }
                    elementsList(draft.definition)
                    if let id = selected, let element = element(id) {
                        Divider()
                        properties(element)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private var addButtons: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Dodaj element").font(.caption.weight(.semibold))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], alignment: .leading, spacing: 6) {
                ForEach(["photo", "shade", "box", "logo", "text"], id: \.self) { type in
                    Button { addElement(type) } label: {
                        Label(type == "box" ? "Prostokąt" : socialLayoutElementLabel(type), systemImage: socialLayoutElementSymbol(type))
                            .font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private func elementsList(_ definition: SocialLayoutDefinition) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Elementy (kolejność rysowania; zdjęcia zawsze pod resztą)").font(.caption.weight(.semibold))
            ForEach(Array(definition.elements.enumerated()), id: \.element.id) { item in
                elementRow(item.element, index: item.offset, count: definition.elements.count)
            }
        }
    }

    private func elementRow(_ element: SocialLayoutElement, index: Int, count: Int) -> some View {
        let active = element.id == selected
        return HStack(spacing: 6) {
            Button { selected = element.id } label: {
                HStack(spacing: 6) {
                    Image(systemName: socialLayoutElementSymbol(element.type)).foregroundStyle(theme.accent).frame(width: 16)
                    Text(elementTitle(element)).font(.caption).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if editable {
                Button { moveElement(element.id, by: -1) } label: { Image(systemName: "arrow.up") }
                    .buttonStyle(.borderless).disabled(index == 0).help("Niżej (wcześniej rysowany)")
                Button { moveElement(element.id, by: 1) } label: { Image(systemName: "arrow.down") }
                    .buttonStyle(.borderless).disabled(index == count - 1).help("Wyżej (później rysowany)")
                Button { removeElement(element.id) } label: { Image(systemName: "trash").foregroundStyle(.red) }
                    .buttonStyle(.borderless).help("Usuń")
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 6).fill(active ? theme.accent.opacity(0.12) : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? theme.accent : Color.primary.opacity(0.1)))
    }

    // MARK: Właściwości elementu

    private func rolePicker(_ selection: Binding<String>) -> some View {
        Picker("Kolor", selection: selection) {
            ForEach(socialLayoutColorRoles, id: \.value) { role in Text(role.label).tag(role.value) }
        }
        .labelsHidden()
        .disabled(!editable)
    }

    private func optionPicker(_ title: String, _ options: [SocialLayoutValue], _ selection: Binding<String>) -> some View {
        Picker(title, selection: selection) {
            ForEach(options, id: \.value) { option in Text(option.label).tag(option.value) }
        }
        .disabled(!editable)
    }

    private func text(_ id: String, _ keyPath: WritableKeyPath<SocialLayoutElement, String?>, _ fallback: String) -> Binding<String> {
        Binding(get: { element(id)?[keyPath: keyPath] ?? fallback }, set: { value in updateElement(id) { $0[keyPath: keyPath] = value } })
    }

    private func number(_ id: String, _ keyPath: WritableKeyPath<SocialLayoutElement, Double?>, _ fallback: Double, _ range: ClosedRange<Double>) -> Binding<Double> {
        Binding(get: { element(id)?[keyPath: keyPath] ?? fallback }, set: { value in
            updateElement(id) { $0[keyPath: keyPath] = min(range.upperBound, max(range.lowerBound, value)) }
        })
    }

    private func numberField(_ title: String, _ value: Binding<Double>, digits: Int = 0) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            TextField(title, value: value, format: .number.precision(.fractionLength(0...digits))).textFieldStyle(.roundedBorder).labelsHidden()
                .disabled(!editable)
        }
    }

    private func slider(_ title: String, _ value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(title): \(Int((value.wrappedValue * 100).rounded()))%").font(.caption2).foregroundStyle(.secondary)
            Slider(value: value, in: 0...1).disabled(!editable)
        }
    }

    private func rectField(_ id: String, _ title: String, _ keyPath: WritableKeyPath<SocialLayoutRect, Double>) -> some View {
        let value = Binding<Double>(get: {
            guard let element = element(id) else { return 0 }
            return (element.rect(format)[keyPath: keyPath] * 1000).rounded() / 10
        }, set: { value in
            guard let element = element(id) else { return }
            var rect = element.rect(format)
            rect[keyPath: keyPath] = value / 100
            setRect(id, rect)
        })
        return numberField(title, value, digits: 1)
    }

    private func properties(_ element: SocialLayoutElement) -> some View {
        let id = element.id
        let ownFormat = Binding<Bool>(get: { self.element(id)?.formats?[format.rawValue] != nil }, set: { on in
            let key = format.rawValue
            updateElement(id) { item in
                var formats = item.formats ?? [:]
                if on { formats[key] = item.rect(format) } else { formats[key] = nil }
                item.formats = formats.isEmpty ? nil : formats
            }
        })
        return VStack(alignment: .leading, spacing: 8) {
            Text("\(socialLayoutElementLabel(element.type)) — \(format.label)").font(.caption.weight(.semibold))
            Toggle("Osobne położenie w tym formacie (inaczej — wspólne dla formatów bez własnego)", isOn: ownFormat)
                .font(.caption).disabled(!editable)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                rectField(id, "Od lewej (%)", \.x)
                rectField(id, "Od góry (%)", \.y)
                rectField(id, "Szerokość (%)", \.w)
                rectField(id, "Wysokość (%)", \.h)
            }
            typeProperties(element)
        }
    }

    @ViewBuilder private func typeProperties(_ element: SocialLayoutElement) -> some View {
        let id = element.id
        switch element.type {
        case "photo":
            let slot = Binding<Int>(get: { self.element(id)?.slot ?? 0 }, set: { value in updateElement(id) { $0.slot = value } })
            Picker("Zdjęcie nr", selection: slot) {
                ForEach(0..<SocialLayoutLimits.slots, id: \.self) { index in Text(index == 0 ? "1 (zdjęcie posta)" : "\(index + 1)").tag(index) }
            }
            .disabled(!editable)
            numberField("Zaokrąglenie (px)", number(id, \.radius, 0, 0...400))
        case "shade":
            rolePicker(text(id, \.color, "overlay"))
            optionPicker("Kierunek", [SocialLayoutValue("down", "Ciemniej w dół"), SocialLayoutValue("up", "Ciemniej w górę"),
                                      SocialLayoutValue("left", "Ciemniej w lewo"), SocialLayoutValue("right", "Ciemniej w prawo")],
                         text(id, \.direction, "down"))
            slider("Krycie na początku", number(id, \.from, 0, 0...1))
            slider("Krycie na końcu", number(id, \.to, 0.8, 0...1))
        case "box":
            boxProperties(element)
        case "logo":
            optionPicker("Poziomo", socialLayoutHorizontal, text(id, \.align, "center"))
            optionPicker("Pionowo", [SocialLayoutValue("top", "Do góry"), SocialLayoutValue("middle", "Pośrodku"), SocialLayoutValue("bottom", "Do dołu")],
                         text(id, \.valign, "middle"))
        default:
            optionPicker("Treść", socialLayoutBindLabels, text(id, \.bind, "headline"))
            optionPicker("Font", [SocialLayoutValue("title", "Font tytułu"), SocialLayoutValue("caption", "Font podpisu")], text(id, \.font, "title"))
            HStack {
                Text("Kolor").font(.caption)
                rolePicker(text(id, \.color, "text"))
            }
            optionPicker("Wyrównanie", socialLayoutHorizontal, text(id, \.align, "center"))
            HStack(spacing: 6) {
                numberField("Wielkość (px)", number(id, \.size, 34, 6...260))
                numberField("Odstęp liter (em)", number(id, \.tracking, 0.2, 0...1), digits: 2)
            }
            Text("Tekst w jednej linii, wersalikami; dłuższy niż prostokąt jest zmniejszany. Wielkość w px dla szerokości 1080.")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private func boxProperties(_ element: SocialLayoutElement) -> some View {
        let id = element.id
        let fillOn = Binding<Bool>(get: { self.element(id)?.fill != nil }, set: { on in
            updateElement(id) { $0.fill = on ? SocialLayoutFill(color: "accent", opacity: 1) : nil }
        })
        let strokeOn = Binding<Bool>(get: { self.element(id)?.stroke != nil }, set: { on in
            updateElement(id) { $0.stroke = on ? SocialLayoutStroke(color: "accent", width: 2, opacity: 1) : nil }
        })
        Toggle("Wypełnienie", isOn: fillOn).font(.caption).disabled(!editable)
        if element.fill != nil {
            rolePicker(Binding(get: { self.element(id)?.fill?.color ?? "accent" }, set: { value in updateElement(id) { $0.fill?.color = value } }))
            slider("Krycie wypełnienia", Binding(get: { self.element(id)?.fill?.opacity ?? 1 }, set: { value in updateElement(id) { $0.fill?.opacity = value } }))
        }
        Toggle("Ramka", isOn: strokeOn).font(.caption).disabled(!editable)
        if element.stroke != nil {
            rolePicker(Binding(get: { self.element(id)?.stroke?.color ?? "accent" }, set: { value in updateElement(id) { $0.stroke?.color = value } }))
            numberField("Grubość (px)", Binding(get: { self.element(id)?.stroke?.width ?? 2 }, set: { value in
                updateElement(id) { $0.stroke?.width = min(60, max(0.5, value)) }
            }), digits: 1)
            slider("Krycie ramki", Binding(get: { self.element(id)?.stroke?.opacity ?? 1 }, set: { value in updateElement(id) { $0.stroke?.opacity = value } }))
        }
        numberField("Zaokrąglenie (px)", number(id, \.radius, 0, 0...400))
    }
}
