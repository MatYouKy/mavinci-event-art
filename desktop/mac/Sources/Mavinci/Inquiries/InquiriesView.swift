import SwiftUI
import AppKit

// MARK: Lejek zapytań — 1:1 ze stroną `/crm/inquiries`: zwarty nagłówek (zakres, widok, status, ważona wartość, sprawy wymagające
// uwagi), kolumny etapów z kartami (przeciąganie zmienia etap), lista, szczegóły w panelu bocznym i obsługa zapytania.

enum InquiryViewMode: String, CaseIterable, Identifiable {
    case pipeline, list
    var id: String { rawValue }
    var label: String { self == .pipeline ? "Lejek" : "Lista" }
    var symbol: String { self == .pipeline ? "square.grid.3x1.below.line.grid.1x2" : "list.bullet" }
}

/// Formularz „Obsługa zapytania” (opcjonalnie z wybranym etapem — np. po przeciągnięciu do „Przegrane”).
struct InquiryEditRequest: Identifiable {
    let id = UUID()
    let inquiry: Inquiry
    var stage: InquiryStage?
}
struct InquiryRemoval: Identifiable {
    let id = UUID()
    let inquiry: Inquiry
    let mode: String
}

/// Czynności karty, listy i szczegółów.
struct InquiryActions {
    let open: (Inquiry) -> Void
    let edit: (Inquiry) -> Void
    let claim: (Inquiry) -> Void
    let contact: (Inquiry) -> Void
    let snooze: (Inquiry) -> Void
    let handoff: (Inquiry) -> Void
    let remove: (Inquiry) -> Void
    let move: (Inquiry, InquiryStage) -> Void
    let browser: (Inquiry) -> Void
}

@MainActor struct InquiriesFunnelView: View {
    @ObservedObject var store: InquiriesStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("inquiries.mode") private var mode: InquiryViewMode = .pipeline
    @AppStorage("inquiries.scope") private var scope: InquiryScope = .pool
    @State private var status: InquiryStatusFilter = .open
    @State private var attention: InquiryAttention?
    @State private var search = ""
    @State private var selectedID: String?
    @State private var inspectorShown = false
    @State private var editing: InquiryEditRequest?
    @State private var contactTarget: Inquiry?
    @State private var removal: InquiryRemoval?
    @State private var deleting: InquiryRemoval?
    @State private var targeted: InquiryStage?

