import SwiftUI
import AppKit

// MARK: Karta wydarzenia — Przegląd i Szczegóły (natywnie) oraz zakładki w widoku danych (do czasu przeniesienia).

/// Przegląd (`effectiveTab === 'overview'`): zaproszenie do zespołu, kroki realizacji, kontrola przed wydarzeniem (lewa kolumna)
/// i „Najważniejsze” (prawa). Bez kroków w bazie — dawne panele realizacji i magazynu. Dane z kopii na dysku, odświeżane po skrócie.
@MainActor struct EventOverviewTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let page: EventCardPage
    var navigate: (String) -> Void
    /// Panel z boku karty (obok każdej zakładki): najważniejsze, kroki i kontrola jedna pod drugą.
    var sidebar = false
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    private var flags: EventCardFlags? { page.flags }
    private var overview: EventCardOverview? { store.overview(eventID) }
    private func canOpenTab(_ tab: String) -> Bool { flags?.tabs.contains { $0.id == tab } == true }

    var body: some View {
        ScrollView {
            if sidebar {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Przegląd").font(.headline)
                    EventArrangementsCard(store: store, eventID: eventID)
                    right
                    left
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 18) {
                        left.frame(minWidth: 520, maxWidth: .infinity, alignment: .topLeading)
                        right.frame(width: 360, alignment: .topLeading)
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        left
                        right
                    }
                }
                .padding(18).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task(id: eventID) { await store.loadOverview(eventID) }
        .onChange(of: state.refreshEventToken) { Task { await store.loadOverview(eventID) } }
        .onChange(of: store.card(eventID)?.hash) { Task { await store.loadOverview(eventID) } }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await store.loadOverview(eventID) }
        }
    }

    private var left: some View {
        VStack(alignment: .leading, spacing: 16) {
            if flags?.hasLimitedAccess == true && flags?.userAssignmentStatus == "pending" { invitation }
            if let overview {
                EventStepsPanelView(store: store, eventID: eventID, state: overview.steps, onNavigate: navigate, canOpenTab: canOpenTab)
                if overview.steps.unavailable == true { LegacyWorkflowSection(eventID: eventID) }
                if flags?.canEventManage == true, let preflight = overview.preflight {
                    EventPreflightView(preflight: preflight, hideCommercial: flags?.canViewCommercialDocs != true,
                                       onRefresh: { Task { await store.loadOverview(eventID) } }, onNavigate: navigate, canOpenTab: canOpenTab)
                }
            } else if let error = store.overviewErrors[eventID] {
                HStack(spacing: 6) {
                    Text(error).foregroundStyle(.secondary)
                    Button("Spróbuj ponownie") { Task { await store.loadOverview(eventID) } }.buttonStyle(.link).linkCursor()
                }
                .font(.callout)
            } else {
                ProgressView("Wczytywanie kroków realizacji…").frame(maxWidth: .infinity, minHeight: 120)
            }
        }
    }

    @ViewBuilder private var right: some View {
        if let overview {
            EventKeyFactsView(eventID: eventID, page: page, overview: overview, onNavigate: navigate, canOpenTab: canOpenTab)
        }
    }

    private var invitation: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Zaproszenie do zespołu wydarzenia", systemImage: "exclamationmark.circle").font(.headline).foregroundStyle(CrmTheme.rgb(0x60a5fa))
            Text("Zostałeś zaproszony do udziału w tym wydarzeniu. Po akceptacji zaproszenia uzyskasz dostęp do pełnych szczegółów wydarzenia, w tym sprzętu, zadań i plików.")
                .foregroundStyle(.secondary)
            HStack {
                Button("Akceptuj zaproszenie") {
                    Task { await store.run(eventID, "Zapisywanie…", "invitation", ["accept": .bool(true)], success: "Status zaproszenia został odświeżony") }
                }
                .buttonStyle(.borderedProminent).tint(CrmTheme.rgb(0x22c55e).opacity(0.8))
                Button("Odrzuć zaproszenie") {
                    Task {
                        if await store.run(eventID, "Zapisywanie…", "invitation", ["accept": .bool(false)], success: "Zaproszenie zostało odrzucone") {
                            state.eventRoute = nil
                        }
                    }
                }
                .tint(CrmTheme.rgb(0xef4444))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CrmTheme.rgb(0x3b82f6).opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Opis i notatki bywają zapisane jako HTML (edytor w CRM) — tekst do podglądu bez znaczników.
enum EventCardRichText {
    static func plain(_ text: String) -> String {
        guard text.contains("<") else { return text }
        if let data = text.data(using: .utf8),
           let attributed = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) {
            return attributed.string.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return text.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    }
}

/// Zakładka jeszcze nieprzeniesiona: dane wydarzenia z widoku danych (z zapisem do pracy bez sieci) i przejście do CRM.
@MainActor struct LegacyEventTabView: View {
    let eventID: String
    let tabID: String
    let wedding: Bool
    @EnvironmentObject private var state: Workspace
    @StateObject private var store = EventPageStore()
    @State private var form: EventForm?

    private var legacyTab: EventTab? {
        switch tabID {
        case "equipment": return .equipment
        case "logistics": return .logistics
        case "team": return .team
        case "phases": return .phases
        case "agenda": return wedding ? .wedding : .agenda
        case "subcontractors": return .subcontractors
        case "files": return .files
        case "tasks": return .tasks
        case "offer": return .offer
        case "calculations": return .calculations
        case "contract": return .contract
        case "seller-arrangements": return .seller
        case "finances", "summary": return .finances
        case "history": return .history
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Ta zakładka jest w trakcie przenoszenia do aplikacji — poniżej dane wydarzenia, pełna obsługa w CRM.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/events/\(eventID)?tab=\(tabID)") }.controlSize(.small)
            }
            .padding(.horizontal, 18).padding(.vertical, 6)
            if store.page != nil, legacyTab != nil {
                EventDataView(store: store, form: $form)
            } else if store.loading {
                ProgressView("Pobieranie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("Otwórz zakładkę w CRM", systemImage: "safari", description: Text(store.error ?? "Dane tej zakładki są dostępne w CRM."))
            }
        }
        .task {
            guard let legacyTab else { return }
            store.selectedTab = legacyTab
            await store.load(eventID, workspace: state)
            if store.selectedTab != legacyTab, store.page?.access.tabs.contains(legacyTab) == true {
                store.selectedTab = legacyTab
                await store.loadTab(workspace: state)
            }
        }
        .onDisappear { store.cancel() }
        .sheet(item: $form, onDismiss: {
            state.editing = false
            Task { await store.load(eventID, workspace: state) }
        }) { form in EventFormView(form: form, store: store) }
    }
}

/// Realizacja i przygotowanie magazynowe (kierownik realizacji, przejęcie i gotowość magazynu) — dotychczasowe czynności.
@MainActor struct LegacyWorkflowSection: View {
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @StateObject private var store = EventPageStore()
    @State private var form: EventForm?

    var body: some View {
        Group {
            if let page = store.page, let workflow = page.access.workflow {
                TeamCard(title: "Realizacja") {
                    EventRecordFields(row: Row(workflow))
                    HStack {
                        if page.access.manage {
                            Button("Wyznacz kierownika realizacji…", systemImage: "person.badge.key") {
                                form = EventForm(title: "Wyznacz kierownika realizacji", table: "__manager",
                                                 fields: [.init(id: "employee_id", label: "Pracownik z przyjętym zaproszeniem", kind: .lookup("employees"), required: true)])
                            }
                        }
                        if workflow["is_manager"]?.flag == true {
                            let realization = workflow["realization"]?.object ?? [:]
                            if realization["started_at"] == nil || realization["started_at"] == .null {
                                Button("Przejmij realizację", systemImage: "play") { Task { await store.workflow("start", workspace: state) } }
                            } else if realization["completed_at"] == nil || realization["completed_at"] == .null {
                                Button("Zakończ realizację…", systemImage: "checkmark.circle") {
                                    form = EventForm(title: "Podsumowanie realizacji", table: "__complete",
                                                     fields: [.init(id: "notes", label: "Podsumowanie", kind: .multiline, required: true)],
                                                     record: Row(["notes": .string("Wszystko OK.")]))
                                }
                            }
                        }
                        if workflow["warehouseAllowed"]?.flag == true {
                            let handoff = workflow["handoff"]?.object ?? [:]
                            if handoff["accepted_at"] == nil || handoff["accepted_at"] == .null {
                                Button("Przejmij przygotowanie magazynowe", systemImage: "shippingbox") { Task { await store.workflow("accept_warehouse", workspace: state) } }
                            } else if handoff["ready_at"] == nil || handoff["ready_at"] == .null {
                                Button("Potwierdź gotowość do realizacji", systemImage: "checkmark.seal") { Task { await store.workflow("ready_warehouse", workspace: state) } }
                            }
                        }
                    }
                    .disabled(!state.canWrite || store.loading || store.saving)
                }
            }
        }
        .task { await store.load(eventID, workspace: state) }
        .onDisappear { store.cancel() }
        .sheet(item: $form, onDismiss: {
            state.editing = false
            Task { await store.load(eventID, workspace: state); await state.eventCards.load(eventID) }
        }) { form in EventFormView(form: form, store: store) }
    }
}
