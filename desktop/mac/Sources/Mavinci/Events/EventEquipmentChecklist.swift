import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Checklista sprzętu w trzech etapach (1:1 z `EquipmentChecklistBar`, `EquipmentRowChecklist`, `EquipmentLineEditors`,
// `EquipmentNoteDialog`): wydanie → po wydarzeniu → zwrot, zgody na braki, potwierdzenia, cofnięcia etapów, historia zmian.

/// Kontekst checklisty dla wiersza sprzętu (`EquipmentRowChecklist`).
struct EquipmentRowChecklist {
    let line: EquipmentChecklist.Line
    let stage: EquipmentStage
    let editable: Bool
    let busy: Bool
    let people: [String: EquipmentChecklist.Person]
    var done: Bool { EquipmentRules.done(line, stage) }
    var tone: EquipmentRules.Tone { EquipmentRules.tone(line, stage) }
    /// `equipmentRowTint`.
    var tint: Color? {
        switch tone {
        case .ok: return Color.green.opacity(0.07)
        case .pending: return Color.orange.opacity(0.11)
        case .shortage, .missing, .damaged: return Color.red.opacity(0.11)
        default: return nil
        }
    }
}

/// Awatar osoby z checklisty (`EquipmentPersonAvatar`).
struct EquipmentPersonAvatar: View {
    let person: EquipmentChecklist.Person?
    let name: String?
    var size: CGFloat = 16
    var body: some View {
        EmployeeAvatarView(name: person?.name ?? name ?? "Pracownik", url: person?.avatar_url, crop: person?.avatar, size: size)
    }
}

// MARK: Pasek etapów

private enum ChecklistAction: String, Identifiable {
    case requestApproval, approve, reject, confirmDispatch, requestUnlock, confirmLoadback, confirmReturn, ackIssues, reopen
    var id: String { rawValue }
}

private struct NoteSpec {
    var title: String
    var description: String
    var label: String
    var placeholder: String = ""
    var required: Bool
    var minLength: Int
    var maxLength: Int
    var submitLabel: String
    var danger = false
    var initialNote = ""
    var success: String
    var rpc: String
    var params: (String) -> [String: JSONValue]
}

@MainActor struct EquipmentChecklistBar: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let tab: EquipmentChecklistTab?
    let stage: EquipmentStage?
    @Binding var pick: EquipmentStage?
    let legacy: (loaded: Int, total: Int, confirmed: Bool, confirmedAt: String?)
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var action: ChecklistAction?
    @State private var actionError = ""
    @State private var reopenNote = ""
    @State private var historyOpen = false
    @State private var fillTarget: EquipmentStage?

    var body: some View {
        if let tab {
            if tab.status == "missing" {
                missing
            } else if let c = tab.checklist {
                if c.stage != "empty", let stage { bar(c, stage) }
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
                    Text(tab.error ?? "Nie udało się wczytać checklisty sprzętu.").font(.callout)
                    Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "equipment-checklist") } }.buttonStyle(.link)
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
        } else if let error = store.tabErrors["\(eventID)|equipment-checklist"] {
            HStack(spacing: 8) {
                Text(error).font(.callout).foregroundStyle(.red)
                Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "equipment-checklist") } }.buttonStyle(.link)
            }
        } else {
            Text("Wczytywanie checklisty sprzętu…").font(.callout).foregroundStyle(.secondary)
        }
    }

    private var missing: some View {
        var text = "Checklista wymaga migracji 20261105170000_event_equipment_checklist.sql"
        if legacy.total > 0 {
            text += " · dawna lista: załadowano \(legacy.loaded)/\(legacy.total)"
            if legacy.confirmed { text += ", potwierdzony \(EquipmentRules.date(legacy.confirmedAt))" }
        }
        return Text(text).font(.callout).foregroundStyle(.secondary)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private var stageBusy: Bool { store.checklistBusy.contains { $0.hasPrefix("stage:") } }

    private func bar(_ c: EquipmentChecklist, _ stage: EquipmentStage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                HStack(spacing: 6) {
                    ForEach(EquipmentStage.allCases) { tabButton(c, $0, selected: $0 == stage) }
                }
                Spacer(minLength: 4)
                menu(c)
            }
            HStack(alignment: .center, spacing: 10) {
                hint(c, stage).frame(maxWidth: .infinity, alignment: .leading)
                buttons(c, stage)
            }
            if c.dispatch.unlock_requested { unlockBanner(c) }
            if c.can.approve_shortages, !decidable(c).isEmpty { shortageBanner(c) }
            if c.can.ack_issues { issuesBanner(c) }
        }
        .padding(12)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .sheet(item: $action) { kind in
            EquipmentNoteDialog(spec: spec(kind, c), busy: store.checklistBusy.contains("stage:\(kind.rawValue)"), error: $actionError,
                                submitDisabled: kind == .reopen && EquipmentRules.reopenable(c) == nil,
                                onCancel: { action = nil; actionError = "" },
                                onSubmit: { note in Task { await submit(kind, c, note) } })
                .warehouseSheetStyle(state)
        }
        .sheet(isPresented: $historyOpen) { EquipmentChecklistHistory(log: c.log).warehouseSheetStyle(state) }
        .confirmationDialog(fillCopy(fillTarget).title, isPresented: Binding(get: { fillTarget != nil }, set: { if !$0 { fillTarget = nil } }), titleVisibility: .visible) {
            Button(fillCopy(fillTarget).title) { if let target = fillTarget { Task { await fill(target) } } }
            Button("Anuluj", role: .cancel) { fillTarget = nil }
        } message: { Text(fillCopy(fillTarget).message) }
    }

    private func tabButton(_ c: EquipmentChecklist, _ key: EquipmentStage, selected: Bool) -> some View {
        let progress = EquipmentRules.progress(c, key)
        let conf = EquipmentRules.confirmation(c, key)
        let person = conf.by.flatMap { c.people[$0] }
        let issuesOpen = key == .giveBack && c.stage == "issues"
        let tint: Color = selected ? theme.accent.opacity(0.18)
            : (conf.at != nil && !issuesOpen) ? Color.green.opacity(0.10)
            : (progress.problems > 0 || issuesOpen) ? Color.red.opacity(0.12) : Color.primary.opacity(0.05)
        return Button { pick = key } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(key.label).font(.callout.weight(.semibold))
                    Text("\(progress.done)/\(progress.total)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                HStack(spacing: 5) {
                    if conf.at != nil {
                        EquipmentPersonAvatar(person: person, name: conf.name, size: 16)
                        Text(issuesOpen ? "rozbieżności do przyjęcia" : EquipmentRules.shortDate(conf.at)).font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text(key.owner).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .frame(minWidth: 150, alignment: .leading)
            .background(tint, in: RoundedRectangle(cornerRadius: 9))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(conf.at != nil ? EquipmentRules.byLine(person?.name ?? conf.name, conf.at) : "\(key.label) — \(key.owner)")
    }

    private func menu(_ c: EquipmentChecklist) -> some View {
        let reopenable = c.can.reopen ? EquipmentRules.reopenable(c) : nil
        return Menu {
            if c.can.request_unlock {
                Button("Poproś o odblokowanie wydania", systemImage: "lock.open") { open(.requestUnlock) }.disabled(stageBusy)
            }
            if let reopenable {
                Button("Cofnij etap: \(reopenable.label)", systemImage: "arrow.uturn.backward") { open(.reopen) }.disabled(stageBusy)
            }
            Button("Historia zmian (\(c.log.count))", systemImage: "clock.arrow.circlepath") { historyOpen = true }
            Button("Odśwież", systemImage: "arrow.clockwise") { Task { await store.loadTab(eventID, "equipment-checklist") } }.disabled(stageBusy)
        } label: { Image(systemName: "ellipsis.circle") }
            .menuStyle(.borderlessButton).fixedSize()
            .help("Więcej: odblokowanie, cofnięcie etapu, historia")
    }

    @ViewBuilder private func hint(_ c: EquipmentChecklist, _ stage: EquipmentStage) -> some View {
        let current = EquipmentRules.defaultStage(c)
        let conf = EquipmentRules.confirmation(c, stage)
        if stage == current, !c.blockers.isEmpty, conf.at == nil {
            Label(c.blockers.joined(separator: " · "), systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.orange)
        } else if conf.at != nil {
            HStack(spacing: 5) {
                if stage == .dispatch { Image(systemName: "lock.fill").font(.caption) }
                Text(confirmationText(stage, conf)).font(.callout)
            }
            .foregroundStyle(.green)
        } else if stage != .dispatch && c.dispatch.confirmed_at == nil {
            Text("Etap otworzy się po potwierdzeniu wydania.").font(.callout).foregroundStyle(.secondary)
        } else if stage == .loadback && c.returning.confirmed_at != nil {
            Text("Zwrot zatwierdzono bez załadunku po wydarzeniu.").font(.callout).foregroundStyle(.secondary)
        } else if stage == .giveBack && c.stage == "loadback" {
            Text("Zwrot możesz sprawdzić przed zatwierdzeniem załadunku po wydarzeniu — podstawą jest ilość wydana.").font(.callout).foregroundStyle(.secondary)
        } else {
            Text(EquipmentRules.stageHints[c.stage] ?? "").font(.callout).foregroundStyle(.secondary)
        }
    }

    private func confirmationText(_ stage: EquipmentStage, _ conf: (at: String?, by: String?, name: String?, note: String?)) -> String {
        var text = "\(stage.label): zatwierdził(a) \(EquipmentRules.byLine(conf.name, conf.at))"
        if stage == .dispatch { text += " — lista zablokowana" }
        if let note = conf.note?.nonEmpty { text += " · „\(note)”" }
        return text
    }

    @ViewBuilder private func buttons(_ c: EquipmentChecklist, _ stage: EquipmentStage) -> some View {
        HStack(spacing: 6) {
            if stage == .dispatch && c.can.pack {
                if c.summary.unchecked_dispatch > 0 { Button("Wszystko zgodne") { fillTarget = .dispatch }.disabled(stageBusy) }
                if c.can.request_approval { Button("Poproś o zgodę na braki") { open(.requestApproval) }.disabled(stageBusy) }
                Button { open(.confirmDispatch) } label: { Label("Potwierdź wydanie", systemImage: "checkmark.circle") }
                    .buttonStyle(.borderedProminent).disabled(stageBusy || !c.can.confirm_dispatch)
                    .help(c.can.confirm_dispatch ? "" : c.blockers.joined(separator: " · "))
            }
            if stage == .loadback && c.can.loadback {
                if c.summary.loadback_unchecked > 0 { Button("Wszystko wraca") { fillTarget = .loadback }.disabled(stageBusy) }
                Button { open(.confirmLoadback) } label: { Label("Zatwierdź załadunek po wydarzeniu", systemImage: "checkmark.circle") }
                    .buttonStyle(.borderedProminent).disabled(stageBusy || !c.can.confirm_loadback)
                    .help(c.can.confirm_loadback ? "" : c.blockers.joined(separator: " · "))
            }
            if stage == .giveBack && c.can.returning {
                if c.summary.return_unchecked > 0 { Button("Wszystko wróciło sprawne") { fillTarget = .giveBack }.disabled(stageBusy) }
                Button { open(.confirmReturn) } label: { Label("Zatwierdź zwrot", systemImage: "checkmark.circle") }
                    .buttonStyle(.borderedProminent).disabled(stageBusy || !c.can.confirm_return)
                    .help(c.can.confirm_return ? "" : (c.blockers.joined(separator: " · ").nonEmpty ?? "Sprawdź wszystkie wydane pozycje."))
            }
        }
        .controlSize(.small)
    }

    private func decidable(_ c: EquipmentChecklist) -> [EquipmentChecklist.Line] {
        c.lines.filter { $0.shortage_status == "pending" || $0.shortage_status == "rejected" }
    }
    private func returnIssues(_ c: EquipmentChecklist) -> [EquipmentChecklist.Line] {
        c.lines.filter { $0.shipped_qty > 0 && $0.return_ok_qty != nil && (($0.return_damaged_qty ?? 0) > 0 || ($0.return_missing_qty ?? 0) > 0) }
    }

    private func unlockBanner(_ c: EquipmentChecklist) -> some View {
        let reopenable = c.can.reopen ? EquipmentRules.reopenable(c) : nil
        let at = c.dispatch.unlock_requested_at.map { " (" + EquipmentRules.shortDate($0) + ")" } ?? ""
        let reason = c.dispatch.unlock_reason ?? ""
        return HStack(spacing: 10) {
            (Text("Prośba o odblokowanie wydania").bold() + Text(at + ": " + reason)
                + Text(reopenable != .dispatch ? " · czeka na administratora" : "").foregroundColor(.secondary))
                .font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            if reopenable == .dispatch {
                Button("Cofnij wydanie") { open(.reopen, note: c.dispatch.unlock_reason.map { "Prośba: \($0)" } ?? "") }
                    .disabled(stageBusy).controlSize(.small)
            }
        }
        .padding(10).background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
    }

    private func shortageBanner(_ c: EquipmentChecklist) -> some View {
        let lines = decidable(c)
        let list = lines.map { line -> String in
            let packed = line.packed_qty.map { String($0) } ?? "–"
            let reason = line.shortage_reason.map { " — " + $0 } ?? ""
            return line.name + " " + packed + "/" + String(line.quantity) + reason
        }.joined(separator: "; ")
        let note = c.dispatch.shortage_request_note.map { " · magazyn: \($0)" } ?? ""
        return HStack(spacing: 10) {
            (Text("Braki do zgody (\(lines.count)): ").bold() + Text(list) + Text(note).foregroundColor(.secondary))
                .font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            Button("Zgoda na braki") { open(.approve) }.buttonStyle(.borderedProminent).disabled(stageBusy)
            Button("Odmów", role: .destructive) { open(.reject) }.disabled(stageBusy)
        }
        .controlSize(.small)
        .padding(10).background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
    }

    private func issuesBanner(_ c: EquipmentChecklist) -> some View {
        let list = returnIssues(c).map { line -> String in
            [line.name, (line.return_damaged_qty ?? 0) > 0 ? "uszk. \(line.return_damaged_qty ?? 0)" : "",
             (line.return_missing_qty ?? 0) > 0 ? "brak \(line.return_missing_qty ?? 0)" : ""].filter { !$0.isEmpty }.joined(separator: " ")
        }.joined(separator: "; ")
        return HStack(spacing: 10) {
            (Text("Rozbieżności w zwrocie (\(c.returning.issue_count)): ").bold() + Text(list)).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            Button("Przyjmij rozbieżności") { open(.ackIssues) }.buttonStyle(.borderedProminent).controlSize(.small).disabled(stageBusy)
        }
        .padding(10).background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
    }

    // MARK: Czynności etapu

    private func open(_ kind: ChecklistAction, note: String = "") {
        actionError = ""
        reopenNote = note
        action = kind
    }

    private func spec(_ kind: ChecklistAction, _ c: EquipmentChecklist) -> NoteSpec {
        let event = JSONValue.string(eventID)
        let optional: (String) -> JSONValue = { $0.isEmpty ? .null : .string($0) }
        let reopenable = EquipmentRules.reopenable(c)
        switch kind {
        case .requestApproval:
            return NoteSpec(title: "Poproś o zgodę na braki",
                            description: "Sprzedawca wydarzenia i administratorzy dostaną powiadomienie z listą braków (\(c.summary.shortages_pending + c.summary.shortages_rejected)).",
                            label: "Notatka dla sprzedawcy", placeholder: "np. co proponujesz zamiast brakującego sprzętu", required: false, minLength: 0,
                            maxLength: 1000, submitLabel: "Wyślij prośbę", success: "Wysłano prośbę o zgodę na braki.", rpc: "request_event_equipment_shortage_approval",
                            params: { ["p_event": event, "p_note": optional($0)] })
        case .approve:
            let lines = EquipmentRules.decisionLines(c)
            return NoteSpec(title: "Zgoda na braki", description: "Magazyn będzie mógł potwierdzić wydanie z tymi brakami.", label: "Notatka", required: false,
                            minLength: 0, maxLength: 1000, submitLabel: "Zgoda na braki", success: "Zaakceptowano braki — magazyn może wydać sprzęt.",
                            rpc: "decide_event_equipment_shortages",
                            params: { ["p_event": event, "p_approve": .bool(true), "p_note": optional($0), "p_lines": lines] })
        case .reject:
            let lines = EquipmentRules.decisionLines(c)
            return NoteSpec(title: "Brak zgody na braki", description: "Wydanie zostanie zablokowane, dopóki magazyn nie uzupełni sprzętu albo nie poprosi ponownie.",
                            label: "Co magazyn ma zrobić?", placeholder: "np. dowieźć, wynająć, zamienić", required: true, minLength: 3, maxLength: 1000,
                            submitLabel: "Odmów", danger: true, success: "Odmówiono zgody na braki — magazyn dostał powiadomienie.",
                            rpc: "decide_event_equipment_shortages",
                            params: { ["p_event": event, "p_approve": .bool(false), "p_note": .string($0), "p_lines": lines] })
        case .confirmDispatch:
            return NoteSpec(title: "Potwierdź wydanie",
                            description: "Potwierdzenie blokuje listę — późniejsza zmiana wymaga cofnięcia przez administratora. Kierownik realizacji dostanie powiadomienie.",
                            label: "Notatka do wydania", required: false, minLength: 0, maxLength: 2000, submitLabel: "Potwierdź wydanie",
                            success: "Wydanie potwierdzone.", rpc: "confirm_event_equipment_dispatch", params: { ["p_event": event, "p_note": optional($0)] })
        case .requestUnlock:
            return NoteSpec(title: "Poproś o odblokowanie wydania",
                            description: "Administratorzy dostaną powiadomienie. Do czasu cofnięcia wydania lista pozostaje zablokowana.",
                            label: "Co trzeba zmienić w wydaniu?", placeholder: "np. dołożono drugi mikrofon, pomyłka w ilości kabli", required: true,
                            minLength: 5, maxLength: 1000, submitLabel: "Wyślij prośbę", success: "Prośba o odblokowanie wysłana do administratorów.",
                            rpc: "request_event_equipment_unlock", params: { ["p_event": event, "p_reason": .string($0)] })
        case .confirmLoadback:
            let missing = c.summary.loadback_missing
            return NoteSpec(title: "Zatwierdź załadunek po wydarzeniu",
                            description: missing > 0 ? "Rozbieżności (\(missing)) trafią do magazynu, sprzedawcy i administratorów." : "Magazyn dostanie powiadomienie, że sprzęt wraca w komplecie.",
                            label: "Notatka", required: false, minLength: 0, maxLength: 2000, submitLabel: "Zatwierdź załadunek",
                            success: "Załadunek po wydarzeniu zatwierdzony.", rpc: "confirm_event_equipment_loadback", params: { ["p_event": event, "p_note": optional($0)] })
        case .confirmReturn:
            let issues = returnIssues(c).count
            return NoteSpec(title: "Zatwierdź zwrot",
                            description: issues > 0 ? "Rozbieżności (\(issues)) trafią do sprzedawcy i administratorów — przyjmą je z decyzją, co dalej." : "Zwrot bez rozbieżności zamyka krok „Przyjmij zwrot i sprawdź sprzęt”.",
                            label: "Notatka", required: false, minLength: 0, maxLength: 2000, submitLabel: "Zatwierdź zwrot",
                            success: "Zwrot zatwierdzony.", rpc: "confirm_event_equipment_return", params: { ["p_event": event, "p_note": optional($0)] })
        case .ackIssues:
            return NoteSpec(title: "Przyjmij rozbieżności", description: "Napisz decyzję — magazyn dostanie powiadomienie, a krok zwrotu się zamknie.",
                            label: "Decyzja", placeholder: "np. obciążamy klienta, naprawa na nasz koszt, sprzęt odnaleziony", required: true, minLength: 5,
                            maxLength: 1000, submitLabel: "Przyjmij rozbieżności", success: "Rozbieżności przyjęte.",
                            rpc: "acknowledge_event_equipment_return_issues", params: { ["p_event": event, "p_note": .string($0)] })
        case .reopen:
            let stageValue: JSONValue = reopenable.map { .string($0.rawValue) } ?? .null
            return NoteSpec(title: "Cofnij etap: \(reopenable?.label ?? "")",
                            description: "Etapy cofa się od końca: zwrot → po wydarzeniu → wydanie. Cofnięcie przywraca otwarte kroki realizacji.",
                            label: "Powód", placeholder: "np. pomyłka w ilości, sprzęt odnaleziony", required: true, minLength: 5, maxLength: 1000,
                            submitLabel: "Cofnij etap", danger: true, initialNote: reopenNote, success: "Etap cofnięty.",
                            rpc: "reopen_event_equipment_stage", params: { ["p_event": event, "p_stage": stageValue, "p_reason": .string($0)] })
        }
    }

    private func submit(_ kind: ChecklistAction, _ c: EquipmentChecklist, _ note: String) async {
        let s = spec(kind, c)
        actionError = ""
        if let error = await store.checklistRun(eventID, key: "stage:\(kind.rawValue)", name: s.rpc, params: s.params(note)) {
            actionError = error
            return
        }
        state.succeed(s.success)
        action = nil
        pick = nil
    }

    private func fillCopy(_ target: EquipmentStage?) -> (title: String, message: String, success: String) {
        switch target {
        case .loadback?:
            return ("Wszystko wraca", "Nieodhaczone pozycje zostaną oznaczone jako wracające w komplecie (tyle, ile wydano). Wpisane już ilości zostaną bez zmian.",
                    "Nieodhaczone pozycje oznaczono jako wracające w komplecie.")
        case .giveBack?:
            return ("Wszystko wróciło sprawne", "Nieodhaczone pozycje zostaną oznaczone jako sprawne w pełnej wydanej ilości. Pozycje z brakiem po wydarzeniu trzeba wpisać ręcznie z opisem.",
                    "Nieodhaczone pozycje oznaczono jako sprawne.")
        default:
            return ("Wszystko zgodne", "Nieodhaczone pozycje wymagane zostaną oznaczone jako spakowane w pełnej ilości. Wpisane już ilości zostaną bez zmian.",
                    "Uzupełniono nieodhaczone pozycje pełną ilością.")
        }
    }

    private func fill(_ target: EquipmentStage) async {
        let copy = fillCopy(target)
        fillTarget = nil
        if let error = await store.checklistRun(eventID, key: "stage:fill:\(target.rawValue)", name: "fill_event_equipment_stage",
                                                params: ["p_event": .string(eventID), "p_stage": .string(target.rawValue)]) {
            state.error = error
        } else {
            state.succeed(copy.success)
        }
    }
}

// MARK: Okno notatki do czynności (`EquipmentNoteDialog`)

private struct EquipmentNoteDialog: View {
    let spec: NoteSpec
    let busy: Bool
    @Binding var error: String
    let submitDisabled: Bool
    let onCancel: () -> Void
    let onSubmit: (String) -> Void
    @State private var note = ""
    @State private var localError = ""
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(spec.title).font(.title3.weight(.semibold))
            if !spec.description.isEmpty { Text(spec.description).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            VStack(alignment: .leading, spacing: 4) {
                (Text(spec.label) + Text(spec.required ? " *" : "").foregroundColor(.red)).font(.callout.weight(.medium))
                TextEditor(text: $note)
                    .font(.body).frame(minHeight: 90)
                    .scrollContentBackground(.hidden).padding(6)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                    .disabled(busy)
                    .overlay(alignment: .topLeading) {
                        if note.isEmpty && !spec.placeholder.isEmpty {
                            Text(spec.placeholder).foregroundStyle(.tertiary).padding(.horizontal, 11).padding(.vertical, 6).allowsHitTesting(false)
                        }
                    }
                    .onChange(of: note) { _, _ in localError = "" }
                HStack {
                    Text(spec.required ? "Wymagane, co najmniej \(max(1, spec.minLength)) znaków." : "Opcjonalnie.")
                    Spacer()
                    Text("\(note.count)/\(spec.maxLength)").monospacedDigit()
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            if let shown = (localError.nonEmpty ?? error.nonEmpty) {
                Text(shown).font(.callout).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Anuluj") { onCancel() }.keyboardShortcut(.cancelAction).disabled(busy)
                Button(busy ? "Zapisywanie…" : spec.submitLabel, role: spec.danger ? ButtonRole.destructive : nil) { submit() }
                    .buttonStyle(.borderedProminent).tint(spec.danger ? .red : theme.accent)
                    .keyboardShortcut(.defaultAction).disabled(busy || submitDisabled)
            }
        }
        .padding(20).frame(width: 480)
        .onAppear { note = spec.initialNote; localError = "" }
    }

    private func submit() {
        guard !busy, !submitDisabled else { return }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if spec.required && trimmed.count < max(1, spec.minLength) {
            localError = "\(spec.label): wpisz co najmniej \(max(1, spec.minLength)) znaków."
            return
        }
        if trimmed.count > spec.maxLength {
            localError = "Notatka może mieć najwyżej \(spec.maxLength) znaków."
            return
        }
        localError = ""
        onSubmit(trimmed)
    }
}

// MARK: Historia checklisty

private struct EquipmentChecklistHistory: View {
    let log: [EquipmentChecklist.LogEntry]
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Historia checklisty sprzętu").font(.title3.weight(.semibold))
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            if log.isEmpty {
                Text("Brak zmian.").foregroundStyle(.secondary)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(log) { entry in row(entry) }
                    }
                }
            }
        }
        .padding(20).frame(width: 620, height: 520)
    }
    private func row(_ entry: EquipmentChecklist.LogEntry) -> some View {
        let detail = EquipmentRules.logDetail(entry)
        let stage = EquipmentStage(rawValue: entry.stage) ?? .dispatch
        return VStack(alignment: .leading, spacing: 3) {
            (Text(EquipmentRules.logLabel(entry)).bold()
                + Text(entry.line_name.map { " — \($0)" } ?? "")
                + Text(detail.isEmpty ? "" : " · \(detail)").foregroundColor(.secondary)).font(.callout)
            if let note = entry.note?.nonEmpty { Text("„\(note)”").font(.callout).italic() }
            Text("\(stage.label) · \(EquipmentRules.byLine(entry.actor_name, entry.created_at))").font(.caption).foregroundStyle(.secondary)
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Wiersz sprzętu — znacznik, plakietki, notatka i ilość etapu

/// Kółko etapu (`EquipmentRowTick`): kliknięcie zaznacza pełną ilość albo odznacza pozycję.
@MainActor struct EquipmentRowTick: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let context: EquipmentRowChecklist
    @EnvironmentObject private var state: Workspace

    var body: some View {
        let tone = context.tone
        let done = tone == .ok
        let problem = EquipmentRules.problem(tone) || tone == .pending
        let fill: Color = done ? .green : EquipmentRules.problem(tone) ? Color.red.opacity(0.3) : tone == .pending ? Color.orange.opacity(0.3) : Color.primary.opacity(0.1)
        let symbol = context.busy ? "" : done ? "checkmark" : problem ? "exclamationmark" : "checkmark"
        let icon = ZStack {
            Circle().fill(fill)
            if context.busy {
                ProgressView().controlSize(.mini)
            } else {
                Image(systemName: symbol).font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(done ? Color.black.opacity(0.85) : problem ? Color.primary : Color.clear)
            }
        }
        .frame(width: 22, height: 22)
        if context.editable {
            Button { Task { await toggle(done: done) } } label: { icon }
                .buttonStyle(.plain).disabled(context.busy)
                .help(done ? "Odznacz" : context.stage.fullLabel)
        } else {
            icon.help(done ? context.stage.done : "")
        }
    }

    private func toggle(done: Bool) async {
        let line = context.line
        let name: String
        var params: [String: JSONValue] = ["p_line": .string(line.id)]
        switch context.stage {
        case .dispatch:
            name = "set_event_equipment_packed"
            params["p_qty"] = done ? .null : .number(Double(line.quantity))
            params["p_reason"] = .null
        case .loadback:
            name = "set_event_equipment_loadback"
            params["p_qty"] = done ? .null : .number(Double(line.shipped_qty))
            params["p_note"] = .null
        case .giveBack:
            name = "set_event_equipment_return"
            params["p_ok"] = done ? .null : .number(Double(line.shipped_qty))
            params["p_damaged"] = .number(0)
            params["p_note"] = done ? .null : (line.return_note.map { JSONValue.string($0) } ?? .null)
            params["p_photos"] = .null
        }
        if let error = await store.checklistRun(eventID, key: "line:\(line.id)", name: name, params: params) { state.error = error }
    }
}

/// Plakietki etapu (`EquipmentRowBadges`).
struct EquipmentRowBadges: View {
    let context: EquipmentRowChecklist
    var body: some View {
        let line = context.line, stage = context.stage
        let actor = EquipmentRules.actor(line, stage)
        let person = actor.id.flatMap { context.people[$0] }
        let who = EquipmentRules.byLine(person?.name ?? actor.name, actor.at)
        let avatarInfo: (EquipmentChecklist.Person?, String?)? = (actor.id != nil || actor.name != nil) ? (person, actor.name) : nil
        let damagedCount = line.return_damaged_qty ?? 0
        let missingCount = line.return_missing_qty ?? 0
        HStack(spacing: 4) {
            if context.done {
                badge(.green, who, avatar: avatarInfo, stage.done)
            } else if stage == .dispatch, let packed = line.packed_qty, packed < line.quantity {
                dispatchBadge(line, packed, avatarInfo: avatarInfo, who: who)
            } else if stage == .loadback, let back = line.loadback_qty, back < line.shipped_qty {
                badge(.red, who, avatar: avatarInfo, "Brak \(line.shipped_qty - back) po wydarzeniu")
            } else if stage == .giveBack, line.return_ok_qty != nil {
                if damagedCount > 0 {
                    badge(.red, who, avatar: avatarInfo, "Uszkodzone \(damagedCount)")
                }
                if missingCount > 0 {
                    badge(.red, who, avatar: damagedCount > 0 ? nil : avatarInfo, "Brak \(missingCount)")
                }
            }
            if stage != .dispatch && !context.done && line.shipped_qty < line.quantity {
                badge(.secondary, "", avatar: nil, "Wydano \(line.shipped_qty)/\(line.quantity)")
            }
        }
    }

    @ViewBuilder private func dispatchBadge(_ line: EquipmentChecklist.Line, _ packed: Int, avatarInfo: (EquipmentChecklist.Person?, String?)?, who: String) -> some View {
        let decider = line.shortage_decided_by.flatMap { context.people[$0] }
        let deciderName = decider?.name ?? line.shortage_decided_name
        let decided = EquipmentRules.byLine(deciderName, line.shortage_decided_at)
        if !line.required {
            badge(.secondary, who, avatar: avatarInfo, "Spakowano \(packed)/\(line.quantity)")
        } else if line.shortage_status == "approved" {
            let agreed = EquipmentRules.firstName(deciderName).nonEmpty ?? "tak"
            badge(.red, decided, avatar: (decider, deciderName), "Brak \(line.shortage_qty) · zgoda: " + agreed)
        } else if line.shortage_status == "rejected" {
            badge(.red, decided, avatar: nil, "Brak \(line.shortage_qty) · bez zgody")
        } else {
            badge(.orange, who, avatar: nil, "Brak \(line.shortage_qty) · czeka na zgodę")
        }
    }

    private func badge(_ color: Color, _ title: String, avatar: (EquipmentChecklist.Person?, String?)?, _ text: String) -> some View {
        HStack(spacing: 4) {
            if let avatar { EquipmentPersonAvatar(person: avatar.0, name: avatar.1, size: 14) }
            Text(text).font(.caption2.weight(.semibold))
        }
        .padding(.horizontal, 6).padding(.vertical, 2)
        .foregroundStyle(color == .secondary ? Color.secondary : color)
        .background((color == .secondary ? Color.primary : color).opacity(0.14), in: Capsule())
        .help(title)
    }
}

/// Notatka i zdjęcia etapu pod nazwą (`EquipmentRowNote`).
struct EquipmentRowNote: View {
    let context: EquipmentRowChecklist
    let photoBase: String
    var body: some View {
        let line = context.line, stage = context.stage
        let texts = noteTexts(line, stage)
        let photos = stage == .giveBack ? line.return_photos : []
        if texts.text != nil || texts.extra != nil || !photos.isEmpty {
            let problem = context.tone != .ok
            VStack(alignment: .leading, spacing: 4) {
                if let text = texts.text { Text(text).font(.caption).foregroundStyle(problem ? Color.red : Color.secondary) }
                if let extra = texts.extra { Text("Decyzja: \(extra)").font(.caption).foregroundStyle(.secondary) }
                if !photos.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(Array(photos.prefix(4).enumerated()), id: \.offset) { item in
                            Button { if let url = URL(string: photoBase + item.element) { NSWorkspace.shared.open(url) } } label: {
                                CachedRemoteImage(url: photoBase + item.element, crop: nil)
                                    .frame(width: 28, height: 28).clipShape(RoundedRectangle(cornerRadius: 4))
                            }
                            .buttonStyle(.plain).help("Zdjęcie \(item.offset + 1): \(line.name)")
                        }
                        if photos.count > 4 { Text("+\(photos.count - 4)").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
            }
        }
    }
    private func noteTexts(_ line: EquipmentChecklist.Line, _ stage: EquipmentStage) -> (text: String?, extra: String?) {
        if stage == .dispatch, let packed = line.packed_qty, packed < line.quantity {
            return (line.shortage_reason?.nonEmpty, line.shortage_status != "pending" ? line.shortage_decision_note?.nonEmpty : nil)
        }
        if stage == .loadback, line.loadback_qty != nil { return (line.loadback_note?.nonEmpty, nil) }
        if stage == .giveBack, line.return_ok_qty != nil { return (line.return_note?.nonEmpty, nil) }
        return (nil, nil)
    }
}

/// Ilość etapu z edytorem w dymku (`EquipmentRowQtyChip` + `DispatchEditor` / `LoadbackEditor` / `ReturnEditor`).
@MainActor struct EquipmentRowQtyChip: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let context: EquipmentRowChecklist
    let photoBase: String
    @State private var open = false

    var body: some View {
        let tone = context.tone
        let qty = EquipmentRules.stageQty(context.line, context.stage)
        let done = tone == .ok
        let valueText = qty.value.map { String($0) } ?? "–"
        let label = valueText + "/" + String(qty.of)
        let color: Color = tone == .pending ? .orange : EquipmentRules.problem(tone) ? .red : done ? .green : .secondary
        if context.editable {
            Button { open.toggle() } label: { chip(label, color) }
                .buttonStyle(.plain)
                .disabled(context.busy && !open)
                .help("\(context.stage.qtyTitle) — zmień")
                .popover(isPresented: $open, arrowEdge: .bottom) {
                    EquipmentLineEditor(store: store, eventID: eventID, context: context, photoBase: photoBase) { open = false }
                }
        } else if qty.value != nil && !done {
            chip(label, color).help(context.stage.qtyTitle)
        }
    }
    private func chip(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption.monospacedDigit().weight(.semibold))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .foregroundStyle(color == .secondary ? Color.primary.opacity(0.75) : color)
            .background((color == .secondary ? Color.primary : color).opacity(0.13), in: Capsule())
    }
}