    private var me: String? { store.access?.employeeId ?? state.employee?.id }
    private var scopes: [InquiryScope] {
        guard let access = store.access else { return [.mine, .collaborating] }
        return InquiryScope.allCases.filter {
            switch $0 {
            case .mine, .collaborating: return true
            case .pool: return access.canViewPool
            case .team: return access.canViewTeam
            case .all: return access.canViewAll
            }
        }
    }
    private var activeScope: InquiryScope {
        if scopes.contains(scope) { return scope }
        return scopes.contains(.pool) ? .pool : .mine
    }
    private func inScope(_ inquiry: Inquiry, _ scope: InquiryScope) -> Bool {
        switch scope {
        case .mine: return inquiry.ownerId != nil && inquiry.ownerId == me
        case .collaborating: return inquiry.member && inquiry.ownerId != me
        case .pool: return inquiry.ownerId == nil
        case .team:
            guard let team = store.access?.salesTeamId else { return false }
            return inquiry.ownerTeamId == team
        case .all: return true
        }
    }
    private var visible: [Inquiry] {
        let now = Date()
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.inquiries.filter { inquiry in
            guard inScope(inquiry, activeScope) else { return false }
            if status == .open && !inquiry.isOpen { return false }
            if status == .completed && inquiry.isOpen { return false }
            if let attention, !attention.matches(inquiry, now: now) { return false }
            return query.isEmpty || inquiry.searchText.contains(query)
        }
    }
    private func count(_ filter: InquiryStatusFilter) -> Int {
        switch filter {
        case .open: return store.inquiries.filter(\.isOpen).count
        case .completed: return store.inquiries.filter { !$0.isOpen }.count
        case .all: return store.inquiries.count
        }
    }
    private func count(_ attention: InquiryAttention) -> Int {
        let now = Date()
        return store.inquiries.filter { attention.matches($0, now: now) }.count
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Zapytania")
        .navigationSubtitle("Lejek sprzedaży")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj po kliencie, firmie, e-mailu, telefonie, źródle lub opiekunie")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if store.access?.canCreate == true {
                    Button { state.openCRM("/crm/inquiries?new=1") } label: { Label("Dodaj zapytanie", systemImage: "plus") }
                        .help("Dodaj zapytanie (formularz CRM w przeglądarce)")
                }
                if store.access?.isAdmin == true {
                    Button { state.openCRM("/crm/inquiries?sla=1") } label: { Label("SLA", systemImage: "gearshape") }
                        .help("Ustawienia SLA (CRM w przeglądarce)")
                }
                Button { inspectorShown.toggle() } label: { Label("Szczegóły", systemImage: "sidebar.trailing") }
                    .help("Pokaż lub ukryj szczegóły zapytania")
            }
        }
        .inspector(isPresented: $inspectorShown) {
            InquiryInspector(inquiry: store.inquiry(selectedID), store: store, actions: actions)
                .inspectorColumnWidth(min: 300, ideal: 360, max: 500)
                .background(theme.page)
        }
        .sheet(item: $editing) { request in
            InquiryEditorSheet(store: store, inquiry: request.inquiry, initialStage: request.stage)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $contactTarget) { inquiry in
            InquiryContactSheet(store: store, inquiry: inquiry)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $removal) { request in
            InquiryArchiveSheet(store: store, inquiry: request.inquiry) { if selectedID == request.inquiry.id { selectedID = nil } }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń zapytanie", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let target = deleting {
                Button("Usuń trwale", role: .destructive) {
                    Task { if await store.remove(target.inquiry, mode: "deleted", reason: "") { if selectedID == target.inquiry.id { selectedID = nil } } }
                }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Zapytanie nie ma zadań, ofert, kalkulacji ani powiązanego wydarzenia. Zostanie trwale usunięte wraz z historią. Tej operacji nie można cofnąć.")
        }
        .task(id: state.employee?.id) {
            if store.inquiries.isEmpty { await store.backgroundSync() }
            // Jak w CRM: zmiany z przeglądarki i od innych osób co 30 s (tylko zmienione koszyki).
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                await store.backgroundSync()
            }
        }
        .onAppear { reveal() }
        .onChange(of: state.focusToken) { _, _ in reveal() }
        .onChange(of: store.lastSync) { _, _ in reveal() }
        .onChange(of: selectedID) { _, id in if id != nil { inspectorShown = true } }
    }

    // MARK: Zwarty nagłówek
    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Picker("Zakres", selection: Binding(get: { activeScope }, set: { scope = $0 })) {
                    ForEach(scopes) { item in
                        Text("\(item.label) \(store.inquiries.filter { inScope($0, item) }.count)").tag(item)
                    }
                }.pickerStyle(.segmented).labelsHidden().fixedSize()
                Image(systemName: "info.circle").foregroundStyle(.secondary)
                    .help("Formularze WWW i webhooki trafiają do etapu „Nowe” w kolejce „Nieprzypisane”. Przejmij zapytanie, aby prowadzić je w „Moich”. Zadania to dalsze działania powiązane z zapytaniem, nie drugi lejek.")
                Spacer(minLength: 8)
                if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja zapytań") }
                Picker("Widok", selection: $mode) {
                    ForEach(InquiryViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
                }.pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            HStack(spacing: 10) {
                Picker("Status", selection: $status) {
                    ForEach(InquiryStatusFilter.allCases) { Text("\($0.label) \(count($0))").tag($0) }
                }.pickerStyle(.segmented).labelsHidden().fixedSize()
                HStack(spacing: 4) {
                    Text("Ważona wartość").foregroundStyle(.secondary)
                    Text(InquiryFormat.money(visible.reduce(0) { $0 + $1.weightedValue })).fontWeight(.semibold).foregroundStyle(theme.accent)
                }.font(.callout)
                Spacer(minLength: 8)
                ForEach(InquiryAttention.allCases.filter { count($0) > 0 || attention == $0 }) { item in
                    Toggle(isOn: Binding(get: { attention == item }, set: { attention = $0 ? item : nil })) {
                        Label { Text("\(item.label) \(count(item))") } icon: { Image(systemName: "circle.fill").foregroundStyle(item.color) }
                    }
                    .toggleStyle(.button)
                    .help(attention == item ? "Pokaż wszystkie" : "Pokaż tylko: \(item.label)")
                }
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
    }

    @ViewBuilder private var content: some View {
        if store.inquiries.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Zapytania", systemImage: "tray")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
            } else {
                ProgressView("Ładowanie zapytań…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if visible.isEmpty && mode == .list {
            ContentUnavailableView("Brak zapytań w tym widoku", systemImage: "tray", description: Text("Zmień filtr lub wyszukiwaną frazę."))
        } else if mode == .pipeline {
            pipeline
        } else {
            InquiryListTable(inquiries: visible, store: store, selectedID: $selectedID, actions: actions)
        }
    }

    // MARK: Kolumny etapów
    private var pipeline: some View {
        GeometryReader { geo in
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(InquiryStage.allCases) { stage in
                        column(stage, height: max(200, geo.size.height - 16))
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 8)
            }
        }
    }

    private func column(_ stage: InquiryStage, height: CGFloat) -> some View {
        let items = visible.filter { $0.inquiryStage == stage }
        let value = items.reduce(0) { $0 + ($1.estimatedValue ?? 0) }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Circle().fill(stage.color).frame(width: 8, height: 8)
                Text(stage.label).font(.callout.weight(.semibold))
                Spacer()
                Text("\(items.count)").font(.caption.weight(.medium)).monospacedDigit()
                    .padding(.horizontal, 7).padding(.vertical, 2).background(Color.primary.opacity(0.08), in: Capsule())
            }
            Text(InquiryFormat.money(value)).font(.caption).foregroundStyle(.secondary)
            ScrollView(.vertical) {
                LazyVStack(spacing: 10) {
                    if items.isEmpty {
                        Text(targeted == stage ? "Upuść tutaj" : "Przeciągnij tutaj").font(.caption).foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity, minHeight: 70)
                            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                    }
                    ForEach(items) { inquiry in card(inquiry) }
                }
                .padding(.bottom, 6)
            }
        }
        .padding(10)
        .frame(width: 300, height: height, alignment: .top)
        .background(targeted == stage ? theme.accent.opacity(0.10) : Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
        .dropDestination(for: String.self) { ids, _ in
            guard let id = ids.first, let inquiry = store.inquiry(id) else { return false }
            drop(inquiry, on: stage)
            return true
        } isTargeted: { inside in
            if inside { targeted = stage } else if targeted == stage { targeted = nil }
        }
    }

    @ViewBuilder private func card(_ inquiry: Inquiry) -> some View {
        let view = InquiryCardView(inquiry: inquiry, selected: selectedID == inquiry.id, canManage: store.canManage(inquiry),
                                   canClaim: store.canClaim(inquiry), busy: store.busy.contains(inquiry.id), actions: actions)
        if store.canManage(inquiry) {
            view.draggable(inquiry.id) {
                Text(inquiry.titleLabel).font(.callout.weight(.semibold)).padding(10)
                    .background(theme.card, in: RoundedRectangle(cornerRadius: 8))
            }
        } else {
            view
        }
    }

    private func drop(_ inquiry: Inquiry, on stage: InquiryStage) {
        guard inquiry.inquiryStage != stage else { return }
        guard store.canManage(inquiry) else { state.error = "Najpierw przejmij zapytanie lub poproś menedżera o przypisanie"; return }
        if stage == .lost { editing = InquiryEditRequest(inquiry: inquiry, stage: .lost); return }
        Task { await store.move(inquiry, to: stage) }
    }

    private var actions: InquiryActions {
        InquiryActions(
            open: { selectedID = $0.id; inspectorShown = true },
            edit: { editing = InquiryEditRequest(inquiry: $0) },
            claim: { inquiry in Task { if await store.claim(inquiry) { scope = .mine } } },
            contact: { contactTarget = $0 },
            snooze: { inquiry in Task { await store.snooze(inquiry) } },
            handoff: { state.openCRM("/crm/inquiries/\($0.id)") },
            remove: { inquiry in
                Task {
                    guard let mode = await store.removalMode(inquiry) else { return }
                    if mode == "deleted" { deleting = InquiryRemoval(inquiry: inquiry, mode: mode) }
                    else { removal = InquiryRemoval(inquiry: inquiry, mode: mode) }
                }
            },
            move: { inquiry, stage in drop(inquiry, on: stage) },
            browser: { state.openCRM("/crm/inquiries/\($0.id)") }
        )
    }

    /// Zapytanie wskazane z pulpitu, powiadomienia lub wiadomości: pokaż je mimo filtrów i otwórz szczegóły.
    private func reveal() {
        guard state.selection == .inquiries, let id = state.focusedID, let inquiry = store.inquiry(id) else { return }
        guard selectedID != id else { return }
        if !visible.contains(where: { $0.id == id }) {
            status = .all; attention = nil; search = ""
            if let target = scopes.first(where: { inScope(inquiry, $0) && $0 != .collaborating }) ?? scopes.first(where: { inScope(inquiry, $0) }) {
                scope = target
            }
        }
        selectedID = id
        inspectorShown = true
    }
}

