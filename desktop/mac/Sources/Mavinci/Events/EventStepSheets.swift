import SwiftUI

// MARK: Okna kroków realizacji: czynność z notatką / zamówieniem, nowy krok, pomoc (teksty i progi jak w CRM).

@MainActor struct EventStepActionSheet: View {
    let request: EventStepRequest
    /// Zwraca komunikat błędu albo `nil` po sukcesie (okno się zamyka).
    var submit: (String, [String: JSONValue]) async -> String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var note = ""
    @State private var supplier = ""
    @State private var hasDelivery = false
    @State private var deliveryDay = Date()
    @State private var deliveryTime = Date()
    @State private var error: String?
    @State private var busy = false

    private let noteLimit = 2000
    private var step: EventStep { request.step }
    private var action: String { request.action }
    private var rule: EventStepRules.NoteRule? { EventStepRules.noteRule(step, action) }
    private var orderFields: Bool { EventStepRules.needsOrderFields(step, action) }
    private var label: String { EventStepRules.actionLabel(step, action) }
    private var orderSummary: String {
        var parts: [String] = []
        let quantity = EventStepRules.quantityLabel(step)
        if !quantity.isEmpty { parts.append("Ilość: \(quantity)") }
        if let supplier = step.supplier, !supplier.isEmpty { parts.append("Dostawca: \(supplier)") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.title3.weight(.light))
                Text(step.title).font(.callout).foregroundStyle(.secondary)
            }
            if !orderSummary.isEmpty {
                Text(orderSummary)
                    .font(.callout).padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            if action == "skip" { Text("Powód pominięcia będzie widoczny w historii kroku.").font(.callout).foregroundStyle(.secondary) }
            if action == "problem" {
                Text("Kierownik realizacji i prowadzący wydarzenie dostaną powiadomienie, a krok zostanie oznaczony na czerwono.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            if orderFields {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Dostawca").font(.caption).foregroundStyle(.secondary)
                    TextField("Np. Linde", text: $supplier).textFieldStyle(.roundedBorder)
                        .onChange(of: supplier) { if supplier.count > 300 { supplier = String(supplier.prefix(300)) } }
                }
                Toggle("Planowana dostawa", isOn: $hasDelivery)
                if hasDelivery {
                    HStack(spacing: 14) {
                        DatePicker("Planowana dostawa — data", selection: $deliveryDay, displayedComponents: .date)
                        DatePicker("Godzina dostawy", selection: $deliveryTime, displayedComponents: .hourAndMinute)
                    }
                    .environment(\.timeZone, MeetingDates.zone)
                    .environment(\.locale, Locale(identifier: "pl_PL"))
                }
            }
            if let rule {
                VStack(alignment: .leading, spacing: 4) {
                    (Text(rule.label) + (rule.required ? Text(" *").foregroundColor(theme.accent) : Text(""))).font(.callout)
                    TextEditor(text: $note)
                        .font(.body).frame(minHeight: 90)
                        .scrollContentBackground(.hidden).padding(6)
                        .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(alignment: .topLeading) {
                            if note.isEmpty { Text(rule.placeholder).foregroundStyle(.tertiary).padding(.horizontal, 11).padding(.vertical, 8).allowsHitTesting(false) }
                        }
                        .onChange(of: note) {
                            if note.count > noteLimit { note = String(note.prefix(noteLimit)) }
                            error = nil
                        }
                    HStack {
                        Text(rule.required ? (rule.minLength > 1 ? "Wymagane, co najmniej \(rule.minLength) znaków." : "Wymagane.")
                             : rule.minLength > 0 ? "Opcjonalnie — przy rozbieżnościach co najmniej \(rule.minLength) znaków." : "Opcjonalnie.")
                        Spacer()
                        Text("\(note.count)/\(noteLimit)").monospacedDigit()
                    }
                    .font(.caption).foregroundStyle(.tertiary)
                }
            }
            if let error {
                Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfecaca))
                    .padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading)
                    .background(CrmTheme.rgb(0xef4444).opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy)
                Button(busy ? "Zapisywanie…" : label) { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                    .tint(action == "problem" ? CrmTheme.rgb(0xef4444) : theme.accent)
                    .disabled(busy)
            }
        }
        .padding(20).frame(width: 520)
        .onAppear {
            supplier = step.supplier ?? ""
            if let expected = step.expected_at.flatMap(MeetingDates.parse) {
                hasDelivery = true; deliveryDay = expected; deliveryTime = expected
            } else {
                deliveryTime = MeetingDates.calendar.date(bySettingHour: EventStepRules.defaultHour, minute: 0, second: 0, of: Date()) ?? Date()
            }
        }
    }

    private func save() async {
        guard !busy else { return }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if let rule, rule.required, trimmed.count < max(1, rule.minLength) {
            error = rule.minLength > 1 ? "\(rule.label): wpisz co najmniej \(rule.minLength) znaków." : "Uzupełnij pole „\(rule.label)”."
            return
        }
        if trimmed.count > noteLimit { error = "Notatka może mieć najwyżej \(noteLimit) znaków."; return }
        var payload: [String: JSONValue] = [:]
        if orderFields {
            if hasDelivery { payload["expected_at"] = .string(EventStepRules.iso(day: deliveryDay, time: deliveryTime)) }
            let name = supplier.trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty { payload["supplier"] = .string(String(name.prefix(300))) }
        }
        error = nil
        busy = true
        let failure = await submit(trimmed, payload)
        busy = false
        if let failure { error = failure } else { dismiss() }
    }
}

