import SwiftUI
import AppKit

// MARK: Karta zapytania — natywny odpowiednik strony `/crm/inquiries/[id]` (`InquiryWorkspaceClient`): treść (bez stopek,
// klauzul i cytatów — z „Pokaż całą wiadomość”), ustalenia, klient, prowadzenie sprzedaży (kontakt podjęty, następne
// działanie, etap z powodem utraty, przekazanie), oferty (nowa oferta otwiera się od razu w aplikacji, kopia, akceptacja
// klienta), kalkulacje (lista i edytor jak w wydarzeniu — `InquiryCalculations.swift`), notatki i historia.
// Serwer: `src/lib/native/inquiryWorkspace.ts` (`/bridge/native/v1/inquiries`).
// Korespondencja, e-mail do klienta, analiza AI, klient i organizacja, zadania, zespół i wydarzenie z zapytania —
// `InquiryWorkspaceTools.swift` (serwer: `src/lib/native/inquiryWorkspaceTools.ts`).

struct InquiryWorkspaceData: Decodable {
    struct Info: Decodable {
        var id: String
        var title: String
        var titleLabel: String
        var sourceLabel: String
        var typeLabels: [String]
        var stage: String
        var ownerId: String?
        var ownerName: String
        var createdAt: String?
        var nextActionAt: String?
        var lastContactAt: String?
        var estimatedValue: Double?
        var probability: Double
        var lostReason: String
        var lostReasonCategory: String
        var linkedOfferId: String?
        var acceptedOfferId: String?
        var eventId: String?
        var contactId: String?
        var organizationId: String?
        var archived: Bool
        var briefRevision: Int
    }
    struct Message: Decodable {
        var full: String
        var clean: String
        var trimmed: Bool
        var sourceHref: String?
    }
    struct Client: Decodable {
        var name: String
        var email: String
        var phone: String
        var contactName: String
        var organizationName: String
    }
    struct Summary: Decodable {
        var schedule: String
        var location: String
        var guests: String
        var guestsHint: String
        var scope: String
        var budget: String
    }
    struct Question: Codable, Hashable {
        var question: String
        var answer: String
        var status: String
    }
    struct Brief: Codable, Equatable {
        var termin: String
        var eventSingleDay: Bool
        var eventEndDate: String
        var eventStartTime: String
        var eventEndTime: String
        var eventEndNextDay: Bool
        var locationText: String
        var locationId: String
        var guestCount: String
        var guestCountText: String
        var scope: String
        var budgetMin: String
        var budgetMax: String
        var budgetText: String
        var conversationNotes: String
        var eventGoal: String
        var questions: [Question]
    }
    struct Package: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var priceNet: Double
    }
    struct Offer: Decodable, Identifiable {
        var id: String
        var number: String
        var title: String
        var status: String
        var statusLabel: String
        var total: Double?
        var guestCount: Double?
        var eventId: String?
        var packageMode: Bool
        var packages: [Package]
        var acceptedPackageId: String?
        var createdAt: String?
        var validUntil: String?
    }
    struct Calculation: Decodable, Identifiable {
        var id: String
        var name: String
        var createdAt: String?
        var accepted: Bool
        var total: Double
        var itemsCount: Int?
        /// Zapisany PDF (`generated_pdf_path`).
        var pdf: Bool?
        /// Wybrana kalkulacja zapytania (`accepted_calculation_id`).
        var selected: Bool?
    }
    struct Activity: Decodable, Identifiable {
        var id: String
        var kind: String
        var kindLabel: String
        var body: String
        var at: String?
    }
    struct StageChange: Decodable, Identifiable {
        var id: String
        var from: String
        var to: String
        var reason: String
        var at: String?
        var by: String
    }
    struct Permissions: Decodable {
        var canLead: Bool
        var canManage: Bool
        var canAssign: Bool
    }
    struct Stage: Decodable, Identifiable {
        var id: String
        var label: String
        var probability: Double
    }
    struct LostCategory: Decodable, Identifiable {
        var value: String
        var label: String
        var id: String { value }
    }
    var inquiry: Info
    var message: Message
    var client: Client
    var summary: Summary
    var brief: Brief
    var offers: [Offer]
    var calculations: [Calculation]
    var activity: [Activity]
    var stageHistory: [StageChange]
    var teamCount: Int
    var permissions: Permissions
    var stages: [Stage]
    var lostCategories: [LostCategory]

    var notes: [Activity] { activity.filter { ["note", "call_note", "contact"].contains($0.kind) } }
}

extension InquiriesStore {
    func workspaceData(_ id: String) async throws -> InquiryWorkspaceData {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(InquiryWorkspaceData.self, from: try await api.get("/inquiries", query: ["op": "workspace", "id": id]))
    }

    /// Czynność karty zapytania z oknem postępu i komunikatem; odpowiedź serwera albo `nil` (błąd w oknie).
    @discardableResult
    func workspaceRun(_ op: String, _ id: String, _ extra: [String: JSONValue] = [:], pending: String, success: String?) async -> [String: JSONValue]? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = "Zmiany wymagają połączenia z serwerem CRM."
            return nil
        }
        var body = extra
        body["op"] = .string(op)
        body["id"] = .string(id)
        do {
            let data = try await workspace.withPending(pending) { try await api.post("/inquiries", body) }
            if let success { workspace.succeed(success) }
            Task { await sync(force: true) }
            return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian w zapytaniu.")
            return nil
        }
    }

    func handoffCandidates(_ id: String) async throws -> [MeetingPerson] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let candidates: [MeetingPerson] }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/inquiries", query: ["op": "handoffCandidates", "id": id])).candidates
    }
}

