import SwiftUI
import AppKit

// MARK: Kroki realizacji w Przeglądzie (1:1 z `EventStepsPanel`, `EventStepRow`, `EventStepActionDialog`, `AddEventStepDialog`,
// `EventStepsHelpModal`). Stan z kopii przeglądu na dysku; czynności przez RPC `update_event_step` / `add_event_step`.

struct EventStepRequest: Identifiable { let step: EventStep; let action: String; var id: String { "\(step.id):\(action)" } }

@MainActor struct EventStepsPanelView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let state: EventStepsState
    var onNavigate: (String) -> Void
    var canOpenTab: (String) -> Bool
    @EnvironmentObject private var workspace: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var pending: (step: String, action: String)?
    @State private var request: EventStepRequest?
    @State private var helpOpen = false
    @State private var addOpen = false
    @State private var showAllWaiting = false
    @State private var stageOverrides: [String: Bool] = [:]

    private let waitingPreview = 4

    var body: some View {
        if let snapshot = state.snapshot {
            if !snapshot.steps.isEmpty || snapshot.can_add == true { panel(snapshot) }
        } else if state.hidden != true {
            card {
                Text("Kroki realizacji").font(.headline)
                HStack(spacing: 6) {
                    Text("Nie udało się wczytać kroków realizacji.").foregroundStyle(.red)
                    Button("Spróbuj ponownie") { Task { await store.loadOverview(eventID) } }.buttonStyle(.link).linkCursor()
                }
                .font(.callout)
            }
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) { content() }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
    }

    private func panel(_ snapshot: EventStepsSnapshot) -> some View {
        let values = Array((snapshot.progress ?? [:]).values)
        let total = values.reduce(0) { $0 + $1.total }, done = values.reduce(0) { $0 + $1.done }
        let mineOpen = snapshot.steps.filter { $0.mine && $0.live }.count
        let waiting = snapshot.waiting_for ?? []
        let allClosed = !snapshot.steps.contains { $0.live }
        return card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Kroki realizacji").font(.headline)
                    Text("Zamknięte \(done) z \(total)" + (mineOpen > 0 ? " · Twoje do zrobienia: \(mineOpen)" : ""))
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
                Spacer()
                if store.overviewLoading.contains(eventID) { ProgressView().controlSize(.small) }
                Button { Task { await store.loadOverview(eventID) } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless).help("Odśwież kroki realizacji")
                Button { helpOpen = true } label: { Image(systemName: "questionmark.circle") }
                    .buttonStyle(.borderless).help("Pomoc: kroki i odpowiedzialność")
            }
            ProgressView(value: Double(done), total: Double(max(total, 1)))
                .tint(theme.accent)
                .accessibilityLabel("Postęp kroków realizacji")
                .accessibilityValue("\(done) z \(total) kroków zamkniętych")
            if let error = store.overviewErrors[eventID] {
                HStack(spacing: 6) {
                    Text(error).foregroundStyle(CrmTheme.rgb(0xfde68a).opacity(0.85))
                    Button("Odśwież") { Task { await store.loadOverview(eventID) } }.buttonStyle(.link).linkCursor()
                }
                .font(.caption)
            }
            waitingBox(waiting, allClosed: allClosed)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(EventStepRules.stages, id: \.0) { item in
                    let steps = snapshot.steps.filter { $0.stage == item.0 }
                    if !steps.isEmpty { stageGroup(item.0, item.1, steps, progress: snapshot.progress?[item.0]) }
                }
            }
            if snapshot.can_add == true {
                Button { addOpen = true } label: { Label("Dodaj krok", systemImage: "plus") }
                    .buttonStyle(.borderless).foregroundStyle(theme.accent)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .sheet(item: $request) { request in
            EventStepActionSheet(request: request) { note, payload in await perform(request.step, request.action, note: note, payload: payload) }
                .warehouseSheetStyle(workspace)
        }
        .sheet(isPresented: $helpOpen) {
            EventStepsHelpSheet(store: store, eventID: eventID, myRoles: snapshot.my_roles).warehouseSheetStyle(workspace)
        }
        .sheet(isPresented: $addOpen) {
            AddEventStepSheet(store: store, eventID: eventID).warehouseSheetStyle(workspace)
        }
    }

    // MARK: Czekamy na
    private func waitingBox(_ waiting: [EventStep], allClosed: Bool) -> some View {
        let visible = showAllWaiting ? waiting : Array(waiting.prefix(waitingPreview))
        return VStack(alignment: .leading, spacing: 6) {
            Text("CZEKAMY NA").font(.caption.weight(.semibold)).foregroundStyle(theme.accent).tracking(0.6)
            if waiting.isEmpty {
                Text(allClosed ? "Wszystkie kroki są zamknięte." : "Nic nie jest teraz do zrobienia — pozostałe kroki czekają na wcześniejsze.")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(visible) { step in waitingRow(step) }
            }
            if waiting.count > waitingPreview {
                Button(showAllWaiting ? "Pokaż mniej" : "Pokaż wszystkie (\(waiting.count))") { showAllWaiting.toggle() }
                    .buttonStyle(.link).linkCursor().font(.caption)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.15), in: RoundedRectangle(cornerRadius: 9))
    }
    private func waitingRow(_ step: EventStep) -> some View {
        let due = EventStepRules.dueLabel(step)
        return HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(step.title).font(.callout)
                    if step.mine { Text("Twój krok").font(.caption).foregroundStyle(theme.accent) }
                }
                waitingMeta(step, due: due).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if let phone = EventStepRules.telURL(step.assignee?.phone) {
                Button { NSWorkspace.shared.open(phone) } label: { Label("Zadzwoń", systemImage: "phone").font(.caption) }
                    .buttonStyle(.borderless).foregroundStyle(theme.accent)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 7))
                    .help("Zadzwoń: \(step.assignee?.name ?? EventStepRules.roles[step.owner_role] ?? "")")
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(step.status == "problem" ? CrmTheme.rgb(0xef4444).opacity(0.1) : step.isOverdue ? CrmTheme.rgb(0xfbbf24).opacity(0.1) : Color.primary.opacity(0.03),
                    in: RoundedRectangle(cornerRadius: 7))
    }

    private func waitingMeta(_ step: EventStep, due: String) -> Text {
        var text = Text(EventStepRules.ownerLabel(step))
        if !due.isEmpty {
            let dueText = Text(due).fontWeight(step.isOverdue ? .medium : .regular)
            text = text + Text(" · ") + (step.isOverdue ? dueText.foregroundColor(CrmTheme.rgb(0xfcd34d)) : dueText)
        }
        if step.status == "problem" { text = text + Text(" · problem").foregroundColor(CrmTheme.rgb(0xfca5a5)) }
        return text
    }

    // MARK: Etapy
    private func stageGroup(_ stage: String, _ label: String, _ steps: [EventStep], progress: EventStepProgress?) -> some View {
        let open = stageOverrides[stage] ?? steps.contains { $0.live }
        return VStack(alignment: .leading, spacing: 8) {
            Button { stageOverrides[stage] = !open } label: {
                HStack {
                    Text(label.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(theme.accent).tracking(0.6)
                    Spacer()
                    if let progress { Text("\(progress.done)/\(progress.total)").font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                    Image(systemName: "chevron.down").font(.caption).foregroundStyle(.secondary).rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.horizontal, 6).padding(.vertical, 4).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                ForEach(steps) { step in
                    EventStepRowView(step: step, pendingAction: pending?.step == step.id ? pending?.action : nil, disabled: pending != nil,
                                     onAction: { trigger(step, $0) }, onNavigate: onNavigate, canOpenTab: canOpenTab)
                }
            }
        }
    }

    // MARK: Czynności (`useEventStepActions`)
    private func trigger(_ step: EventStep, _ action: String) {
        guard pending == nil else { return }
        if EventStepRules.needsForm(step, action) { request = EventStepRequest(step: step, action: action); return }
        Task {
            if let error = await perform(step, action, note: "", payload: [:]) { workspace.error = error }
        }
    }
    /// Zwraca komunikat błędu albo `nil` po sukcesie.
    private func perform(_ step: EventStep, _ action: String, note: String, payload: [String: JSONValue]) async -> String? {
        guard pending == nil else { return nil }
        pending = (step.id, action)
        defer { pending = nil }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let data = try await workspace.withPending("Zapisywanie…") {
                try await store.rpc("update_event_step", [
                    "p_step_id": .string(step.id), "p_action": .string(action),
                    "p_note": trimmed.isEmpty ? .null : .string(trimmed), "p_payload": .object(payload),
                ])
            }
            if let snapshot = try? JSONDecoder().decode(EventStepsSnapshot.self, from: data) {
                store.applySteps(eventID, snapshot)
            } else {
                await store.loadOverview(eventID)
            }
            workspace.succeed(EventStepRules.successMessages[action] ?? "Zapisano.")
            return nil
        } catch {
            return store.stepError(error)
        }
    }
}