// MARK: Karta zapytania

@MainActor struct InquiryCardView: View {
    let inquiry: Inquiry
    let selected: Bool
    let canManage: Bool
    let canClaim: Bool
    let busy: Bool
    let actions: InquiryActions
    @Environment(\.crmTheme) private var theme

    var body: some View {
        let stage = inquiry.inquiryStage
        let warnings = inquiry.warnings
        let overdue = inquiry.overdue()
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(inquiry.titleLabel).font(.callout.weight(.semibold)).lineLimit(2)
                    Text(inquiry.sourceLabel).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                if busy { ProgressView().controlSize(.mini) }
            }
            FlowBadges(inquiry: inquiry, stage: stage)
            VStack(alignment: .leading, spacing: 3) {
                if !inquiry.clientPhone.isEmpty { Label(inquiry.clientPhone, systemImage: "phone").lineLimit(1) }
                if !inquiry.clientEmail.isEmpty { Label(inquiry.clientEmail, systemImage: "envelope").lineLimit(1) }
                if !inquiry.ownerName.isEmpty { Label(inquiry.ownerName, systemImage: "person").lineLimit(1) }
                if let value = inquiry.estimatedValue { Label(InquiryFormat.money(value), systemImage: "banknote") }
                if let next = inquiry.nextAction {
                    Label("\(overdue ? "Zaległy kontakt" : "Następny kontakt"): \(InquiryFormat.short(next))", systemImage: "calendar.badge.clock")
                        .foregroundStyle(overdue ? CrmTheme.rgb(0xfca5a5) : .secondary)
                }
            }
            .font(.caption).foregroundStyle(.secondary)
            if !warnings.isEmpty {
                Label(warnings.prefix(2).joined(separator: " · "), systemImage: "exclamationmark.triangle")
                    .font(.caption2).foregroundStyle(CrmTheme.rgb(0xfde68a).opacity(0.85))
                    .padding(6).frame(maxWidth: .infinity, alignment: .leading)
                    .background(CrmTheme.rgb(0xfbbf24).opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            }
            if canClaim || (canManage && inquiry.ownerId != nil && inquiry.isOpen) {
                HStack(spacing: 6) {
                    if canClaim {
                        Button { actions.claim(inquiry) } label: { Label("Przejmij", systemImage: "person.crop.circle.badge.checkmark") }
                            .buttonStyle(.borderedProminent)
                    }
                    if canManage && inquiry.ownerId != nil && inquiry.isOpen {
                        Button("Odłóż 1h") { actions.snooze(inquiry) }
                        Button("Kontakt wykonany") { actions.contact(inquiry) }.tint(CrmTheme.rgb(0x34d399))
                    }
                }
                .controlSize(.small).disabled(busy)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? theme.accent.opacity(0.14) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .leading) { if selected { RoundedRectangle(cornerRadius: 2).fill(theme.accent).frame(width: 3).padding(.vertical, 6) } }
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { actions.open(inquiry) }
        .contextMenu { InquiryMenuItems(inquiry: inquiry, canManage: canManage, canClaim: canClaim, actions: actions) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(inquiry.titleLabel), \(stage.label)")
    }
}

/// Rodzaj zapytania, etap i szansa wygranej (jak odznaki na karcie w CRM).
struct FlowBadges: View {
    let inquiry: Inquiry
    let stage: InquiryStage
    @Environment(\.crmTheme) private var theme
    var body: some View {
        HStack(spacing: 4) {
            ForEach(inquiry.typeLabels.prefix(2), id: \.self) { label in pill(label, theme.accent) }
            pill(stage.shortLabel, stage.color)
            pill("\(inquiry.probability)%", .secondary)
        }
    }
    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.medium)).lineLimit(1).padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
}