private enum InquiryWorkspaceTab: String, CaseIterable, Identifiable {
    case overview, correspondence, analysis, offers, calculations, tasks, notes, team, history
    var id: String { rawValue }
    var label: String {
        switch self {
        case .overview: return "Podsumowanie"
        case .correspondence: return "Korespondencja"
        case .analysis: return "Analiza i AI"
        case .offers: return "Oferty"
        case .calculations: return "Kalkulacje"
        case .tasks: return "Zadania"
        case .notes: return "Notatki"
        case .team: return "Zespół"
        case .history: return "Historia"
        }
    }
}

private enum InquiryWorkspaceSheet: Identifiable {
    case stage, handoff, accept(InquiryWorkspaceData.Offer), reopen, schedule, email, client, convert
    var id: String {
        switch self {
        case .stage: return "stage"
        case .handoff: return "handoff"
        case .accept(let offer): return "accept-\(offer.id)"
        case .reopen: return "reopen"
        case .schedule: return "schedule"
        case .email: return "email"
        case .client: return "client"
        case .convert: return "convert"
        }
    }
}

/// Czynność wstrzymana do czasu powiązania klienta (oferta i wydarzenie wymagają klienta — jak `ensureContact` w CRM).
private enum InquiryAfterClient { case offer, convert }

