import SwiftUI

// MARK: Edytor broszury (`/crm/brochures/[id]`, `BrochureEditorClient`), część G1 — układ jak w programach do prezentacji:
// spis stron po lewej (z ustawieniami broszury na górze), edycja wybranej strony w środku, podgląd po prawej przewijany do
// wybranej strony. Zmiany zapisują się same; „Generuj PDF” w osobnym oknie z wyborem odbiorcy. Panele i okna —
// `BrochurePageEditors.swift`, `BrochureEditorParts.swift`; strony graficzne (część G2) — `BrochureStudio.swift`.

@MainActor struct BrochureEditorView: View {
    @ObservedObject var store: BrochuresStore
    let id: String
    let close: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @StateObject private var model: BrochureEditorModel
    @State private var management: BrochureManagementRoute?
    @State private var confirmLeave = false
    @State private var removing: BrochureItem?
    @State private var removingPage: String?
    @State private var pdf: OfferPdfPreview?
    @State private var pdfSheet = false
    @State private var catalogSheet = false
    @State private var mailSheet = false
    @State private var issuesShown = false

    init(store: BrochuresStore, id: String, close: @escaping () -> Void) {
        self.store = store
        self.id = id
        self.close = close
        _model = StateObject(wrappedValue: BrochureEditorModel(store: store, id: id))
    }

    private var archived: Bool { model.data?.brochure.status == "archived" }

