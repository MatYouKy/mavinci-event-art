import SwiftUI

/// „Opiekun, etap i termin działania” — pola jak w CRM (`InquiryEditorModal`): tytuł, etap, opiekun, następne działanie
/// (szybkie terminy albo własny), ostatni kontakt, wartość, prawdopodobieństwo i powód utraty. Pełna obsługa (treść, ustalenia,
/// klient, oferty, notatki) — w karcie zapytania (`InquiryWorkspace.swift`).
@MainActor struct InquiryEditorSheet: View {
    @ObservedObject var store: InquiriesStore
    let inquiry: Inquiry
    let initialStage: InquiryStage?
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme

    @State private var title = ""
    @State private var stage: InquiryStage = .new
    @State private var ownerId = ""
    @State private var hasNext = false
    @State private var next = Date()
    @State private var hasLast = false
    @State private var last = Date()
    @State private var value = ""
    @State private var probability = 10
    @State private var lostCategory = ""
    @State private var lostReason = ""
    @State private var saving = false
    @State private var problem: String?
    @State private var prepared = false

    private var canAssign: Bool { store.access?.canAssign ?? false }
    private var valid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (stage != .lost || (!lostCategory.isEmpty && !lostReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            && (value.isEmpty || Double(value.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "")) != nil)
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Opiekun, etap i termin działania").font(.title2.bold())
                Text(inquiry.titleLabel).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }.frame(maxWidth: .infinity, alignment: .leading).padding([.horizontal, .top], 20).padding(.bottom, 6)

            Form {
                Section {
                    MeetingTextField("Tytuł zapytania", text: $title, prompt: "Nazwa zapytania")
                    Picker("Etap sprzedaży", selection: $stage) {
                        ForEach(InquiryStage.allCases) { item in
                            Label { Text(item.label) } icon: { Image(systemName: "circle.fill").foregroundStyle(item.color) }.tag(item)
                        }
                    }
                    .onChange(of: stage) { _, newStage in if prepared { probability = newStage.defaultProbability } }
                    Picker("Osoba odpowiedzialna", selection: $ownerId) {
                        Text("Bez opiekuna").tag("")
                        ForEach(owners) { Text($0.name).tag($0.id) }
                    }
                    .disabled(!canAssign)
                    if !canAssign { Text("Opiekuna zmienia menedżer albo osoba z uprawnieniem do przydzielania.").font(.caption).foregroundStyle(.secondary) }
                }

                Section("Następne działanie") {
                    if stage.closed {
                        Text("Zamknięte zapytanie nie ma kolejnych działań.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        HStack(spacing: 6) {
                            Button("Jutro 9:00") { plan(days: 1) }
                            Button("Za 3 dni") { plan(days: 3) }
                            Button("Za tydzień") { plan(days: 7) }
                            Button("Bez terminu") { hasNext = false }
                        }
                        .controlSize(.small)
                        if hasNext {
                            DatePicker("Termin", selection: $next, displayedComponents: [.date, .hourAndMinute])
                        } else {
                            Label("Brak zaplanowanego działania — zapytanie łatwo przeoczyć.", systemImage: "exclamationmark.triangle")
                                .font(.caption).foregroundStyle(.orange)
                            Button("Wybierz termin…") { hasNext = true; next = Date().addingTimeInterval(86_400) }.buttonStyle(.link)
                        }
                    }
                }
                .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))

                Section("Ostatni kontakt") {
                    if hasLast {
                        HStack {
                            DatePicker("Kiedy", selection: $last, displayedComponents: [.date, .hourAndMinute])
                            Button("Wyczyść") { hasLast = false }.controlSize(.small)
                        }
                    } else {
                        HStack {
                            Text("Kontakt jeszcze niepodjęty").foregroundStyle(.secondary)
                            Spacer()
                            Button("Teraz") { hasLast = true; last = Date() }.controlSize(.small)
                        }
                    }
                }
                .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))

                Section("Wartość") {
                    MeetingTextField("Szacowana wartość (zł)", text: $value, prompt: "0")
                    LabeledContent("Prawdopodobieństwo wygranej") {
                        HStack(spacing: 10) {
                            Slider(value: Binding(get: { Double(probability) }, set: { probability = Int(($0 / 5).rounded() * 5) }), in: 0...100, step: 5)
                                .frame(minWidth: 160)
                            Text("\(probability)%").monospacedDigit().frame(width: 40, alignment: .trailing)
                        }
                    }
                    .disabled(stage.closed)
                }

                if stage == .lost {
                    Section("Utrata") {
                        Picker("Kategoria utraty", selection: $lostCategory) {
                            Text("Wybierz…").tag("")
                            ForEach(inquiryLostCategories) { Text($0.label).tag($0.value) }
                        }
                        TextField("Powód utraty", text: $lostReason, prompt: Text("Opisz, dlaczego klient zrezygnował"), axis: .vertical).lineLimit(2...5)
                    }
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
                }
            }
            .formStyle(.grouped)

            HStack {
                Button("Otwórz w CRM") { state.openCRM("/crm/inquiries/\(inquiry.id)") }.buttonStyle(.link).linkCursor()
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz") { Task { await save() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(!valid || saving)
            }.padding(16)
        }
        .frame(minWidth: 560, idealWidth: 600, minHeight: 560, idealHeight: 660)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: "Zapisywanie zapytania…") } }
        .task {
            guard !prepared else { return }
            title = inquiry.title
            stage = initialStage ?? inquiry.inquiryStage
            ownerId = inquiry.ownerId ?? ""
            hasNext = inquiry.nextAction != nil; next = inquiry.nextAction ?? Date().addingTimeInterval(86_400)
            hasLast = inquiry.lastContact != nil; last = inquiry.lastContact ?? Date()
            value = inquiry.estimatedValue.map { String(Int($0)) } ?? ""
            probability = initialStage?.defaultProbability ?? inquiry.probability
            lostCategory = inquiry.lostReasonCategory; lostReason = inquiry.lostReason
            DispatchQueue.main.async { prepared = true }
            await store.loadEmployees()
        }
    }

    /// Szybki termin następnego działania: dzień za `days` dni, godz. 9:00 (czas polski).
    private func plan(days: Int) {
        let calendar = MeetingDates.calendar
        let day = calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: Date())) ?? Date()
        next = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: day) ?? day
        hasNext = true
    }

    /// Lista opiekunów z serwera (zakres jak w CRM) i obecny opiekun, nawet spoza tej listy.
    private var owners: [MeetingPerson] {
        var list = store.employees
        if let id = inquiry.ownerId, !list.contains(where: { $0.id == id }) { list.insert(MeetingPerson(id: id, name: inquiry.ownerName.isEmpty ? "Obecny opiekun" : inquiry.ownerName), at: 0) }
        return list
    }

    private func save() async {
        guard valid, !saving else { return }
        problem = nil
        let amount = Double(value.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: ""))
        var data: [String: JSONValue] = [
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "stage": .string(stage.rawValue),
            "nextActionAt": hasNext && !stage.closed ? .string(MeetingDates.iso(next)) : .null,
            "lastContactAt": hasLast ? .string(MeetingDates.iso(last)) : .null,
            "estimatedValue": amount.map { JSONValue.number($0) } ?? JSONValue.null,
            "probability": .number(Double(stage.closed ? stage.defaultProbability : probability)),
            "lostReason": .string(stage == .lost ? lostReason.trimmingCharacters(in: .whitespacesAndNewlines) : ""),
            "lostReasonCategory": .string(stage == .lost ? lostCategory : ""),
        ]
        if canAssign { data["ownerId"] = ownerId.isEmpty ? .null : .string(ownerId) }
        saving = true
        defer { saving = false }
        do {
            try await store.update(inquiry, data: data)
            state.succeed("Zapytanie zostało zaktualizowane")
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać zapytania.")
        }
    }
}

