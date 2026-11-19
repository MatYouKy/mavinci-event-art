import SwiftUI

// MARK: Automatyzacja SLA — 1:1 z `InquirySlaSettingsModal` ze strony `/crm/inquiries`. Serwer: `/bridge/native/v1/inquiries`
// (`slaSettings`, `slaSave` — `src/lib/native/inquiryCreate.ts`), tokenem pracownika. Okno „Nowe zapytanie” — `NewInquiryForm.swift`.

// MARK: Automatyzacja SLA

struct InquirySlaSettings: Decodable {
    var isEnabled: Bool
    var unassignedMinutes: Double
    var firstContactMinutes: Double
    var repeatMinutes: Double
    var escalationMinutes: Double
    var maxOwnerReminders: Double
    var offerFollowupDays: [Double]
    var assignmentMode: String
    var requireNextActionAfterContact: Bool
    var defaultNextActionHours: Double
    var autoPromoteCustomerLifecycle: Bool
}

@MainActor final class InquirySlaModel: ObservableObject {
    weak var workspace: Workspace?
    @Published var loaded = false
    @Published var saving = false
    @Published var isEnabled = true
    @Published var assignmentMode = "current"
    @Published var requireNextAction = true
    @Published var defaultNextActionHours = ""
    @Published var autoPromote = true
    @Published var unassignedMinutes = ""
    @Published var firstContactMinutes = ""
    @Published var repeatMinutes = ""
    @Published var escalationMinutes = ""
    @Published var maxOwnerReminders = ""
    @Published var offerFollowupDays = ""

    private var api: NativeAPI? { workspace?.nativeAPI() }

    /// `updateNumber`: co najmniej 1, wartość nieliczbowa — 1.
    static func atLeastOne(_ text: String) -> Double {
        let value = Double(text.trimmingCharacters(in: .whitespaces)) ?? 0
        return max(1, value.isFinite && value != 0 ? value : 1)
    }
    static func display(_ value: Double) -> String { InvoiceMath.plain(value) }
    /// „1, 3, 7” → dni całkowite większe od zera (jak pole w CRM).
    static func days(_ text: String) -> [Int] {
        text.split(separator: ",", omittingEmptySubsequences: false).compactMap { part -> Int? in
            let trimmed = part.trimmingCharacters(in: .whitespaces)
            guard let value = trimmed.isEmpty ? 0 : Double(trimmed), value.rounded() == value, value > 0, value < 1_000_000 else { return nil }
            return Int(value)
        }
    }

    /// `nil` — wczytano; tekst — błąd (okno się zamyka, jak w CRM).
    func load() async -> String? {
        guard let api else { return "Nie udało się pobrać ustawień SLA" }
        struct Reply: Decodable { var settings: InquirySlaSettings }
        do {
            let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/inquiries", query: ["op": "slaSettings"]))
            let s = reply.settings
            isEnabled = s.isEnabled
            assignmentMode = s.assignmentMode
            requireNextAction = s.requireNextActionAfterContact
            defaultNextActionHours = Self.display(s.defaultNextActionHours)
            autoPromote = s.autoPromoteCustomerLifecycle
            unassignedMinutes = Self.display(s.unassignedMinutes)
            firstContactMinutes = Self.display(s.firstContactMinutes)
            repeatMinutes = Self.display(s.repeatMinutes)
            escalationMinutes = Self.display(s.escalationMinutes)
            maxOwnerReminders = Self.display(s.maxOwnerReminders)
            offerFollowupDays = s.offerFollowupDays.map(Self.display).joined(separator: ", ")
            loaded = true
            return nil
        } catch {
            return (error as? NativeFailure)?.message ?? "Nie udało się pobrać ustawień SLA"
        }
    }