    var body: some View {
        content
            .navigationTitle(model.draft?.name ?? model.data?.brochure.name ?? "Broszura")
            .navigationSubtitle(subtitle)
            .toolbar { toolbar }
            .task {
                model.background = String(format: "#%06lx", theme.pageRGB)
                model.showPdf = { file in pdf = file }
                if model.data == nil { await model.load() }
            }
            .onChange(of: model.draft) { _, _ in model.draftChanged() }
            .onChange(of: model.selectedPage) { _, _ in model.refreshCanvas(immediate: true) }
            .onDisappear { model.flush() }
            .sheet(item: $management) { route in
                BrochureManagementSheet(store: store, route: route) { record in
                    model.applyRecord(record)
                    if route.action == "remove" { close() }
                    if route.action == "restore" { Task { await model.load() } }
                }
            }
            .sheet(item: $pdf) { file in OfferPdfViewer(file: file) }
            .sheet(isPresented: $pdfSheet) { BrochurePdfSheet(model: model) }
            .sheet(isPresented: $catalogSheet) { BrochureCatalogSheet(model: model) }
            .sheet(isPresented: $mailSheet) { BrochureMailSheet(model: model) }
            .confirmationDialog("Nie udało się zapisać zmian. Opuścić edytor?", isPresented: $confirmLeave, titleVisibility: .visible) {
                Button("Opuść bez zapisywania", role: .destructive) { close() }
                Button("Zostań", role: .cancel) {}
            } message: {
                Text(model.saveBlocked ?? "Ostatnie zmiany nie zostały zapisane na serwerze.")
            }
            .confirmationDialog("Usunąć tę usługę z broszury?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                if let item = removing {
                    Button("Usuń usługę", role: .destructive) { Task { await model.remove(item) } }
                }
                Button("Anuluj", role: .cancel) { removing = nil }
            } message: {
                Text("Strona zniknie z broszury. Usługa w katalogu pozostaje bez zmian.")
            }
            .confirmationDialog("Usunąć tę stronę graficzną?", isPresented: Binding(get: { removingPage != nil }, set: { if !$0 { removingPage = nil } }), titleVisibility: .visible) {
                if let key = removingPage {
                    Button("Usuń stronę", role: .destructive) { model.deletePage(key) }
                }
                Button("Anuluj", role: .cancel) { removingPage = nil }
            } message: {
                Text("Treść i rozmieszczenie tej strony zostaną usunięte z broszury.")
            }
    }

    @ViewBuilder private var content: some View {
        if let data = model.data, model.draft != nil {
            if archived {
                archivedView(data)
            } else {
                // Szerokości paneli zapamiętują się; okno poszerza podgląd.
                PersistentSplitView(id: "brochure-editor", panes: [
                    .init(view: pane(BrochureNavigator(model: model, addService: { catalogSheet = true }, remove: { item in removing = item },
                                                       removePage: { key in removingPage = key })), min: 220, ideal: 270, max: 380),
                    .init(view: pane(BrochurePageEditor(model: model, remove: { item in removing = item }, removePage: { key in removingPage = key })),
                          min: 400, ideal: 520, max: 860),
                    .init(view: pane(BrochurePreviewPane(model: model)), min: 300, ideal: 420),
                ])
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if let error = model.loadError {
            ContentUnavailableView {
                Label("Nie udało się otworzyć broszury", systemImage: "book")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await model.load() } }
                Button("Lista broszur") { close() }
            }
        } else {
            ProgressView("Ładowanie broszury…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func pane<V: View>(_ view: V) -> AnyView {
        AnyView(view
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .environment(\.crmTheme, state.theme)
            .tint(state.theme.accent)
            .scrollContentBackground(.hidden)
            .background(state.theme.page)
            .environmentObject(state))
    }

    /// Stan zapisu i PDF pod tytułem okna.
    private var subtitle: String {
        guard let data = model.data else { return "Broszury" }
        if archived { return "Archiwum" }
        let save: String
        switch model.saveState {
        case .saving: save = "Zapisywanie…"
        case .failed: save = "Nie zapisano — sprawdź połączenie"
        case .pending: save = model.saveBlocked == nil ? "Niezapisane zmiany" : "Zapis wstrzymany"
        case .saved: save = "Zapisano"
        }
        let pdf = data.brochure.pdfVersion == 0 ? "bez PDF" : model.outdatedPdf ? "PDF v\(data.brochure.pdfVersion) wymaga aktualizacji" : "PDF v\(data.brochure.pdfVersion)"
        return "\(save) · \(pdf)"
    }

    private func back() {
        guard model.dirty else { close(); return }
        Task {
            if await model.save(.quiet) { close() } else { confirmLeave = true }
        }
    }

    /// „Wyślij broszurę” — PDF-y powstają z zapisanej treści, więc najpierw zapis bieżących zmian.
    private func openMail() {
        Task {
            if model.dirty {
                let saved = await model.save()
                if !saved { return }
            }
            mailSheet = true
        }
    }

    private func route(_ action: String) {
        guard let brochure = model.data?.brochure else { return }
        management = BrochureManagementRoute(action: action, brochureID: brochure.id, name: model.draft?.name ?? brochure.name,
                                             updatedAt: brochure.updatedAt, unsavedChanges: model.dirty)
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button { back() } label: { Label("Lista broszur", systemImage: "chevron.left") }.help("Wróć do listy broszur")
        }
        if let data = model.data, !archived {
            ToolbarItemGroup(placement: .primaryAction) {
                if model.saveState == .failed {
                    Button { Task { await model.save() } } label: { Label("Zapisz ponownie", systemImage: "exclamationmark.arrow.circlepath") }
                        .help("Ostatni zapis się nie udał — zapisz ponownie")
                }
                if let issues = model.issues, !issues.isEmpty {
                    Button { issuesShown = true } label: {
                        Label("\(issues.count) do poprawy", systemImage: "exclamationmark.triangle.fill").labelStyle(.titleAndIcon)
                    }
                    .foregroundStyle(.orange)
                    .help("Lista problemów ze sprawdzenia broszury")
                    .popover(isPresented: $issuesShown, arrowEdge: .bottom) {
                        BrochureIssuesList(model: model, issues: issues) { issuesShown = false }
                            .frame(width: 420)
                            .frame(maxHeight: 520)
                    }
                }
                Button { Task { await model.generate(validateOnly: true) } } label: { Label("Sprawdź", systemImage: "checkmark.shield") }
                    .help("Sprawdź zdjęcia, czcionki i układ stron bez tworzenia PDF")
                    .disabled(!model.canGenerate || !state.canWrite)
                Button { pdfSheet = true } label: { Label("Generuj PDF", systemImage: "doc.richtext") }
                    .help("Generuj PDF — ogólny albo dla klienta (⇧⌘E)")
                    .keyboardShortcut("e", modifiers: [.command, .shift])
                    .disabled(!model.canGenerate || !state.canWrite)
                if data.canManage && data.canViewResults {
                    Button { openMail() } label: { Label("Wyślij", systemImage: "paperplane") }
                        .help("Wyślij broszurę e-mailem — każdy odbiorca dostaje osobną wiadomość i własny PDF")
                        .disabled(!model.canGenerate || !state.canWrite)
                }
                Menu {
                    Button { Task { await model.save() } } label: { Label("Zapisz teraz", systemImage: "square.and.arrow.down") }
                        .disabled(!model.dirty || !model.canEdit)
                    if let own = data.ownPdf {
                        Button { Task { await model.openOwnPdf() } } label: {
                            Label("Ostatni PDF v\(own.version) — \(own.recipient.isEmpty ? "ogólny" : own.recipient)", systemImage: "doc.richtext")
                        }
                    }
                    Divider()
                    Button { catalogSheet = true } label: { Label("Dodaj usługę…", systemImage: "plus") }
                        .disabled(!model.canEdit)
                    if data.canViewResults {
                        Button { model.selectedPage = "deliveries" } label: { Label("Historia wysyłek", systemImage: "clock.arrow.circlepath") }
                    }
                    Button { Task { await model.createCampaign() } } label: { Label("Utwórz szkic kampanii", systemImage: "megaphone") }
                        .disabled(!data.canManage || !data.canViewResults || model.dirty || !data.brochure.hasPdf || data.brochure.modified || model.busy != nil)
                    if data.canManage {
                        Divider()
                        Button { route("rename") } label: { Label("Zmień nazwę…", systemImage: "pencil") }
                        Button(role: .destructive) { route("remove") } label: { Label("Usuń broszurę…", systemImage: "trash") }
                    }
                } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                    .disabled(model.busy != nil)
                    .help("Więcej czynności")
            }
        }
    }

    // MARK: Archiwum

    private func archivedView(_ data: BrochureEditorData) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(data.brochure.name).font(.title2.weight(.light))
            Text("Ta broszura jest w archiwum. Zapisane wersje PDF i historia wysyłek nie zostały usunięte. Przywróć ją, aby ponownie edytować treść lub generować PDF.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                if data.ownPdf != nil {
                    Button { Task { await model.openOwnPdf() } } label: { Label("Ostatni zapisany PDF", systemImage: "doc.richtext") }
                }
                if data.canManage {
                    Button { route("restore") } label: { Label("Przywróć broszurę", systemImage: "arrow.uturn.backward") }
                        .buttonStyle(.borderedProminent).disabled(!state.canWrite)
                }
            }
        }
        .padding(24)
        .frame(maxWidth: 640, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