/// „Kontakt wykonany” z opcjonalnym terminem kolejnego działania (`complete_inquiry_followup`).
@MainActor struct InquiryContactSheet: View {
    @ObservedObject var store: InquiriesStore
    let inquiry: Inquiry
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var planNext = true
    @State private var next = Date().addingTimeInterval(86_400)
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Kontakt wykonany").font(.title2.bold())
            Text(inquiry.titleLabel).foregroundStyle(.secondary).lineLimit(2)
            Form {
                Toggle("Zaplanuj kolejne działanie", isOn: $planNext)
                if planNext {
                    DatePicker("Termin", selection: $next, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                        .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                }
            }.formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Potwierdź kontakt") {
                    saving = true
                    Task {
                        if await store.completeContact(inquiry, next: planNext ? next : nil) { dismiss() }
                        saving = false
                    }
                }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(22).frame(width: 520)
        .background(theme.page)
    }
}

/// Archiwizacja zapytania z powiązanymi danymi — powód jest wymagany (`remove_inquiry`, tryb „archived”).
@MainActor struct InquiryArchiveSheet: View {
    @ObservedObject var store: InquiriesStore
    let inquiry: Inquiry
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var reason = ""
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Archiwizuj zapytanie").font(.title2.bold())
            Text("Zapytanie ma powiązane dane, dlatego zostanie zarchiwizowane. Historia i dokumenty pozostaną.").font(.callout)
            Text(inquiry.titleLabel).foregroundStyle(.secondary).lineLimit(2)
            VStack(alignment: .leading, spacing: 6) {
                Text("Powód archiwizacji").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $reason).frame(minHeight: 80).padding(4)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Archiwizuj", role: .destructive) {
                    saving = true
                    Task {
                        if await store.remove(inquiry, mode: "archived", reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)) { done(); dismiss() }
                        saving = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(saving || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(22).frame(width: 520)
        .background(theme.page)
    }
}