/// Nowy krok (`AddEventStepDialog`): nazwa, rodzaj, odpowiedzialna rola, termin, opis, blokada gotowości magazynu.
@MainActor struct AddEventStepSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var title = ""
    @State private var kind = "task"
    @State private var ownerRole = "warehouse"
    @State private var hasDue = false
    @State private var dueDay = Date()
    @State private var dueTime = MeetingDates.calendar.date(bySettingHour: EventStepRules.defaultHour, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var details = ""
    @State private var blocksReady = false
    @State private var saving = false
    @State private var error: String?

    private var canBlock: Bool { EventStepRules.blockingRoles.contains(ownerRole) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Dodaj krok").font(.title3.weight(.light))
                Text("Dodatkowe ustalenie, zamówienie albo sprawdzenie. Właściciel kroku dostanie przypomnienie przed terminem.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Form {
                TextField("Nazwa kroku *", text: $title, prompt: Text("Np. Potwierdź godzinę wjazdu z obiektem"))
                    .onChange(of: title) { if title.count > 200 { title = String(title.prefix(200)) } }
                Picker("Rodzaj", selection: $kind) {
                    ForEach(EventStepRules.manualKinds, id: \.self) { Text(EventStepRules.kinds[$0] ?? $0).tag($0) }
                }
                Picker("Kto odpowiada", selection: $ownerRole) {
                    ForEach(EventStepRules.manualRoles, id: \.self) { Text(EventStepRules.roles[$0] ?? $0).tag($0) }
                }
                Toggle("Termin *", isOn: $hasDue)
                if hasDue {
                    DatePicker("Termin — data", selection: $dueDay, displayedComponents: .date)
                    DatePicker("Godzina", selection: $dueTime, displayedComponents: .hourAndMinute)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Opis (opcjonalnie)")
                    TextEditor(text: $details)
                        .frame(minHeight: 70).scrollContentBackground(.hidden).padding(4)
                        .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 7))
                        .overlay(alignment: .topLeading) {
                            if details.isEmpty { Text("Co dokładnie zrobić, z kim się kontaktować").foregroundStyle(.tertiary).padding(8).allowsHitTesting(false) }
                        }
                        .onChange(of: details) { if details.count > 2000 { details = String(details.prefix(2000)) } }
                    Text("\(details.count)/2000").font(.caption).foregroundStyle(.tertiary).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Toggle("Wymagane przed gotowością magazynu", isOn: Binding(get: { canBlock && blocksReady }, set: { blocksReady = $0 }))
                        .disabled(!canBlock)
                    Text(canBlock ? "Magazyn nie oznaczy „Gotowe do wydania”, dopóki ten krok nie zostanie zamknięty."
                         : "Dostępne dla kroków magazynu, sprzedawcy i kierownika realizacji.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped).scrollContentBackground(.hidden)
            .environment(\.timeZone, MeetingDates.zone)
            .environment(\.locale, Locale(identifier: "pl_PL"))
            .disabled(saving)
            if let error {
                Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfecaca))
                    .padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading)
                    .background(CrmTheme.rgb(0xef4444).opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Dodaj krok") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(20).frame(width: 560)
    }

    private func save() async {
        guard !saving else { return }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.count < 3 || name.count > 200 { error = "Podaj nazwę kroku (3–200 znaków)."; return }
        if !hasDue { error = "Podaj termin kroku — właściciel dostanie przypomnienie."; return }
        let dueAt = EventStepRules.iso(day: dueDay, time: dueTime)
        if let due = MeetingDates.parse(dueAt), due.timeIntervalSinceNow < -60 { error = "Termin nie może być w przeszłości."; return }
        if details.count > 2000 { error = "Opis może mieć najwyżej 2000 znaków."; return }
        saving = true
        error = nil
        defer { saving = false }
        let text = details.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let data = try await workspace.withPending("Zapisywanie…") {
                try await store.rpc("add_event_step", [
                    "p_event_id": .string(eventID), "p_title": .string(name), "p_kind": .string(kind), "p_owner_role": .string(ownerRole),
                    "p_due_at": .string(dueAt), "p_details": text.isEmpty ? .null : .string(text), "p_blocks_ready": .bool(canBlock && blocksReady),
                ])
            }
            if let snapshot = try? JSONDecoder().decode(EventStepsSnapshot.self, from: data) { store.applySteps(eventID, snapshot) }
            else { await store.loadOverview(eventID) }
            workspace.succeed("Dodano krok.")
            dismiss()
        } catch {
            self.error = store.stepError(error)
        }
    }
}