// MARK: Wiersz kroku

@MainActor struct EventStepRowView: View {
    let step: EventStep
    var pendingAction: String?
    var disabled = false
    var onAction: (String) -> Void
    var onNavigate: (String) -> Void
    var canOpenTab: (String) -> Bool
    @Environment(\.crmTheme) private var theme
    @State private var expanded = false

    var body: some View {
        let tone = EventStepRules.tone(step)
        let chip = EventStepRules.chip(tone)
        let actions = EventStepRules.actions(step)
        let primary = actions.isEmpty ? nil : EventStepRules.primary(step, actions)
        let link = step.live ? EventStepRules.contextLink(step.key) : nil
        let context = link.flatMap { canOpenTab($0.tab) ? $0 : nil }
        let due = EventStepRules.dueLabel(step)
        let history = step.history ?? []
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Text(EventStepRules.statuses[step.status] ?? step.status).font(.caption2.weight(.medium))
                    .padding(.horizontal, 8).padding(.vertical, 2).background(chip.0, in: Capsule()).foregroundStyle(chip.1)
                if step.mine && step.live {
                    Text("Twój krok").font(.caption2).padding(.horizontal, 8).padding(.vertical, 2)
                        .background(theme.accent.opacity(0.15), in: Capsule()).foregroundStyle(theme.accent)
                }
                Text(EventStepRules.kinds[step.kind] ?? step.kind).font(.caption).foregroundStyle(.tertiary)
                if step.blocks_ready == true && step.live && step.stage == "preparation" {
                    Text("· wymagane przed gotowością magazynu").font(.caption).foregroundStyle(.tertiary)
                }
            }
            Text(step.title).font(.callout.weight(.medium)).foregroundStyle(step.live ? Color.primary : Color.secondary).textSelection(.enabled)
            WrapLine(spacing: 14) {
                HStack(spacing: 4) {
                    Text("Odpowiada: \(EventStepRules.ownerLabel(step))")
                    if step.live, let phone = EventStepRules.telURL(step.assignee?.phone) {
                        Button { NSWorkspace.shared.open(phone) } label: { Image(systemName: "phone") }
                            .buttonStyle(.borderless).foregroundStyle(theme.accent)
                            .help("Zadzwoń: \(step.assignee?.name ?? EventStepRules.roles[step.owner_role] ?? "")")
                    }
                }
                if !due.isEmpty {
                    Text(Self.dueText(due))
                        .fontWeight(step.isOverdue && step.live ? .medium : .regular)
                        .foregroundStyle(step.isOverdue && step.live ? CrmTheme.rgb(0xfcd34d) : Color.secondary)
                }
                ForEach(meta, id: \.self) { Text($0) }
            }
            .font(.caption).foregroundStyle(.secondary)
            if let note = step.status_note, !note.isEmpty {
                (Text("\(Self.notePrefix(step.status)): ").foregroundColor(.secondary) + Text(note))
                    .font(.caption).textSelection(.enabled)
                    .padding(.horizontal, 9).padding(.vertical, 5).frame(maxWidth: .infinity, alignment: .leading)
                    .background(step.status == "problem" ? CrmTheme.rgb(0xef4444).opacity(0.1) : Color.black.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
            }
            if !step.blockers.isEmpty && step.live {
                Label {
                    Text("Czeka na: " + step.blockers.map { "\($0.title) (\(EventStepRules.roles[$0.owner_role] ?? "inna rola"))" }.joined(separator: ", "))
                } icon: { Image(systemName: "lock").foregroundStyle(.tertiary) }
                .font(.caption).foregroundStyle(.secondary)
            }
            if !actions.isEmpty || context != nil {
                WrapLine(spacing: 8) {
                    ForEach(actions, id: \.self) { action in actionButton(action, primary: action == primary) }
                    if let context {
                        Button { onNavigate(context.tab) } label: {
                            Label(context.label, systemImage: EventStepRules.tabSymbols[context.tab] ?? "doc.text").font(.caption)
                        }
                        .buttonStyle(.borderless).foregroundStyle(theme.accent)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 7))
                        .help("Przejdź do zakładki: \(context.label)")
                    }
                }
                .padding(.top, 4)
            }
            if (step.details?.isEmpty == false) || !history.isEmpty {
                Button { expanded.toggle() } label: {
                    Label(expanded ? "Ukryj szczegóły" : (step.details?.isEmpty == false && !history.isEmpty) ? "Szczegóły i historia" : step.details?.isEmpty == false ? "Szczegóły" : "Historia",
                          systemImage: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                }
                .buttonStyle(.borderless).foregroundStyle(.secondary)
                if expanded {
                    if let details = step.details, !details.isEmpty {
                        Text(details).font(.caption).textSelection(.enabled)
                            .padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.black.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
                    }
                    ForEach(Array(history.enumerated()), id: \.offset) { _, entry in
                        VStack(alignment: .leading, spacing: 2) {
                            historyLine(entry)
                            if let note = entry.note, !note.isEmpty { Text(note).foregroundStyle(Color.primary.opacity(0.75)) }
                        }
                        .font(.caption).foregroundStyle(.secondary)
                        .padding(.horizontal, 10).padding(.vertical, 5).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(EventStepRules.rowFill(tone), in: RoundedRectangle(cornerRadius: 9))
    }

    private func historyLine(_ entry: EventStepHistory) -> Text {
        let label = Text(EventStepRules.historyLabel(entry))
        guard let status = entry.to_status else { return label }
        return label + Text(" → \(EventStepRules.statuses[status] ?? status)").foregroundColor(Color.secondary.opacity(0.7))
    }

    static func notePrefix(_ status: String) -> String {
        switch status { case "problem": return "Problem"; case "skipped": return "Powód pominięcia"; default: return "Notatka" }
    }

    static func dueText(_ due: String) -> String {
        if due.hasPrefix("do ") || due.hasPrefix("dziś") { return "Termin: \(due)" }
        return due.prefix(1).uppercased() + String(due.dropFirst())
    }

    private var meta: [String] {
        var items: [String] = []
        let quantity = EventStepRules.quantityLabel(step)
        if !quantity.isEmpty { items.append("Ilość: \(quantity)") }
        if let supplier = step.supplier, !supplier.isEmpty { items.append("Dostawca: \(supplier)") }
        if step.ordered_at != nil { items.append("Zamówiono: \(EventStepRules.date(step.ordered_at))") }
        if step.expected_at != nil { items.append("Dostawa: \(EventStepRules.date(step.expected_at))") }
        if step.completed_at != nil && (step.status == "done" || step.status == "skipped") {
            let who = [step.completed_by_name ?? "", EventStepRules.date(step.completed_at)].filter { !$0.isEmpty }.joined(separator: " · ")
            items.append("\(step.status == "skipped" ? "Pominięte" : "Zamknięte"): \(who)")
        }
        return items
    }

    private func actionColors(_ action: String, primary: Bool) -> (Color, Color) {
        if primary { return (theme.accent, CrmTheme.rgb(0x210811)) }
        switch action {
        case "take": return (theme.accent.opacity(0.15), theme.accent)
        case "problem": return (CrmTheme.rgb(0xef4444).opacity(0.1), CrmTheme.rgb(0xfecaca))
        case "skip": return (Color.clear, Color.secondary)
        default: return (Color.primary.opacity(0.05), Color.primary.opacity(0.85))
        }
    }

    private func actionButton(_ action: String, primary: Bool) -> some View {
        let blocked = EventStepRules.blocked(step, action)
        let isPending = pendingAction == action
        let colors = actionColors(action, primary: primary)
        return Button { onAction(action) } label: {
            HStack(spacing: 5) {
                if isPending { ProgressView().controlSize(.mini) }
                if blocked { Image(systemName: "lock") }
                Text(isPending ? "Zapisywanie…" : EventStepRules.actionLabel(step, action))
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .foregroundStyle(colors.1)
            .background(colors.0, in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled || pendingAction != nil || blocked)
        .opacity(disabled || pendingAction != nil || blocked ? 0.45 : 1)
        .help(blocked ? "Najpierw muszą być zamknięte: \(step.blockers.map(\.title).joined(separator: ", "))" : "")
    }
}

/// Elementy w wierszu z zawijaniem (jak `flex-wrap`).
struct WrapLine: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 4
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let finite = proposal.width.flatMap { $0.isFinite ? $0 : nil }
        let width = finite ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { y += line + lineSpacing; x = 0; line = 0 }
            x += size.width + spacing; line = max(line, size.height); widest = max(widest, x - spacing)
        }
        return CGSize(width: finite ?? widest, height: y + line)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { y += line + lineSpacing; x = bounds.minX; line = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing; line = max(line, size.height)
        }
    }
}