@MainActor struct InquiryMenuItems: View {
    let inquiry: Inquiry
    let canManage: Bool
    let canClaim: Bool
    let actions: InquiryActions
    var body: some View {
        Button("Pokaż szczegóły", systemImage: "info.circle") { actions.open(inquiry) }
        Button("Otwórz w CRM", systemImage: "safari") { actions.browser(inquiry) }
        if canClaim { Button("Przejmij", systemImage: "person.crop.circle.badge.checkmark") { actions.claim(inquiry) } }
        if canManage {
            Divider()
            Button("Obsługa zapytania…", systemImage: "pencil") { actions.edit(inquiry) }
            Menu("Przenieś do etapu") {
                ForEach(InquiryStage.allCases) { stage in
                    Button(stage.label) { actions.move(inquiry, stage) }.disabled(stage == inquiry.inquiryStage)
                }
            }
            if inquiry.ownerId != nil && inquiry.isOpen {
                Button("Kontakt wykonany…", systemImage: "checkmark.bubble") { actions.contact(inquiry) }
                Button("Odłóż o godzinę", systemImage: "clock.arrow.circlepath") { actions.snooze(inquiry) }
                Button("Przekaż / oddaj…", systemImage: "arrowshape.turn.up.right") { actions.handoff(inquiry) }
            }
            Divider()
            Button("Usuń lub archiwizuj…", systemImage: "trash", role: .destructive) { actions.remove(inquiry) }
        }
    }
}

