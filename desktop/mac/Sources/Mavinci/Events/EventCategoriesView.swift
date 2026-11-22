import SwiftUI
import AppKit

// MARK: Kategorie wydarzeń — 1:1 ze stroną `/crm/event-categories`: kafelki kategorii (kolor, ikona, nazwa, zapis koloru, opis,
// Aktywna / Nieaktywna), „Nowa kategoria” i edycja (nazwa, ikona z biblioteki, kolor z próbnikiem i paletą, opis, szablon oferty,
// szablon umowy, aktywna), usuwanie z potwierdzeniem oraz „Zarządzaj ikonami” (dodawanie, edycja i usuwanie ikon SVG z podglądem).
// Dostęp jak w CRM — uprawnienie `event_categories_manage`. Serwer: `/bridge/native/v1/event-categories`
// (`src/lib/native/eventCategories.ts`).

struct EventCategoriesData: Decodable {
    struct Icon: Decodable, Identifiable, Equatable { var id: String; var name: String; var svgCode: String; var previewColor: String }
    struct Category: Decodable, Identifiable {
        var id: String
        var name: String
        var color: String
        var description: String
        var isActive: Bool
        var iconId: String?
        var icon: Icon?
        var contractTemplateId: String?
        var offerTemplateCategoryId: String?
    }
    struct Option: Decodable, Identifiable { var id: String; var name: String }
    var categories: [Category]
    var icons: [Icon]
    var contractTemplates: [Option]
    var offerTemplateCategories: [Option]
}

/// Ikona z biblioteki (`custom_icons.svg_code`) jako obraz wektorowy; `currentColor` przyjmuje kolor jak tekst w CRM.
@MainActor enum CustomSVGIcons {
    private static var cache: [String: NSImage] = [:]
    /// Obraz w rozmiarze `size` (dłuższy bok) — wektor rysowany ostro w tym rozmiarze, bez skalowania bitmapy.
    static func image(_ svg: String, color: String, size: CGFloat) -> NSImage? {
        let key = "\(Int(size))|" + color + "|" + svg
        if let hit = cache[key] { return hit }
        var source = svg.replacingOccurrences(of: "currentColor", with: color)
        if let tag = source.range(of: "<svg", options: .caseInsensitive), source.range(of: "xmlns=", options: .caseInsensitive) == nil {
            source.replaceSubrange(tag, with: "<svg xmlns=\"http://www.w3.org/2000/svg\"")
        }
        guard let data = source.data(using: .utf8), let image = NSImage(data: data), image.isValid else { return nil }
        let longer = max(image.size.width, image.size.height)
        if longer > 0 { image.size = NSSize(width: image.size.width * size / longer, height: image.size.height * size / longer) }
        if cache.count > 400 { cache.removeAll() }
        cache[key] = image
        return image
    }
}

/// Podgląd ikony SVG w kwadracie `size` (brak albo błędny kod — `fallback`).
@MainActor struct CustomSVGIconView: View {
    let svg: String
    var color = "#ffffff"
    let size: CGFloat
    var fallback = "paintpalette"

    var body: some View {
        if let image = CustomSVGIcons.image(svg, color: color, size: size) {
            Image(nsImage: image).resizable().interpolation(.high).scaledToFit().frame(width: size, height: size)
        } else {
            Image(systemName: fallback).font(.system(size: size * 0.8)).foregroundStyle(CrmTheme.hex(color) ?? .white).frame(width: size, height: size)
        }
    }
}

@MainActor final class EventCategoriesModel: ObservableObject {
    @Published var data: EventCategoriesData?
    @Published var loadError: String?
    /// Odmowa dostępu (403) — jak „Brak uprawnień” w CRM.
    @Published var denied = false
    @Published var loading = false
    @Published var saving = false
    weak var state: Workspace?
    var onChanged: () -> Void = {}

    static let presetColors = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#6B7280", "#14B8A6", "#F97316", "#84CC16"]
    static func validColor(_ value: String) -> Bool { value.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil }

    func load() async {
        guard let api = state?.nativeAPI() else { loadError = AppError.configuration.localizedDescription; return }
        loading = true
        defer { loading = false }
        do {
            data = try JSONDecoder().decode(EventCategoriesData.self, from: try await api.get("/event-categories", query: ["op": "list"]))
            loadError = nil
            denied = false
        } catch {
            denied = (error as? NativeFailure)?.status == 403
            loadError = Self.message(error, "Nie udało się pobrać kategorii eventów.")
        }
    }

    /// Zapis na serwerze; po sukcesie komunikat z serwera, odświeżenie i powiadomienie listy wydarzeń.
    func post(_ body: [String: JSONValue], fallback: String) async -> Bool {
        guard let state else { return false }
        guard state.canWrite, let api = state.nativeAPI() else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        saving = true
        defer { saving = false }
        do {
            let raw = try await api.post("/event-categories", body)
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: raw)) ?? [:]
            if let message = reply["message"]?.text.nonEmpty { state.succeed(message) }
            await load()
            onChanged()
            return true
        } catch {
            state.error = Self.message(error, fallback)
            return false
        }
    }

    static func message(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }
}

// MARK: Lista kategorii

@MainActor struct EventCategoriesSheet: View {
    var onChanged: () -> Void = {}
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = EventCategoriesModel()
    @State private var editing: CategoryDraft?
    @State private var iconsShown = false
    @State private var removing: EventCategoriesData.Category?

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Kategorie eventów").font(.title2.bold())
                    Text("Zarządzaj kategoriami i ikonami dla eventów").foregroundStyle(.secondary)
                }
                Spacer()
                if model.data != nil {
                    Button { iconsShown = true } label: { Label("Zarządzaj ikonami", systemImage: "sparkles") }
                    Button { editing = CategoryDraft() } label: { Label("Nowa kategoria", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(20)
            Divider()
            content
        }
        .frame(minWidth: 760, idealWidth: 960, minHeight: 520, idealHeight: 720)
        .background(theme.page)
        .overlay { if model.saving { PendingOverlay(text: "Zapisywanie…") } }
        .task {
            model.state = state
            model.onChanged = onChanged
            await model.load()
        }
        .sheet(item: $editing) { draft in
            EventCategoryEditor(model: model, draft: draft)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $iconsShown) {
            CustomIconsSheet(model: model)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Czy na pewno chcesz usunąć tę kategorię?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                if let category = removing { Task { _ = await model.post(["op": .string("delete"), "id": .string(category.id)], fallback: "Nie udało się usunąć kategorii.") } }
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text("Eventy i produkty z tą kategorią zostaną bez kategorii.") }
    }

    @ViewBuilder private var content: some View {
        if let data = model.data {
            if data.categories.isEmpty {
                ContentUnavailableView {
                    Label("Brak kategorii", systemImage: "tag")
                } actions: { Button("Nowa kategoria") { editing = CategoryDraft() } }
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 14)], spacing: 14) {
                        ForEach(data.categories) { category in card(category) }
                    }
                    .padding(20)
                }
            }
        } else if let error = model.loadError {
            ContentUnavailableView {
                Label(model.denied ? "Brak uprawnień" : "Nie udało się pobrać kategorii", systemImage: model.denied ? "exclamationmark.shield" : "wifi.exclamationmark")
            } description: { Text(error) } actions: {
                if !model.denied { Button("Spróbuj ponownie") { Task { await model.load() } } }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func card(_ category: EventCategoriesData.Category) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 8).fill(CrmTheme.hex(category.color) ?? .blue).frame(width: 44, height: 44)
                    .overlay {
                        if let icon = category.icon { CustomSVGIconView(svg: icon.svgCode, size: 24) }
                        else { Image(systemName: "paintpalette").font(.title3).foregroundStyle(.white) }
                    }
                VStack(alignment: .leading, spacing: 2) {
                    Text(category.name).fontWeight(.semibold).lineLimit(2)
                    Text(verbatim: category.color).font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                Spacer()
                Button { editing = CategoryDraft(category) } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj")
                Button(role: .destructive) { removing = category } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń")
            }
            if !category.description.isEmpty {
                Text(category.description).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Text(category.isActive ? "Aktywna" : "Nieaktywna").font(.caption.weight(.medium))
                .foregroundStyle(category.isActive ? CrmTheme.rgb(0x4ade80) : .secondary)
                .padding(.horizontal, 10).padding(.vertical, 3)
                .background((category.isActive ? Color.green.opacity(0.2) : Color.secondary.opacity(0.1)), in: Capsule())
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.12)))
        .contextMenu {
            Button("Edytuj", systemImage: "pencil") { editing = CategoryDraft(category) }
            Button("Usuń", systemImage: "trash", role: .destructive) { removing = category }
        }
    }
}