/// Pomoc kroków (`EventStepsHelpModal`): najpierw role osoby na wydarzeniu, potem pozostałe; na dole zasady.
@MainActor struct EventStepsHelpSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let myRoles: [String: Bool]?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var active: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Kroki realizacji — kto za co odpowiada").font(.title3.weight(.light))
                    if let help = store.stepsHelp {
                        let mine = help.ordered(myRoles).mine
                        Text(myRoles == nil ? "Zakres odpowiedzialności każdej roli i jak wykonać swoje kroki."
                             : !mine.isEmpty ? "Najpierw Twoja rola na tym wydarzeniu, potem pozostałe."
                             : "Nie masz przypisanej roli na tym wydarzeniu — poniżej zakres wszystkich ról.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            if let help = store.stepsHelp { content(help) } else {
                ProgressView("Wczytywanie pomocy…").frame(maxWidth: .infinity, minHeight: 200)
            }
        }
        .padding(20).frame(width: 760, height: 640)
        .task { await store.loadStepsHelp(eventID) }
    }

    private func content(_ help: EventStepsHelp) -> some View {
        let ordered = help.ordered(myRoles)
        let sections = ordered.mine + ordered.others
        let mineRoles = Set(ordered.mine.map(\.role))
        let current = sections.first { $0.role == active } ?? sections.first
        return VStack(alignment: .leading, spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(sections) { section in
                        let selected = section.role == current?.role
                        Button { active = section.role } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(section.title).font(.callout.weight(.medium))
                                if mineRoles.contains(section.role) { Text("TWOJA ROLA").font(.system(size: 9)).foregroundStyle(theme.accent.opacity(0.8)) }
                            }
                            .padding(.horizontal, 11).padding(.vertical, 6)
                            .foregroundStyle(selected ? theme.accent : Color.primary.opacity(0.75))
                            .background(selected ? theme.accent.opacity(0.15) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let current {
                        Text(current.summary).font(.callout)
                        section("Twój zakres") {
                            ForEach(current.responsibilities, id: \.self) { Text("•  \($0)").font(.callout).foregroundStyle(.secondary) }
                        }
                        section("Kroki i jak je wykonać") {
                            ForEach(Array(current.steps.enumerated()), id: \.offset) { index, item in
                                HStack(alignment: .top, spacing: 10) {
                                    Text("\(index + 1)").font(.caption.weight(.semibold)).frame(width: 22, height: 22)
                                        .background(theme.accent.opacity(0.15), in: Circle()).foregroundStyle(theme.accent)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.title).font(.callout.weight(.medium))
                                        Text(item.how).font(.callout).foregroundStyle(.secondary)
                                    }
                                }
                                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                            }
                        }
                        section("Jak dobrze zamknąć swój zakres") {
                            ForEach(current.closeScope, id: \.self) { item in
                                Label { Text(item).font(.callout) } icon: { Image(systemName: "checkmark.circle").foregroundStyle(CrmTheme.rgb(0x6ee7b7)) }
                            }
                        }
                        section("Nie należy do Ciebie") {
                            Label { Text(current.notYours).font(.callout).foregroundStyle(.secondary) } icon: { Image(systemName: "nosign").foregroundStyle(.tertiary) }
                                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    if let rules = help.rules, !rules.isEmpty {
                        section("Zasady") {
                            ForEach(rules, id: \.self) { Text("•  \($0)").font(.callout).foregroundStyle(.secondary) }
                        }
                        .padding(14).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(0.6).foregroundStyle(theme.accent)
            content()
        }
    }
}