/// Licznik z przyciskami (`QtyStepper`).
private struct QtyStepper: View {
    @Binding var value: Int
    let max: Int
    let disabled: Bool
    var onChange: (Int) -> Void = { _ in }
    var body: some View {
        HStack(spacing: 4) {
            Button { set(value - 1) } label: { Image(systemName: "minus") }.disabled(disabled || value <= 0)
            TextField("", value: Binding(get: { value }, set: { set($0) }), format: .number)
                .multilineTextAlignment(.center).frame(width: 48).textFieldStyle(.roundedBorder).disabled(disabled)
            Text("/ \(max)").font(.caption).foregroundStyle(.secondary)
            Button { set(value + 1) } label: { Image(systemName: "plus") }.disabled(disabled || value >= max)
        }
        .controlSize(.small)
    }
    private func set(_ next: Int) {
        value = Swift.min(Swift.max(next, 0), max)
        onChange(value)
    }
}

/// Edytor ilości etapu: wydanie (spakowano + powód braku), po wydarzeniu (wraca + co się stało), zwrot (sprawne, uszkodzone, brak, opis, zdjęcia).
@MainActor private struct EquipmentLineEditor: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let context: EquipmentRowChecklist
    let photoBase: String
    let close: () -> Void
    @EnvironmentObject private var state: Workspace
    @State private var qty = 0
    @State private var damaged = 0
    @State private var text = ""
    @State private var error = ""
    @State private var importing = false
    @State private var uploading = false
    @State private var removing: String?

    private var line: EquipmentChecklist.Line { context.line }
    private var busy: Bool { context.busy || uploading }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(line.name).font(.callout.weight(.semibold))
            switch context.stage {
            case .dispatch: dispatch
            case .loadback: loadback
            case .giveBack: giveBack
            }
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                if hasValue { Button("Odznacz") { Task { await clear() } }.disabled(busy) }
                Spacer()
                Button("Anuluj") { close() }.disabled(busy)
                Button { Task { await save() } } label: {
                    HStack(spacing: 4) {
                        if context.busy { ProgressView().controlSize(.mini) }
                        Text("Zapisz")
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy)
            }
            .controlSize(.small)
        }
        .padding(14).frame(width: 340)
        .onAppear(perform: reset)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await upload(urls) } }
        }
        .confirmationDialog("Usunąć zdjęcie?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let path = removing { Task { await removePhoto(path) } } }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text("Zdjęcie zniknie z pozycji zwrotu.") }
    }

    private var hasValue: Bool {
        switch context.stage {
        case .dispatch: return line.packed_qty != nil
        case .loadback: return line.loadback_qty != nil
        case .giveBack: return line.return_ok_qty != nil
        }
    }

    private func reset() {
        error = ""
        switch context.stage {
        case .dispatch: qty = line.packed_qty ?? line.quantity; text = line.shortage_reason ?? ""
        case .loadback: qty = line.loadback_qty ?? line.shipped_qty; text = line.loadback_note ?? ""
        case .giveBack: qty = line.return_ok_qty ?? line.shipped_qty; damaged = line.return_damaged_qty ?? 0; text = line.return_note ?? ""
        }
    }

    private var dispatch: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Spakowano (na liście \(line.quantity))").font(.caption).foregroundStyle(.secondary)
            QtyStepper(value: $qty, max: line.quantity, disabled: busy) { _ in error = "" }
            if qty < line.quantity {
                (Text("Powód braku (\(line.quantity - qty) szt.)") + Text(line.required ? " *" : " — opcjonalnie").foregroundColor(line.required ? .red : .secondary))
                    .font(.caption)
                TextField("np. uszkodzony, wypożyczony gdzie indziej", text: $text).textFieldStyle(.roundedBorder).disabled(busy)
                    .onSubmit { Task { await save() } }
                if line.required { Text("Brak wymaga zgody sprzedawcy lub administratora.").font(.caption2).foregroundStyle(.secondary) }
            }
        }
    }

    private var loadback: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Wraca po wydarzeniu (wydano \(line.shipped_qty))").font(.caption).foregroundStyle(.secondary)
            QtyStepper(value: $qty, max: line.shipped_qty, disabled: busy) { _ in error = "" }
            if qty < line.shipped_qty {
                (Text("Co się stało z \(line.shipped_qty - qty) szt.?") + Text(" *").foregroundColor(.red)).font(.caption)
                TextField("np. zostało na obiekcie, zaginęło, uszkodzone", text: $text).textFieldStyle(.roundedBorder).disabled(busy)
                    .onSubmit { Task { await save() } }
            }
        }
    }

    private var giveBack: some View {
        let missing = EquipmentRules.returnMissing(line, ok: qty, damaged: damaged)
        let needsNote = damaged > 0 || missing > 0
        return VStack(alignment: .leading, spacing: 8) {
            Text("Zwrot na magazyn (wydano \(line.shipped_qty))").font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Sprawne").font(.caption2).foregroundStyle(.secondary)
                    QtyStepper(value: $qty, max: line.shipped_qty, disabled: busy) { value in
                        damaged = min(damaged, max(line.shipped_qty - value, 0)); error = ""
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Uszkodzone").font(.caption2).foregroundStyle(.secondary)
                    QtyStepper(value: $damaged, max: line.shipped_qty, disabled: busy) { value in
                        qty = min(qty, max(line.shipped_qty - value, 0)); error = ""
                    }
                }
            }
            (Text("Brak: ").foregroundColor(.secondary) + Text("\(missing)").bold().foregroundColor(missing > 0 ? .red : .primary)).font(.caption)
            if needsNote || !text.isEmpty {
                (Text("Opis uszkodzeń lub braku") + Text(needsNote ? " *" : " — opcjonalnie").foregroundColor(needsNote ? .red : .secondary)).font(.caption)
                TextField("Co, ile, co się stało", text: $text, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder).disabled(busy)
            }
            photos
        }
    }

    private var photos: some View {
        HStack(spacing: 6) {
            ForEach(line.return_photos, id: \.self) { path in
                ZStack(alignment: .topTrailing) {
                    Button { if let url = URL(string: photoBase + path) { NSWorkspace.shared.open(url) } } label: {
                        CachedRemoteImage(url: photoBase + path, crop: nil).frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                    .buttonStyle(.plain)
                    Button { removing = path } label: { Image(systemName: "xmark.circle.fill").font(.caption) }
                        .buttonStyle(.plain).disabled(busy).help("Usuń zdjęcie")
                }
            }
            if line.return_photos.count < 10 {
                Button { importing = true } label: {
                    if uploading { ProgressView().controlSize(.mini) } else { Label("Zdjęcie", systemImage: "photo.badge.plus") }
                }
                .controlSize(.small).disabled(busy)
            }
        }
    }

    private func save() async {
        guard !busy else { return }
        let problem: String?
        let name: String
        var params: [String: JSONValue] = ["p_line": .string(line.id)]
        let note = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch context.stage {
        case .dispatch:
            problem = EquipmentRules.packedError(line, qty, text)
            name = "set_event_equipment_packed"
            params["p_qty"] = .number(Double(qty))
            params["p_reason"] = qty < line.quantity && !note.isEmpty ? .string(note) : .null
        case .loadback:
            problem = EquipmentRules.loadbackError(line, qty, text)
            name = "set_event_equipment_loadback"
            params["p_qty"] = .number(Double(qty))
            params["p_note"] = note.isEmpty ? .null : .string(note)
        case .giveBack:
            problem = EquipmentRules.returnError(line, ok: qty, damaged: damaged, note: text)
            name = "set_event_equipment_return"
            params["p_ok"] = .number(Double(qty))
            params["p_damaged"] = .number(Double(damaged))
            params["p_note"] = note.isEmpty ? .null : .string(note)
            params["p_photos"] = .null
        }
        if let problem { error = problem; return }
        if let failure = await store.checklistRun(eventID, key: "line:\(line.id)", name: name, params: params) { error = failure } else { close() }
    }

    private func clear() async {
        let name: String
        var params: [String: JSONValue] = ["p_line": .string(line.id)]
        switch context.stage {
        case .dispatch: name = "set_event_equipment_packed"; params["p_qty"] = .null; params["p_reason"] = .null
        case .loadback: name = "set_event_equipment_loadback"; params["p_qty"] = .null; params["p_note"] = .null
        case .giveBack: name = "set_event_equipment_return"; params["p_ok"] = .null; params["p_damaged"] = .number(0); params["p_note"] = .null; params["p_photos"] = .null
        }
        if let failure = await store.checklistRun(eventID, key: "line:\(line.id)", name: name, params: params) { error = failure } else { close() }
    }

    /// `ReturnPhotos.add`: najwyżej 10 zdjęć na pozycję, każde do 15 MB.
    private func upload(_ urls: [URL]) async {
        let room = 10 - line.return_photos.count
        guard room > 0 else { error = "Najwyżej 10 zdjęć na pozycję."; return }
        let batch = Array(urls.prefix(room))
        uploading = true
        defer { uploading = false }
        error = ""
        var photos = line.return_photos
        for file in batch {
            do {
                try await store.uploadReturnPhoto(eventID, line: line.id, file: file, ok: line.return_ok_qty, damaged: line.return_damaged_qty ?? 0,
                                                  note: line.return_note, photos: photos)
                photos = store.tab(eventID, "equipment-checklist", as: EquipmentChecklistTab.self)?.checklist?.lines.first { $0.id == line.id }?.return_photos ?? photos
            } catch {
                self.error = store.failureText(error, "Nie udało się wysłać zdjęcia.")
                return
            }
        }
        if urls.count > batch.count { error = "Dodano \(batch.count) zdj. — limit to 10 na pozycję." }
    }

    private func removePhoto(_ path: String) async {
        removing = nil
        error = ""
        let params: [String: JSONValue] = [
            "p_line": .string(line.id),
            "p_ok": line.return_ok_qty.map { .number(Double($0)) } ?? .null,
            "p_damaged": .number(Double(line.return_damaged_qty ?? 0)),
            "p_note": line.return_note.map { .string($0) } ?? .null,
            "p_photos": .array(line.return_photos.filter { $0 != path }.map { .string($0) }),
        ]
        if let failure = await store.checklistRun(eventID, key: "line:\(line.id)", name: "set_event_equipment_return", params: params) { error = failure }
    }
}