// MARK: Nowa / edycja kategorii

struct CategoryDraft: Identifiable {
    var id = UUID()
    var categoryID: String?
    var name = ""
    var color = "#3B82F6"
    var description = ""
    var isActive = true
    var iconID = ""
    var contractTemplateID = ""
    var offerTemplateCategoryID = ""

    init() {}
    init(_ category: EventCategoriesData.Category) {
        categoryID = category.id
        name = category.name
        color = category.color
        description = category.description
        isActive = category.isActive
        iconID = category.iconId ?? ""
        contractTemplateID = category.contractTemplateId ?? ""
        offerTemplateCategoryID = category.offerTemplateCategoryId ?? ""
    }
}

@MainActor private struct EventCategoryEditor: View {
    @ObservedObject var model: EventCategoriesModel
    @State var draft: CategoryDraft
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var pickerShown = false

    private var icons: [EventCategoriesData.Icon] { model.data?.icons ?? [] }
    private var selectedIcon: EventCategoriesData.Icon? { icons.first { $0.id == draft.iconID } }
    private var canSave: Bool { !draft.name.trimmingCharacters(in: .whitespaces).isEmpty && EventCategoriesModel.validColor(draft.color) }

    var body: some View {
        VStack(spacing: 0) {
            Text(draft.categoryID == nil ? "Nowa kategoria" : "Edytuj kategorię").font(.title3.bold())
                .frame(maxWidth: .infinity, alignment: .leading).padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                TextField("Nazwa kategorii *", text: $draft.name)
                iconRow
                colorRows
                TextField("Opis", text: $draft.description, axis: .vertical).lineLimit(3...6)
                Picker("Szablon oferty (opcjonalnie)", selection: $draft.offerTemplateCategoryID) {
                    Text("Domyślny szablon").tag("")
                    ForEach(model.data?.offerTemplateCategories ?? []) { Text($0.name).tag($0.id) }
                    if !draft.offerTemplateCategoryID.isEmpty && !(model.data?.offerTemplateCategories ?? []).contains(where: { $0.id == draft.offerTemplateCategoryID }) {
                        Text("Niedostępny szablon").tag(draft.offerTemplateCategoryID)
                    }
                }
                Picker("Szablon umowy (opcjonalnie)", selection: $draft.contractTemplateID) {
                    Text("Brak szablonu").tag("")
                    ForEach(model.data?.contractTemplates ?? []) { Text($0.name).tag($0.id) }
                    if !draft.contractTemplateID.isEmpty && !(model.data?.contractTemplates ?? []).contains(where: { $0.id == draft.contractTemplateID }) {
                        Text("Nieaktywny szablon").tag(draft.contractTemplateID)
                    }
                }
                Toggle("Kategoria aktywna", isOn: $draft.isActive).toggleStyle(.checkbox)
            }
            .formStyle(.grouped)
            HStack {
                if !draft.color.isEmpty && !EventCategoriesModel.validColor(draft.color) {
                    Text("Kolor musi mieć postać #RRGGBB, np. #3B82F6.").font(.caption).foregroundStyle(.red)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(draft.categoryID == nil ? "Utwórz" : "Zapisz") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!canSave || model.saving)
            }
            .padding(16)
        }
        .frame(minWidth: 520, idealWidth: 580, minHeight: 560, idealHeight: 700)
        .background(theme.page)
        .disabled(model.saving)
    }

    private var iconRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Ikona")
                Spacer()
                Button { pickerShown.toggle() } label: {
                    HStack(spacing: 8) {
                        if let icon = selectedIcon {
                            CustomSVGIconView(svg: icon.svgCode, color: CrmTheme.hexString(theme.text), size: 20)
                            Text(icon.name)
                        } else {
                            Image(systemName: "photo")
                            Text("Wybierz ikonę (opcjonalnie)").foregroundStyle(.secondary)
                        }
                        Image(systemName: pickerShown ? "chevron.up" : "chevron.down").font(.caption)
                    }
                }
                if !draft.iconID.isEmpty {
                    Button { draft.iconID = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.borderless).help("Bez ikony")
                }
            }
            if pickerShown {
                if icons.isEmpty {
                    Text("Brak ikon — dodaj je w „Zarządzaj ikonami”.").font(.caption).foregroundStyle(.secondary)
                } else {
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(44), spacing: 8), count: 8), alignment: .leading, spacing: 8) {
                        ForEach(icons) { icon in
                            Button {
                                draft.iconID = icon.id
                                pickerShown = false
                            } label: {
                                CustomSVGIconView(svg: icon.svgCode, color: CrmTheme.hexString(theme.text), size: 22)
                                    .frame(width: 40, height: 40)
                                    .background(draft.iconID == icon.id ? theme.accent.opacity(0.2) : Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(draft.iconID == icon.id ? theme.accent.opacity(0.5) : .clear))
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .help(icon.name)
                        }
                    }
                }
            }
        }
    }

    private var colorRows: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Kolor *")
                Spacer()
                ColorPicker("", selection: Binding(get: { CrmTheme.hex(draft.color) ?? .blue }, set: { draft.color = CrmTheme.hexString($0) }),
                            supportsOpacity: false).labelsHidden()
                TextField("", text: $draft.color, prompt: Text(verbatim: "#3B82F6")).textFieldStyle(.roundedBorder).frame(width: 110)
            }
            HStack(spacing: 6) {
                ForEach(EventCategoriesModel.presetColors, id: \.self) { color in
                    Button { draft.color = color } label: {
                        RoundedRectangle(cornerRadius: 5).fill(CrmTheme.hex(color) ?? .gray).frame(height: 26)
                            .overlay(RoundedRectangle(cornerRadius: 5).stroke(draft.color.caseInsensitiveCompare(color) == .orderedSame ? theme.accent : .clear, lineWidth: 2))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(color)
                }
            }
        }
    }

    private func save() async {
        let form: [String: JSONValue] = [
            "name": .string(draft.name), "color": .string(draft.color), "description": .string(draft.description), "isActive": .bool(draft.isActive),
            "iconId": .string(draft.iconID), "contractTemplateId": .string(draft.contractTemplateID),
            "offerTemplateCategoryId": .string(draft.offerTemplateCategoryID),
        ]
        var body: [String: JSONValue] = ["op": .string("save"), "form": .object(form)]
        if let id = draft.categoryID { body["id"] = .string(id) }
        if await model.post(body, fallback: "Nie udało się zapisać kategorii.") { dismiss() }
    }
}