// MARK: Lista

@MainActor struct InquiryListTable: View {
    let inquiries: [Inquiry]
    @ObservedObject var store: InquiriesStore
    @Binding var selectedID: String?
    let actions: InquiryActions
    var body: some View {
        Table(inquiries, selection: $selectedID) {
            TableColumn("Zapytanie") { (inquiry: Inquiry) in
                VStack(alignment: .leading, spacing: 2) {
                    Text(inquiry.titleLabel).fontWeight(.medium).lineLimit(1)
                    Text(inquiry.sourceLabel).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }.width(min: 220, ideal: 360)
            TableColumn("Etap") { (inquiry: Inquiry) in
                Label { Text(inquiry.inquiryStage.label) } icon: { Image(systemName: "circle.fill").foregroundStyle(inquiry.inquiryStage.color) }
            }.width(min: 120, ideal: 150)
            TableColumn("Opiekun") { (inquiry: Inquiry) in
                Text(inquiry.ownerName.isEmpty ? "Bez opiekuna" : inquiry.ownerName).foregroundStyle(inquiry.ownerName.isEmpty ? Color.secondary : Color.primary)
            }.width(min: 110, ideal: 150)
            TableColumn("Wartość") { (inquiry: Inquiry) in
                Text(inquiry.estimatedValue.map(InquiryFormat.money) ?? "—").monospacedDigit()
            }.width(min: 80, ideal: 110)
            TableColumn("Szansa") { (inquiry: Inquiry) in Text("\(inquiry.probability)%").monospacedDigit() }.width(min: 50, ideal: 60)
            TableColumn("Następny kontakt") { (inquiry: Inquiry) in
                if let next = inquiry.nextAction {
                    Text(InquiryFormat.short(next)).monospacedDigit().foregroundStyle(inquiry.overdue() ? CrmTheme.rgb(0xfca5a5) : .primary)
                } else { Text("—").foregroundStyle(.secondary) }
            }.width(min: 110, ideal: 130)
            TableColumn("Uwagi") { (inquiry: Inquiry) in
                Text(inquiry.warnings.joined(separator: " · ")).font(.caption).foregroundStyle(CrmTheme.rgb(0xfde68a).opacity(0.8)).lineLimit(1)
            }.width(min: 120, ideal: 220)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let inquiry = store.inquiry(id) {
                InquiryMenuItems(inquiry: inquiry, canManage: store.canManage(inquiry), canClaim: store.canClaim(inquiry), actions: actions)
            }
        } primaryAction: { ids in
            if let id = ids.first, let inquiry = store.inquiry(id) { actions.open(inquiry) }
        }
    }
}

// MARK: Szczegóły (inspektor)

@MainActor struct InquiryInspector: View {
    let inquiry: Inquiry?
    @ObservedObject var store: InquiriesStore
    let actions: InquiryActions
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    var body: some View {
        if let inquiry {
            ScrollView { details(inquiry).padding(18).frame(maxWidth: .infinity, alignment: .leading) }
        } else {
            ContentUnavailableView("Wybierz zapytanie", systemImage: "tray", description: Text("Kliknij kartę w lejku lub wiersz listy."))
        }
    }