@MainActor struct InquiryWorkspaceView: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    let close: () -> Void
    let editSales: (Inquiry) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: InquiryWorkspaceData?
    @State private var loadError: String?
    @State private var tab: InquiryWorkspaceTab = .overview
    @State private var editingTitle = false
    @State private var titleDraft = ""
    @State private var brief: InquiryWorkspaceData.Brief?
    @State private var fullMessage = false
    @State private var sheet: InquiryWorkspaceSheet?
    @State private var noteKind = "note"
    @State private var noteBody = ""
    @State private var noteRequest = UUID().uuidString.lowercased()
    @State private var afterClient: InquiryAfterClient?
    @State private var tabRefresh = 0
    /// Kalkulacja otwarta w edytorze (`activeCalculationId` w CRM) — edytor zastępuje kartę, kontekst zapytania po lewej.
    @State private var openCalculation: String?

    var body: some View {
        VStack(spacing: 0) {
            if let data, let calculation = openCalculation {
                calculationEditor(data, calculation)
            } else if let data {
                header(data)
                Divider()
                tabs(data)
                Divider()
                ScrollView { content(data).padding(18).frame(maxWidth: .infinity, alignment: .leading) }
            } else if let loadError {
                backBar
                ContentUnavailableView {
                    Label("Nie udało się otworzyć zapytania", systemImage: "tray")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                backBar
                ProgressView("Wczytywanie zapytania…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.page)
        .task(id: inquiryID) { await load() }
        .onChange(of: inquiryID) { _, _ in openCalculation = nil }
        .sheet(item: $sheet) { item in sheetView(item) }
    }

    /// Edytor kalkulacji zapytania (`CalculationEditor` z `inquiryContext`) z kontekstem zapytania po lewej.
    private func calculationEditor(_ data: InquiryWorkspaceData, _ calculationID: String) -> some View {
        HStack(spacing: 0) {
            ScrollView {
                InquiryCalculationContextPanel(data: data).padding(14)
            }
            .frame(width: 330)
            Divider()
            CalculationEditorView(backend: .inquiry(store, inquiryID, eventID: data.inquiry.eventId), calculationID: calculationID,
                                  onBack: {
                                      openCalculation = nil
                                      Task { await load() }
                                  },
                                  readOnly: !data.permissions.canManage)
                .id(calculationID)
        }
    }

    private var backBar: some View {
        HStack {
            Button(action: close) { Label("Lejek zapytań", systemImage: "chevron.left") }.buttonStyle(.borderless)
            Spacer()
        }
        .controlSize(.small).padding(.horizontal, 14).padding(.vertical, 8)
    }

    private func load() async {
        do {
            let next = try await store.workspaceData(inquiryID)
            data = next
            if !editingTitle { titleDraft = next.inquiry.title }
            loadError = nil
        } catch {
            if data == nil { loadError = store.failureText(error, "Nie udało się wczytać zapytania.") }
        }
    }

    private func run(_ op: String, _ extra: [String: JSONValue] = [:], pending: String, success: String?) async -> [String: JSONValue]? {
        let reply = await store.workspaceRun(op, inquiryID, extra, pending: pending, success: success)
        if reply != nil { await load() }
        return reply
    }

    // MARK: Nagłówek
    private func header(_ data: InquiryWorkspaceData) -> some View {
        let info = data.inquiry
        let stage = InquiryStage(raw: info.stage)
        return VStack(alignment: .leading, spacing: 8) {
            Button(action: close) { Label("Lejek zapytań", systemImage: "chevron.left") }.buttonStyle(.borderless).controlSize(.small)
            HStack(alignment: .center, spacing: 10) {
                if editingTitle {
                    TextField("Tytuł zapytania", text: $titleDraft).textFieldStyle(.roundedBorder).font(.title3).frame(maxWidth: 520)
                        .onSubmit { Task { await saveTitle(data) } }
                    Button("Zapisz") { Task { await saveTitle(data) } }.buttonStyle(.borderedProminent)
                        .disabled(titleDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Anuluj") { editingTitle = false; titleDraft = info.title }
                } else {
                    Text(info.titleLabel).font(.title2.weight(.semibold)).textSelection(.enabled).lineLimit(2)
                    if data.permissions.canManage {
                        Button { titleDraft = info.title; editingTitle = true } label: { Image(systemName: "pencil") }
                            .buttonStyle(.borderless).help("Edytuj tytuł")
                    }
                }
                Label(stage.label, systemImage: "circle.fill").font(.caption.weight(.medium)).labelStyle(.titleAndIcon)
                    .foregroundStyle(stage.color).padding(.horizontal, 8).padding(.vertical, 3)
                    .background(stage.color.opacity(0.12), in: Capsule())
                Spacer(minLength: 8)
                actions(data)
            }
            HStack(spacing: 6) {
                Text("\(info.sourceLabel) · zapytanie #\(String(info.id.prefix(8)))\(info.createdAt.flatMap(MeetingDates.parse).map { " · utworzone \(InquiryFormat.full($0))" } ?? "")")
                ForEach(info.typeLabels, id: \.self) { label in
                    Text(label).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1).background(Color.primary.opacity(0.07), in: Capsule())
                }
                if info.archived { Text("Zarchiwizowane").font(.caption2).foregroundStyle(.orange) }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    @ViewBuilder private func actions(_ data: InquiryWorkspaceData) -> some View {
        let info = data.inquiry
        HStack(spacing: 6) {
            if data.permissions.canLead && preparesRealization(data) {
                Button { startConvert(data) } label: { Label("Przygotuj realizację", systemImage: "briefcase") }
                    .buttonStyle(.borderedProminent)
            }
            if data.permissions.canManage {
                Button { Task { await createOffer() } } label: { Label("Oferta", systemImage: "doc.text") }
                    .buttonStyle(.borderedProminent)
                    .help(info.contactId == nil && info.organizationId == nil ? "Najpierw powiążesz klienta — oferta go wymaga" : "Nowa oferta z ustaleń zapytania")
                Button { Task { await createCalculation() } } label: { Label("Kalkulacja", systemImage: "function") }
                Button { sheet = .email } label: { Label("E-mail", systemImage: "envelope") }
                    .disabled(data.client.email.isEmpty).help(data.client.email.isEmpty ? "Brak adresu e-mail klienta" : "Napisz do klienta ze skrzynki firmy")
            }
            if data.permissions.canLead {
                Button { sheet = .stage } label: { Label("Etap…", systemImage: "arrow.left.arrow.right") }
            }
            Menu {
                if data.permissions.canManage {
                    Button("Klient i organizacja…", systemImage: "person.crop.circle.badge.plus") { afterClient = nil; sheet = .client }
                    Button("Nowe zadanie", systemImage: "checklist") { tab = .tasks }
                }
                if data.permissions.canLead && info.eventId == nil && info.acceptedOfferId == nil {
                    Button("Utwórz wydarzenie…", systemImage: "sparkles") { startConvert(data) }
                }
                if data.permissions.canLead, info.ownerId != nil, !["won", "lost"].contains(info.stage) {
                    Button("Przekaż / oddaj…", systemImage: "arrowshape.turn.up.right") { sheet = .handoff }
                }
                if data.permissions.canLead, let inquiry = store.inquiry(inquiryID) {
                    Button("Opiekun, wartość i termin działania…", systemImage: "slider.horizontal.3") { editSales(inquiry) }
                }
                if data.permissions.canLead, info.acceptedOfferId != nil {
                    Button("Otwórz negocjacje ponownie…", systemImage: "arrow.uturn.backward") { sheet = .reopen }
                }
                if let event = info.eventId { Button("Otwórz wydarzenie", systemImage: "sparkles") { state.showEvent(event) } }
                if data.permissions.canManage { Button("Analiza i rozmowa z AI", systemImage: "wand.and.stars") { tab = .analysis } }
                Divider()
                Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/inquiries/\(inquiryID)") }
                Button("Odśwież", systemImage: "arrow.clockwise") { Task { await load() } }
            } label: { Label("Więcej", systemImage: "ellipsis.circle") }
                .menuStyle(.borderlessButton).fixedSize()
        }
        .controlSize(.regular)
    }

    private func tabs(_ data: InquiryWorkspaceData) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Picker("", selection: $tab) {
                ForEach(InquiryWorkspaceTab.allCases) { item in
                    Text(tabLabel(item, data)).tag(item)
                }
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            .padding(.horizontal, 18).padding(.vertical, 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func tabLabel(_ item: InquiryWorkspaceTab, _ data: InquiryWorkspaceData) -> String {
        switch item {
        case .offers: return "Oferty (\(data.offers.count))"
        case .calculations: return "Kalkulacje (\(data.calculations.count))"
        case .notes: return "Notatki (\(data.notes.count))"
        case .history: return "Historia (\(data.activity.count + data.stageHistory.count))"
        case .team: return data.teamCount > 0 ? "Zespół (\(data.teamCount + 1))" : item.label
        case .overview, .correspondence, .analysis, .tasks: return item.label
        }
    }

    @ViewBuilder private func content(_ data: InquiryWorkspaceData) -> some View {
        switch tab {
        case .overview: overview(data)
        case .offers: offers(data)
        case .calculations: calculations(data)
        case .notes: notes(data)
        case .history: history(data)
        case .correspondence:
            InquiryCorrespondenceTab(store: store, inquiryID: inquiryID, canManage: data.permissions.canManage, canCompose: !data.client.email.isEmpty,
                                     openAnalysis: { tab = .analysis }, compose: { sheet = .email })
                .id("correspondence-\(tabRefresh)")
        case .analysis:
            InquiryAnalysisTab(store: store, inquiryID: inquiryID).id("analysis-\(tabRefresh)")
        case .tasks:
            InquiryTasksTab(store: store, inquiryID: inquiryID).id("tasks-\(tabRefresh)")
        case .team:
            InquiryTeamTab(store: store, inquiryID: inquiryID).id("team-\(tabRefresh)")
        }
    }

    // MARK: Podsumowanie
    private func overview(_ data: InquiryWorkspaceData) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 16) {
                card("Treść i potrzeby klienta") { messageView(data) }
                card("Ustalenia") { briefView(data) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 16) {
                card("Klient") { clientView(data) }
                card("Prowadzenie sprzedaży") { salesView(data) }
            }
            .frame(width: 330)
        }
    }

    private func messageView(_ data: InquiryWorkspaceData) -> some View {
        let message = data.message
        let shown = fullMessage || !message.trimmed ? message.full : message.clean
        return VStack(alignment: .leading, spacing: 8) {
            Text(shown.isEmpty ? "Brak treści zapytania." : shown).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(shown.isEmpty ? .secondary : .primary)
            HStack(spacing: 12) {
                if message.trimmed {
                    Button(fullMessage ? "Pokaż tylko treść" : "Pokaż całą wiadomość") { fullMessage.toggle() }
                        .help("Stopki, klauzule poufności i cytowane wcześniejsze wiadomości")
                }
                if let source = message.sourceHref { Button("Wiadomość źródłowa w CRM") { state.openCRM(source) } }
            }
            .buttonStyle(.link).font(.caption)
        }
    }

    @ViewBuilder private func briefView(_ data: InquiryWorkspaceData) -> some View {
        if let draft = Binding($brief) {
            InquiryBriefForm(brief: draft)
            HStack {
                Spacer()
                Button("Anuluj") { brief = nil }
                Button("Zapisz ustalenia") { Task { await saveBrief(data) } }.buttonStyle(.borderedProminent)
            }
        } else {
            let summary = data.summary
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                summaryRow("Termin", summary.schedule)
                summaryRow("Miejsce", summary.location)
                summaryRow("Liczba osób", summary.guests.isEmpty ? "Nie ustalono" : summary.guests)
                summaryRow("Zakres", summary.scope)
                summaryRow("Budżet / wartość", summary.budget)
            }
            if !summary.guestsHint.isEmpty { Text(summary.guestsHint).font(.caption).foregroundStyle(.orange) }
            if data.permissions.canManage {
                InquiryGuestsReader(store: store, inquiryID: inquiryID) { count in await useGuests(count, data) }
            }
            if !data.brief.conversationNotes.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Notatka z rozmowy").font(.caption).foregroundStyle(.secondary)
                    Text(data.brief.conversationNotes).textSelection(.enabled)
                }
            }
            if !data.brief.questions.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Pytania do klienta").font(.caption).foregroundStyle(.secondary)
                    ForEach(data.brief.questions, id: \.self) { question in
                        Label {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(question.question)
                                if !question.answer.isEmpty { Text(question.answer).font(.caption).foregroundStyle(.secondary) }
                            }
                        } icon: { Image(systemName: question.status == "answered" ? "checkmark.circle.fill" : "questionmark.circle").foregroundStyle(question.status == "answered" ? .green : .secondary) }
                    }
                }
            }
            if data.permissions.canManage {
                Button("Uzupełnij / edytuj ustalenia") { brief = data.brief }.buttonStyle(.link)
            }
        }
    }

    @ViewBuilder private func summaryRow(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary).gridColumnAlignment(.leading)
            Text(value.isEmpty ? "—" : value).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func clientView(_ data: InquiryWorkspaceData) -> some View {
        let client = data.client
        let info = data.inquiry
        return VStack(alignment: .leading, spacing: 8) {
            Label(client.name, systemImage: "person.crop.circle").font(.callout.weight(.medium)).textSelection(.enabled)
            if !client.organizationName.isEmpty { Label(client.organizationName, systemImage: "building.2").font(.callout) }
            if !client.email.isEmpty {
                HStack {
                    Text(client.email).textSelection(.enabled).lineLimit(1)
                    Spacer()
                    if data.permissions.canManage {
                        Button("Napisz", systemImage: "envelope") { sheet = .email }.controlSize(.small)
                            .help("Wiadomość ze skrzynki firmy — trafi do korespondencji zapytania")
                    } else {
                        Button("Napisz", systemImage: "envelope") { open("mailto", client.email, subject: "Zapytanie: \(info.titleLabel)") }.controlSize(.small)
                    }
                }
            }
            if !client.phone.isEmpty {
                HStack {
                    Text(client.phone).textSelection(.enabled)
                    Spacer()
                    Button("Zadzwoń", systemImage: "phone") { open("tel", client.phone) }.controlSize(.small)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                if let contact = info.contactId { Button("Karta klienta 360°", systemImage: "person.text.rectangle") { state.showContact(contact) } }
                if let organization = info.organizationId { Button("Otwórz organizację", systemImage: "building.2") { state.showContact(organization) } }
                if data.permissions.canManage {
                    Button(info.contactId == nil ? "Dodaj lub powiąż klienta…" : "Zmień klienta lub organizację…", systemImage: "person.badge.plus") {
                        afterClient = nil
                        sheet = .client
                    }
                }
            }
            .buttonStyle(.link).font(.callout)
        }
    }

    private func salesView(_ data: InquiryWorkspaceData) -> some View {
        let info = data.inquiry
        let next = info.nextActionAt.flatMap(MeetingDates.parse)
        let last = info.lastContactAt.flatMap(MeetingDates.parse)
        let overdue = next.map { $0 < Date() } ?? false
        let open = !["won", "lost"].contains(info.stage)
        return VStack(alignment: .leading, spacing: 10) {
            row("Opiekun", info.ownerName.isEmpty ? "Nieprzypisane" : info.ownerName)
            VStack(alignment: .leading, spacing: 6) {
                Label(last == nil ? "Kontakt jeszcze niepodjęty" : "Kontakt podjęty", systemImage: last == nil ? "phone" : "checkmark.circle.fill")
                    .foregroundStyle(last == nil ? Color.secondary : Color.green)
                if let last { Text("Ostatni kontakt: \(InquiryFormat.full(last))").font(.caption).foregroundStyle(.secondary) }
                if data.permissions.canManage && open {
                    Menu {
                        Button("Następny kontakt jutro o 9:00") { Task { await contactDone(nextDays: 1) } }
                        Button("Następny kontakt za 3 dni") { Task { await contactDone(nextDays: 3) } }
                        Button("Następny kontakt za tydzień") { Task { await contactDone(nextDays: 7) } }
                        Button("Wybierz termin…") { sheet = .schedule }
                        Divider()
                        Button("Bez kolejnego terminu") { Task { await contactDone(next: nil) } }
                    } label: {
                        Label(last == nil ? "Kontakt podjęty — zaplanuj dalej" : "Odnotuj kontakt — zaplanuj dalej", systemImage: "checkmark.bubble")
                    }
                    .fixedSize()
                }
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            HStack {
                Text("Następne działanie").foregroundStyle(.secondary)
                Spacer()
                Text(next.map(InquiryFormat.full) ?? (open ? "Brak — zaplanuj" : "—"))
                    .foregroundStyle(overdue ? Color.red : (next == nil && open ? Color.orange : Color.primary))
            }
            row("Prawdopodobieństwo", "\(Int(info.probability))%")
            row("Szacowana wartość", info.estimatedValue.map(InquiryFormat.money) ?? "—")
            if info.stage == "lost" {
                row("Powód utraty", [data.lostCategories.first { $0.value == info.lostReasonCategory }?.label ?? "", info.lostReason].filter { !$0.isEmpty }.joined(separator: " — "))
            }
            if data.permissions.canLead, info.ownerId != nil, open {
                Button("Przekaż / oddaj zapytanie…") { sheet = .handoff }.buttonStyle(.link)
            }
        }
    }

    // MARK: Oferty, kalkulacje
    private func offers(_ data: InquiryWorkspaceData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Każda oferta ma własny zakres i wycenę. Możesz skopiować wariant i zmienić jego treść. Akceptacja zapisuje wybór klienta.")
                    .font(.callout).foregroundStyle(.secondary)
                Spacer()
                if data.permissions.canManage { Button { Task { await createOffer() } } label: { Label("Nowa oferta", systemImage: "plus") }.buttonStyle(.borderedProminent) }
            }
            if data.offers.isEmpty { Text("Brak ofert dla tego zapytania.").foregroundStyle(.secondary) }
            ForEach(data.offers) { offer in offerRow(offer, data) }
            if data.inquiry.acceptedOfferId != nil {
                Text("Aby zmienić zaakceptowaną ofertę, najpierw otwórz negocjacje ponownie, podając powód (Więcej → Otwórz negocjacje ponownie).")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func offerRow(_ offer: InquiryWorkspaceData.Offer, _ data: InquiryWorkspaceData) -> some View {
        let selected = data.inquiry.acceptedOfferId == offer.id
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Button { state.open(.offers, id: offer.id) } label: { Text("\(offer.number) — \(offer.title)").font(.callout.weight(.medium)) }
                    .buttonStyle(.link)
                HStack(spacing: 8) {
                    Text(offer.statusLabel).font(.caption).padding(.horizontal, 6).padding(.vertical, 1).background(Color.primary.opacity(0.07), in: Capsule())
                    if let total = offer.total, total > 0 { Text(InquiryFormat.money(total)).font(.caption) }
                    if let guests = offer.guestCount { Text("\(Int(guests)) osób").font(.caption).foregroundStyle(.secondary) }
                    if selected { Label("Wybrana przez klienta", systemImage: "checkmark.seal.fill").font(.caption).foregroundStyle(.green) }
                }
                if offer.packageMode, !offer.packages.isEmpty {
                    Text(offer.packages.filter { offer.acceptedPackageId == nil || $0.id == offer.acceptedPackageId }
                        .map { "\($0.name): \(InquiryFormat.money($0.priceNet)) netto" }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if data.permissions.canManage {
                Menu {
                    Button("Otwórz", systemImage: "doc.text") { state.open(.offers, id: offer.id) }
                    Button("Duplikuj", systemImage: "plus.square.on.square") {
                        Task { _ = await run("workspaceDuplicate", ["offerId": .string(offer.id)], pending: "Kopiowanie oferty…", success: "Utworzono kopię oferty") }
                    }
                    if offer.eventId == nil && !selected {
                        Button("Zapisz akceptację klienta…", systemImage: "checkmark.circle") { sheet = .accept(offer) }
                            .disabled(data.inquiry.acceptedOfferId != nil)
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                    .menuStyle(.borderlessButton).fixedSize()
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func calculations(_ data: InquiryWorkspaceData) -> some View {
        InquiryCalculationsList(backend: .inquiry(store, inquiryID, eventID: data.inquiry.eventId), calculations: data.calculations,
                                canManage: data.permissions.canManage,
                                onCreate: { Task { await createCalculation() } },
                                onOpen: { openCalculation = $0 },
                                onChanged: { Task { await load() } })
    }

    // MARK: Notatki, historia
    private func notes(_ data: InquiryWorkspaceData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if data.permissions.canLead {
                VStack(alignment: .leading, spacing: 8) {
                    Picker("Rodzaj wpisu", selection: $noteKind) {
                        Text("Notatka").tag("note")
                        Text("Rozmowa telefoniczna").tag("call_note")
                        Text("Kontakt z klientem").tag("contact")
                    }
                    .pickerStyle(.segmented).fixedSize()
                    TextEditor(text: $noteBody).font(.body).frame(minHeight: 90)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
                    HStack {
                        if !data.client.phone.isEmpty { Button("Zadzwoń: \(data.client.phone)", systemImage: "phone") { open("tel", data.client.phone) } }
                        Spacer()
                        Button("Dodaj wpis") { Task { await addNote() } }.buttonStyle(.borderedProminent)
                            .disabled(noteBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
            if data.notes.isEmpty { Text("Brak notatek do tego zapytania.").foregroundStyle(.secondary) }
            ForEach(data.notes) { note in entry(note.kindLabel, note.body, note.at) }
        }
    }

    private func history(_ data: InquiryWorkspaceData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !data.stageHistory.isEmpty {
                Text("Etapy").font(.headline)
                ForEach(data.stageHistory) { change in
                    entry("\(change.from) → \(change.to)\(change.by.isEmpty ? "" : " · \(change.by)")", change.reason, change.at)
                }
            }
            Text("Aktywność").font(.headline).padding(.top, 6)
            if data.activity.isEmpty { Text("Brak wpisów.").foregroundStyle(.secondary) }
            ForEach(data.activity) { item in entry(item.kindLabel, item.body, item.at) }
        }
    }

    private func entry(_ title: String, _ body: String, _ at: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(title)\(at.flatMap(MeetingDates.parse).map { " · \(InquiryFormat.full($0))" } ?? "")").font(.caption).foregroundStyle(.secondary)
            if !body.isEmpty { Text(body).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Elementy
    private func card<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content()
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.12)))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack { Text(label).foregroundStyle(.secondary); Spacer(); Text(value).multilineTextAlignment(.trailing) }
    }

    private func open(_ scheme: String, _ value: String, subject: String? = nil) {
        var parts = URLComponents()
        parts.scheme = scheme
        parts.path = scheme == "tel" ? value.filter { $0.isNumber || $0 == "+" } : value
        if let subject { parts.queryItems = [URLQueryItem(name: "subject", value: subject)] }
        if let url = parts.url { NSWorkspace.shared.open(url) }
    }

    // MARK: Czynności
    private func saveTitle(_ data: InquiryWorkspaceData) async {
        let title = titleDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        let expected: JSONValue = data.inquiry.title.isEmpty ? .null : .string(data.inquiry.title)
        if await run("workspaceTitle", ["title": .string(title), "expected": expected], pending: "Zapisywanie nazwy…", success: "Nazwa zapytania została zapisana") != nil {
            editingTitle = false
        }
    }

    private func saveBrief(_ data: InquiryWorkspaceData) async {
        guard let brief, let encoded = try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(brief)) else { return }
        if await run("workspaceBrief", ["brief": encoded, "revision": .number(Double(data.inquiry.briefRevision))],
                     pending: "Zapisywanie ustaleń…", success: "Ustalenia i notatka zostały zapisane") != nil {
            self.brief = nil
        }
    }

    private func contactDone(nextDays: Int) async {
        let calendar = MeetingDates.calendar
        let day = calendar.date(byAdding: .day, value: nextDays, to: calendar.startOfDay(for: Date())) ?? Date()
        await contactDone(next: calendar.date(bySettingHour: 9, minute: 0, second: 0, of: day))
    }

    private func contactDone(next: Date?) async {
        _ = await run("contact", ["nextActionAt": next.map { JSONValue.string(MeetingDates.iso($0)) } ?? .null],
                      pending: "Zapisywanie kontaktu…", success: next.map { "Kontakt odnotowany — następny: \(InquiryFormat.full($0))" } ?? "Kontakt odnotowany")
    }

    private func addNote() async {
        let body = noteBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        if await run("workspaceNote", ["body": .string(body), "kind": .string(noteKind), "requestId": .string(noteRequest)],
                     pending: "Zapisywanie notatki…", success: "Notatka została zapisana") != nil {
            noteBody = ""
            noteRequest = UUID().uuidString.lowercased()
        }
    }

    private func createOffer() async {
        guard let data else { return }
        if data.inquiry.contactId == nil && data.inquiry.organizationId == nil {
            // Jak w CRM: najpierw okno klienta, po zapisaniu od razu powstaje oferta.
            afterClient = .offer
            sheet = .client
            return
        }
        let reply = await run("workspaceOffer", ["offerId": .string(UUID().uuidString.lowercased())], pending: "Tworzenie oferty…", success: "Szkic oferty został utworzony")
        if let offer = reply?["offerId"]?.text.nonEmpty { state.open(.offers, id: offer) }
    }

    /// Nowa kalkulacja otwiera się od razu w edytorze (jak `setActiveCalculationId` w CRM).
    private func createCalculation() async {
        guard let reply = await run("workspaceCalculation", pending: "Tworzenie kalkulacji…", success: "Kalkulacja została utworzona") else { return }
        tab = .calculations
        if let created = reply["calculationId"]?.text.nonEmpty { openCalculation = created }
    }

    /// „Przygotuj realizację” — zaakceptowana oferta, bez wydarzenia i bez wcześniejszego przekazania (jak w CRM).
    private func preparesRealization(_ data: InquiryWorkspaceData) -> Bool {
        data.inquiry.acceptedOfferId != nil && data.inquiry.eventId == nil && !data.activity.contains { $0.kind == "handoff" }
    }

    private func startConvert(_ data: InquiryWorkspaceData) {
        if data.inquiry.contactId == nil && data.inquiry.organizationId == nil {
            afterClient = .convert
            sheet = .client
        } else {
            sheet = .convert
        }
    }

    /// Liczba osób odczytana z korespondencji → ustalenia zapytania (`save_inquiry_brief`).
    private func useGuests(_ count: Int, _ data: InquiryWorkspaceData) async -> Bool {
        var next = data.brief
        next.guestCount = String(count)
        guard let encoded = try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(next)) else { return false }
        return await run("workspaceBrief", ["brief": encoded, "revision": .number(Double(data.inquiry.briefRevision))],
                         pending: "Zapisywanie liczby osób…", success: "Liczba osób została zapisana w zapytaniu") != nil
    }

    private func clientSaved() async {
        await load()
        tabRefresh += 1
        let next = afterClient
        afterClient = nil
        guard let next else { return }
        // Po zamknięciu okna klienta kontynuujemy przerwaną czynność.
        try? await Task.sleep(nanoseconds: 400_000_000)
        switch next {
        case .offer: await createOffer()
        case .convert: sheet = .convert
        }
    }

    @ViewBuilder private func sheetView(_ item: InquiryWorkspaceSheet) -> some View {
        if let data {
            switch item {
            case .stage:
                InquiryStageSheet(data: data) { stage, category, reason in
                    await run("workspaceStage", ["stage": .string(stage), "expected": .string(data.inquiry.stage), "category": .string(category), "reason": .string(reason)],
                              pending: "Zmiana etapu…", success: "Etap zapytania został zmieniony") != nil
                }
            case .handoff:
                InquiryHandoffSheet(store: store, inquiryID: inquiryID, title: data.inquiry.titleLabel) { owner in
                    await run("workspaceHandoff", ["ownerId": owner.map { .string($0) } ?? .null], pending: "Zmiana opiekuna…",
                              success: owner == nil ? "Zapytanie wróciło do wspólnej puli" : "Zapytanie przekazano nowemu opiekunowi") != nil
                }
            case .accept(let offer):
                InquiryAcceptOfferSheet(offer: offer) { packageID, note in
                    await run("workspaceAccept", ["offerId": .string(offer.id), "note": .string(note), "packageId": packageID.map { .string($0) } ?? .null],
                              pending: "Zapisywanie akceptacji…", success: "Zapisano akceptację klienta") != nil
                }
            case .reopen:
                InquiryReasonSheet(title: "Otwórz negocjacje ponownie", prompt: "Powód ponownego otwarcia negocjacji", action: "Otwórz negocjacje") { reason in
                    await run("workspaceReopen", ["reason": .string(reason)], pending: "Otwieranie negocjacji…", success: "Negocjacje otwarte ponownie") != nil
                }
            case .schedule:
                InquiryScheduleSheet { date in
                    await contactDone(next: date)
                    return true
                }
            case .email:
                InquiryEmailSheet(store: store, inquiryID: inquiryID) {
                    await load()
                    tabRefresh += 1
                }
            case .client:
                InquiryClientSheet(store: store, inquiryID: inquiryID) {
                    Task { await clientSaved() }
                }
            case .convert:
                InquiryConvertSheet(store: store, inquiryID: inquiryID) { eventID in
                    Task { await load() }
                    state.showEvent(eventID)
                }
            }
        }
    }
}

// MARK: Formularz ustaleń (jak `InquiryContextEditor` + notatka z rozmowy)

private struct InquiryBriefForm: View {
    @Binding var brief: InquiryWorkspaceData.Brief

    private static let dayFormat: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = MeetingDates.zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private func day(_ keyPath: WritableKeyPath<InquiryWorkspaceData.Brief, String>) -> Binding<Date> {
        Binding(get: { Self.dayFormat.date(from: String(brief[keyPath: keyPath].prefix(10))) ?? Date() },
                set: { brief[keyPath: keyPath] = Self.dayFormat.string(from: $0) })
    }

    var body: some View {
        Form {
            Section("Termin") {
                Toggle("Termin ustalony", isOn: Binding(get: { !brief.termin.isEmpty }, set: { brief.termin = $0 ? Self.dayFormat.string(from: Date()) : "" }))
                if !brief.termin.isEmpty {
                    DatePicker("Data", selection: day(\.termin), displayedComponents: .date)
                    Toggle("Jednodniowe", isOn: $brief.eventSingleDay)
                    if !brief.eventSingleDay { DatePicker("Do dnia", selection: day(\.eventEndDate), displayedComponents: .date) }
                    MeetingTextField("Od godziny", text: $brief.eventStartTime, prompt: "np. 18:00")
                    MeetingTextField("Do godziny", text: $brief.eventEndTime, prompt: "np. 23:30")
                    if brief.eventSingleDay && !brief.eventEndTime.isEmpty { Toggle("Kończy się następnego dnia", isOn: $brief.eventEndNextDay) }
                }
            }
            Section("Wydarzenie") {
                MeetingTextField("Miejsce", text: $brief.locationText, prompt: "Nazwa obiektu, miasto")
                MeetingTextField("Liczba osób", text: $brief.guestCount, prompt: "np. 120")
                if !brief.guestCountText.isEmpty { Text("Z wiadomości: \(brief.guestCountText)").font(.caption).foregroundStyle(.secondary) }
                TextField("Zakres", text: $brief.scope, prompt: Text("Czego potrzebuje klient"), axis: .vertical).lineLimit(2...6)
            }
            Section("Budżet") {
                MeetingTextField("Od (zł)", text: $brief.budgetMin, prompt: "np. 15000")
                MeetingTextField("Do (zł)", text: $brief.budgetMax, prompt: "np. 20000")
            }
            Section("Notatka z rozmowy") {
                TextEditor(text: $brief.conversationNotes).frame(minHeight: 80)
            }
        }
        .formStyle(.grouped)
        .environment(\.timeZone, MeetingDates.zone)
        .environment(\.locale, Locale(identifier: "pl_PL"))
        .frame(minHeight: 520)
    }
}

// MARK: Okna

private struct InquiryStageSheet: View {
    let data: InquiryWorkspaceData
    let save: (String, String, String) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var stage = ""
    @State private var category = ""
    @State private var reason = ""

    private var valid: Bool {
        !stage.isEmpty && stage != data.inquiry.stage
            && (stage != "lost" || (!category.isEmpty && !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Zmień etap zapytania").font(.title3.bold())
            Text("Wybierz miejsce w lejku zapytań").foregroundStyle(.secondary)
            Picker("", selection: $stage) {
                ForEach(data.stages) { item in Text("\(item.label) (\(Int(item.probability))%)").tag(item.id) }
            }
            .pickerStyle(.radioGroup).labelsHidden()
            if stage == "lost" {
                Picker("Kategoria utraty", selection: $category) {
                    Text("Wybierz kategorię").tag("")
                    ForEach(data.lostCategories) { Text($0.label).tag($0.value) }
                }
                TextField("Powód przegrania", text: $reason, prompt: Text("Opisz, dlaczego klient zrezygnował"), axis: .vertical).lineLimit(3...6)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz etap") { Task { if await save(stage, category, reason.trimmingCharacters(in: .whitespacesAndNewlines)) { dismiss() } } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!valid)
            }
        }
        .padding(20).frame(width: 440)
        .onAppear {
            stage = data.inquiry.stage
            category = data.inquiry.lostReasonCategory
            reason = data.inquiry.lostReason
        }
    }
}

private struct InquiryHandoffSheet: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    let title: String
    let save: (String?) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var transfer = true
    @State private var target = ""
    @State private var candidates: [MeetingPerson] = []
    @State private var loading = true
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Przekaż / oddaj zapytanie").font(.title3.bold())
            Text(title).foregroundStyle(.secondary)
            Picker("", selection: $transfer) {
                Text("Przekaż osobie").tag(true)
                Text("Oddaj do puli").tag(false)
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            if loading {
                ProgressView("Wczytywanie opiekunów…")
            } else if transfer {
                Picker("Nowy opiekun", selection: $target) {
                    Text("Wybierz osobę").tag("")
                    ForEach(candidates) { Text($0.name).tag($0.id) }
                }
                if candidates.isEmpty && problem == nil {
                    Text("Brak dostępnych opiekunów w Twoim zakresie uprawnień. Możesz oddać zapytanie do puli.").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text("Zapytanie trafi do „Nieprzypisanych”. Inna osoba będzie mogła je przejąć.").foregroundStyle(.secondary)
            }
            Text("Po zmianie opiekuna zapytanie może zniknąć z Twojej listy. Historia, oferty i kalkulacje pozostaną przy zapytaniu.")
                .font(.caption).foregroundStyle(.secondary)
            if let problem { Text(problem).font(.caption).foregroundStyle(.orange) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(transfer ? "Przekaż zapytanie" : "Oddaj do puli") {
                    Task { if await save(transfer ? target : nil) { dismiss() } }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(loading || (transfer && target.isEmpty))
            }
        }
        .padding(20).frame(width: 440)
        .task {
            do { candidates = try await store.handoffCandidates(inquiryID) } catch { problem = store.failureText(error, "Nie udało się pobrać listy opiekunów.") }
            loading = false
        }
    }
}

private struct InquiryAcceptOfferSheet: View {
    let offer: InquiryWorkspaceData.Offer
    let save: (String?, String) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var packageID = ""
    @State private var note = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Akceptacja: \(offer.number)").font(.title3.bold())
            Text("Zapisz, kto i w jaki sposób potwierdził zakres. Rezerwację zasobów zatwierdzisz przy przekazaniu do realizacji.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if offer.packageMode {
                Picker("Pakiet", selection: $packageID) {
                    Text("Wybierz pakiet").tag("")
                    ForEach(offer.packages) { Text("\($0.name) — \(InquiryFormat.money($0.priceNet)) netto").tag($0.id) }
                }
            }
            TextField("Potwierdzenie klienta", text: $note, prompt: Text("np. rozmowa telefoniczna z dnia…"), axis: .vertical).lineLimit(3...6)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz akceptację") { Task { if await save(packageID.isEmpty ? nil : packageID, note.trimmingCharacters(in: .whitespacesAndNewlines)) { dismiss() } } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (offer.packageMode && packageID.isEmpty))
            }
        }
        .padding(20).frame(width: 480)
    }
}

private struct InquiryReasonSheet: View {
    let title: String
    let prompt: String
    let action: String
    let save: (String) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.bold())
            TextField(prompt, text: $reason, prompt: Text(prompt), axis: .vertical).lineLimit(3...6)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(action) { Task { if await save(reason.trimmingCharacters(in: .whitespacesAndNewlines)) { dismiss() } } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20).frame(width: 440)
    }
}

private struct InquiryScheduleSheet: View {
    let save: (Date) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var date = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Kontakt odnotowany — następny termin").font(.title3.bold())
            DatePicker("Następny kontakt", selection: $date, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz") { Task { if await save(date) { dismiss() } } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20).frame(width: 420)
    }
}