// MARK: Zarządzanie ikonami

@MainActor private struct CustomIconsSheet: View {
    @ObservedObject var model: EventCategoriesModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var editingID: String?
    @State private var name = ""
    @State private var svgCode = ""
    @State private var previewColor = "#3B82F6"
    @State private var removing: EventCategoriesData.Icon?

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !svgCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && EventCategoriesModel.validColor(previewColor)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Zarządzanie ikonami").font(.title2.bold())
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    form
                    library
                }
                .padding(20)
            }
        }
        .frame(minWidth: 700, idealWidth: 820, minHeight: 600, idealHeight: 760)
        .background(theme.page)
        .disabled(model.saving)
        .confirmationDialog("Czy na pewno chcesz usunąć tę ikonę?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                if let icon = removing {
                    Task {
                        if await model.post(["op": .string("iconDelete"), "id": .string(icon.id)], fallback: "Nie udało się usunąć ikony."), editingID == icon.id { reset() }
                    }
                }
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text("Kategorie z tą ikoną zostaną bez ikony.") }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(editingID == nil ? "Dodaj nową ikonę" : "Edytuj ikonę").font(.headline)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Nazwa ikony *").font(.callout).foregroundStyle(.secondary)
                        TextField("", text: $name, prompt: Text("np. Mikrofon")).textFieldStyle(.roundedBorder)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Kod SVG *").font(.callout).foregroundStyle(.secondary)
                        TextEditor(text: $svgCode)
                            .font(.system(.caption, design: .monospaced))
                            .frame(minHeight: 120)
                            .scrollContentBackground(.hidden)
                            .padding(4)
                            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
                            .overlay(alignment: .topLeading) {
                                if svgCode.isEmpty {
                                    Text(verbatim: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">...</svg>")
                                        .font(.system(.caption, design: .monospaced)).foregroundStyle(.tertiary).padding(9).allowsHitTesting(false)
                                }
                            }
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Podgląd").font(.callout).foregroundStyle(.secondary)
                    RoundedRectangle(cornerRadius: 10).fill(CrmTheme.hex(previewColor) ?? .blue).frame(width: 96, height: 96)
                        .overlay { if !svgCode.isEmpty { CustomSVGIconView(svg: svgCode, size: 48, fallback: "questionmark") } }
                    HStack(spacing: 6) {
                        ColorPicker("", selection: Binding(get: { CrmTheme.hex(previewColor) ?? .blue }, set: { previewColor = CrmTheme.hexString($0) }),
                                    supportsOpacity: false).labelsHidden()
                        TextField("", text: $previewColor, prompt: Text(verbatim: "#3B82F6")).textFieldStyle(.roundedBorder).frame(width: 90)
                    }
                }
            }
            HStack {
                if !previewColor.isEmpty && !EventCategoriesModel.validColor(previewColor) {
                    Text("Kolor podglądu musi mieć postać #RRGGBB, np. #3B82F6.").font(.caption).foregroundStyle(.red)
                }
                Spacer()
                Button("Anuluj") { reset() }
                Button(editingID == nil ? "Dodaj ikonę" : "Zaktualizuj") { Task { await save() } }
                    .buttonStyle(.borderedProminent).disabled(!canSave || model.saving)
            }
        }
        .padding(16)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
    }

    private var library: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dostępne ikony").font(.headline)
            let icons = model.data?.icons ?? []
            if icons.isEmpty {
                Text("Brak ikon").foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 12) {
                    ForEach(icons) { icon in
                        VStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 10).fill(CrmTheme.hex(icon.previewColor) ?? .blue).frame(width: 72, height: 72)
                                .overlay { CustomSVGIconView(svg: icon.svgCode, size: 32, fallback: "questionmark") }
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(editingID == icon.id ? theme.accent : .clear, lineWidth: 2))
                            Text(icon.name).font(.caption).lineLimit(1)
                            HStack(spacing: 10) {
                                Button { edit(icon) } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj")
                                Button(role: .destructive) { removing = icon } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń")
                            }
                        }
                        .contextMenu {
                            Button("Edytuj", systemImage: "pencil") { edit(icon) }
                            Button("Usuń", systemImage: "trash", role: .destructive) { removing = icon }
                        }
                    }
                }
            }
        }
    }

    private func edit(_ icon: EventCategoriesData.Icon) {
        editingID = icon.id
        name = icon.name
        svgCode = icon.svgCode
        previewColor = icon.previewColor.isEmpty ? "#3B82F6" : icon.previewColor
    }

    private func reset() {
        editingID = nil
        name = ""
        svgCode = ""
        previewColor = "#3B82F6"
    }

    private func save() async {
        let form: [String: JSONValue] = ["name": .string(name), "svgCode": .string(svgCode), "previewColor": .string(previewColor)]
        var body: [String: JSONValue] = ["op": .string("iconSave"), "form": .object(form)]
        if let editingID { body["id"] = .string(editingID) }
        if await model.post(body, fallback: "Nie udało się zapisać ikony.") { reset() }
    }
}