    private func details(_ inquiry: Inquiry) -> some View {
        let stage = inquiry.inquiryStage
        let canManage = store.canManage(inquiry)
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(inquiry.titleLabel).font(.title3.weight(.semibold)).textSelection(.enabled)
                Text(inquiry.sourceLabel).font(.caption).foregroundStyle(.secondary)
                FlowBadges(inquiry: inquiry, stage: stage)
            }
            if store.canClaim(inquiry) || (canManage && inquiry.ownerId != nil && inquiry.isOpen) {
                HStack(spacing: 6) {
                    if store.canClaim(inquiry) {
                        Button { actions.claim(inquiry) } label: { Label("Przejmij", systemImage: "person.crop.circle.badge.checkmark") }.buttonStyle(.borderedProminent)
                    }
                    if canManage && inquiry.ownerId != nil && inquiry.isOpen {
                        Button("Kontakt wykonany…") { actions.contact(inquiry) }
                        Button("Odłóż 1h") { actions.snooze(inquiry) }
                    }
                }.controlSize(.small)
            }
            if !inquiry.warnings.isEmpty {
                Label(inquiry.warnings.joined(separator: " · "), systemImage: "exclamationmark.triangle")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xfde68a).opacity(0.9))
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(CrmTheme.rgb(0xfbbf24).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
            group("Klient") {
                field("Klient", inquiry.clientText)
                field("Firma", inquiry.clientCompany)
                if !inquiry.clientPhone.isEmpty {
                    HStack { field("Telefon", inquiry.clientPhone); Spacer(); Button("Zadzwoń", systemImage: "phone") { open("tel", inquiry.clientPhone) }.controlSize(.small) }
                }
                if !inquiry.clientEmail.isEmpty {
                    HStack { field("E-mail", inquiry.clientEmail); Spacer(); Button("Napisz", systemImage: "envelope") { open("mailto", inquiry.clientEmail) }.controlSize(.small) }
                }
            }
            group("Sprzedaż") {
                field("Opiekun", inquiry.ownerName.isEmpty ? "Bez opiekuna" : inquiry.ownerName)
                field("Szacowana wartość", inquiry.estimatedValue.map(InquiryFormat.money) ?? "")
                field("Prawdopodobieństwo wygranej", "\(inquiry.probability)%")
                field("Następne działanie", inquiry.nextAction.map(InquiryFormat.full) ?? "")
                field("Ostatni kontakt", inquiry.lastContact.map(InquiryFormat.full) ?? "")
                field("Pierwszy kontakt", inquiry.firstContact.map(InquiryFormat.full) ?? "")
                if inquiry.firstContactAt == nil, let due = inquiry.slaDue { field("Termin pierwszego kontaktu (SLA)", InquiryFormat.full(due)) }
                if stage == .lost {
                    field("Kategoria utraty", inquiryLostCategories.first { $0.value == inquiry.lostReasonCategory }?.label ?? "")
                    field("Powód utraty", inquiry.lostReason)
                }
            }
            group("Wydarzenie") {
                field("Miejsce", inquiry.locationText)
                field("Zakres", inquiry.scope)
                field("Treść zapytania", inquiry.message.isEmpty ? inquiry.description : inquiry.message)
            }
            VStack(alignment: .leading, spacing: 6) {
                if let offer = inquiry.linkedOfferId, state.employee?.canView(.offers) == true {
                    Button("Otwórz ofertę", systemImage: "doc.text") { state.open(.offers, id: offer) }
                }
                if let event = inquiry.eventId, state.employee?.canView(.events) == true {
                    Button("Otwórz wydarzenie", systemImage: "sparkles") { state.showEvent(event) }
                }
                Button("Pełne szczegóły w CRM", systemImage: "safari") { actions.browser(inquiry) }
            }.buttonStyle(.link)
            if canManage {
                HStack {
                    Button(role: .destructive) { actions.remove(inquiry) } label: { Label("Usuń…", systemImage: "trash") }
                    Spacer()
                    Button { actions.edit(inquiry) } label: { Label("Obsługa zapytania", systemImage: "pencil") }
                        .buttonStyle(.borderedProminent).keyboardShortcut("e")
                }
            }
        }
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            content()
        }
    }
    @ViewBuilder private func field(_ label: String, _ value: String) -> some View {
        if !value.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).textSelection(.enabled)
            }
        }
    }
    private func open(_ scheme: String, _ value: String) {
        var parts = URLComponents(); parts.scheme = scheme; parts.path = value
        if let url = parts.url { NSWorkspace.shared.open(url) }
    }
}