    /// „Zapisz” — `true` po zapisie.
    func save() async -> Bool {
        guard let workspace, let api, loaded else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        saving = true
        defer { saving = false }
        let settings: [String: JSONValue] = [
            "isEnabled": .bool(isEnabled), "assignmentMode": .string(assignmentMode),
            "requireNextActionAfterContact": .bool(requireNextAction), "defaultNextActionHours": .number(Self.atLeastOne(defaultNextActionHours)),
            "autoPromoteCustomerLifecycle": .bool(autoPromote),
            "unassignedMinutes": .number(Self.atLeastOne(unassignedMinutes)), "firstContactMinutes": .number(Self.atLeastOne(firstContactMinutes)),
            "repeatMinutes": .number(Self.atLeastOne(repeatMinutes)), "escalationMinutes": .number(Self.atLeastOne(escalationMinutes)),
            "maxOwnerReminders": .number(Self.atLeastOne(maxOwnerReminders)),
            "offerFollowupDays": .array(Self.days(offerFollowupDays).map { .number(Double($0)) }),
        ]
        do {
            let data = try await api.post("/inquiries", ["op": .string("slaSave"), "settings": .object(settings)])
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            workspace.succeed(reply["message"]?.text.nonEmpty ?? "Ustawienia SLA zostały zapisane")
            return true
        } catch {
            workspace.error = (error as? NativeFailure)?.message
                ?? (error is URLError ? "Brak połączenia z serwerem CRM. Spróbuj ponownie." : "Nie udało się zapisać ustawień SLA")
            return false
        }
    }
}

@MainActor struct InquirySlaSettingsSheet: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = InquirySlaModel()

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Automatyzacja SLA").font(.title2.bold())
                Text("Czasy obowiązują wszystkie zapytania i są liczone na serwerze.").font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            if model.loaded {
                settings
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack(spacing: 10) {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button {
                    Task { if await model.save() { dismiss() } }
                } label: {
                    HStack(spacing: 6) {
                        if model.saving { ProgressView().controlSize(.small) }
                        Text("Zapisz")
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(!model.loaded || model.saving)
            }
            .padding(16)
        }
        .frame(minWidth: 520, idealWidth: 580, minHeight: 560, idealHeight: 660)
        .background(theme.page)
        .interactiveDismissDisabled(model.saving)
        .task {
            model.workspace = state
            if let error = await model.load() {
                state.error = error
                dismiss()
            }
        }
    }

    private var settings: some View {
        Form {
            Section {
                Toggle(isOn: $model.isEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Automatyczne przypomnienia")
                        Text("Wyłącza nowe wysyłki bez usuwania historii.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                Picker("Przydzielanie nowych zapytań", selection: $model.assignmentMode) {
                    Text("Dotychczasowe — autor lub wspólna pula").tag("current")
                    Text("Rotacyjne — osoba z najmniejszą liczbą otwartych szans").tag("round_robin")
                }
                Text("Tryb rotacyjny uwzględnia tylko aktywnych pracowników z uprawnieniami sprzedażowymi.").font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Toggle(isOn: $model.requireNextAction) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Wymagaj kolejnego działania po kontakcie")
                        Text("Jeśli pracownik nie poda terminu, CRM zaplanuje go automatycznie.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if model.requireNextAction {
                    numberRow("Domyślny kolejny kontakt po", $model.defaultNextActionHours, unit: "godz.")
                }
            }
            Section {
                Toggle(isOn: $model.autoPromote) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Aktualizuj etap klienta automatycznie")
                        Text("Wygrana oznacza klienta, a kwalifikacja — potencjalnego klienta.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                numberRow("Nieprzypisane po", $model.unassignedMinutes, unit: "min")
                numberRow("Pierwszy kontakt w", $model.firstContactMinutes, unit: "min")
                numberRow("Powtórz przypomnienie po", $model.repeatMinutes, unit: "min")
                numberRow("Eskaluj do managera po", $model.escalationMinutes, unit: "min")
                numberRow("Liczba przypomnień opiekuna", $model.maxOwnerReminders, unit: "razy")
                TextField("Follow-up po ofercie (dni)", text: $model.offerFollowupDays, prompt: Text("1, 3, 7"))
            }
        }
        .formStyle(.grouped)
        .disabled(model.saving)
    }

    private func numberRow(_ title: String, _ value: Binding<String>, unit: String) -> some View {
        SlaNumberField(title: title, unit: unit, text: value)
    }
}

/// Pole liczby w ustawieniach SLA: po wyjściu z pola — co najmniej 1 (jak `updateNumber` w CRM).
private struct SlaNumberField: View {
    let title: String
    let unit: String
    @Binding var text: String
    @FocusState private var focused: Bool

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 6) {
                TextField("", text: $text)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 90)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onChange(of: focused) { _, isFocused in
                        if !isFocused { text = InquirySlaModel.display(InquirySlaModel.atLeastOne(text)) }
                    }
                Text(unit).foregroundStyle(.secondary).frame(width: 34, alignment: .leading)
            }
        }
    }
}
