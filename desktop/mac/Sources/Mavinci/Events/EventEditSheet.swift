import SwiftUI

// MARK: „Edytuj” na karcie eventu — zmiana nazwy (jak `EventRenameModal` w CRM). Zapisuje wyłącznie nazwę (`renameEvent`
// w `src/lib/native/eventCreate.ts`), więc niczego innego nie nadpisuje: termin, lokalizację z salami, klienta, firmę realizującą,
// kategorię i status zmienia się przy polach w „Szczegółach”.

@MainActor struct EventEditSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name = ""
    @State private var original = ""
    @State private var problem: String?
    @State private var saving = false
    @State private var prepared = false
    @FocusState private var focused: Bool

    private static let maxLength = 500
    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Zmień nazwę eventu").font(.title2.weight(.light)).textCase(.uppercase)
                .padding([.horizontal, .top], 20).padding(.bottom, 12)
            VStack(alignment: .leading, spacing: 8) {
                Text("Nazwa eventu").font(.callout).foregroundStyle(.secondary)
                TextField("np. Studniówka 2027 LO II", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onSubmit { Task { await save() } }
                if let problem {
                    Text(problem).font(.callout).foregroundStyle(.red).textSelection(.enabled)
                } else {
                    Text("Zmienia się tylko nazwa. Termin, lokalizację, klienta, firmę realizującą, kategorię i status zmienisz przy polach w zakładce „Szczegóły”.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 20)
            Spacer(minLength: 16)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz nazwę") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || trimmed.isEmpty)
            }
            .padding(16).crmBar()
        }
        .frame(width: 520, height: 250)
        .background(theme.page)
        .interactiveDismissDisabled(saving)
        .onAppear {
            guard !prepared else { return }
            prepared = true
            original = EventFields(raw: store.card(eventID)?.page.event ?? [:]).name
            name = original
            focused = true
        }
    }

    private func save() async {
        guard !saving else { return }
        problem = nil
        let value = trimmed
        guard !value.isEmpty else { problem = "Nazwa eventu jest wymagana"; return }
        guard value.count <= Self.maxLength else { problem = "Nazwa eventu może mieć najwyżej \(Self.maxLength) znaków"; return }
        guard value != original.trimmingCharacters(in: .whitespacesAndNewlines) else { dismiss(); return }
        saving = true
        defer { saving = false }
        do {
            try await store.tabAction(eventID, "details", "renameEvent", ["name": .string(value)], reload: [],
                                      success: "Nazwa eventu zmieniona", pending: "Zapisywanie nazwy…")
            await store.load(eventID)
            dismiss()
        } catch let failure as NativeFailure {
            problem = failure.message
        } catch {
            problem = store.failureText(error, "Nie udało się zmienić nazwy eventu")
        }
    }
}
