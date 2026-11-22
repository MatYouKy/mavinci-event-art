import SwiftUI

// MARK: „Założenia wydarzenia” — edycja jak `OfferAssumptionsSection` + `EventAssumptionsEditor`: trzy karty (kategoria, własny
// tytuł, wartość w znaczniku, treść z limitem), liczba gości pobierana z informacji podstawowych, cel wydarzenia
// i „Zaproponuj z AI” (`draft_offer_assumptions`). Zapis `op=assumptionsSave`.

@MainActor struct OfferAssumptionsSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: OfferAssumptionsData?
    @State private var items: [OfferAssumptionsData.Item] = []
    @State private var goal = ""
    @State private var loadError: String?
    @State private var saving = false
    @State private var problem: String?
    @State private var aiOpen = false
    @State private var sources: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Założenia eventu").font(.title3.weight(.semibold))
                    Text("Założenia realizacji — trzy najważniejsze informacje. Te same trzy karty oraz ich liczbowe znaczniki trafią do oferty PDF.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { aiOpen = true } label: { Label("Zaproponuj z AI", systemImage: "sparkles") }
                    .disabled(data == nil || saving)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)

            if let data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if let sources { Text(sources).font(.caption).foregroundStyle(.secondary) }
                        if let count = data.guestCount, !items.contains(where: { $0.key == "guest_count" }) {
                            Text("Liczba gości: \(Int(count)). Możesz wybrać „Liczba gości” w jednej z trzech kart — wartość uzupełni się automatycznie.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(items.indices, id: \.self) { index in card(index, data) }
                        ProductField(label: "Cel eventu") {
                            ProductTextArea(text: $goal, prompt: "Rezultat, który klient chce osiągnąć…", lines: 3...6)
                        }
                    }
                    .padding(.horizontal, 18).padding(.bottom, 12)
                }
                .frame(height: 600)
                .disabled(saving)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć edycji", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
                .frame(height: 300)
            } else {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity).frame(height: 300)
            }

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving || data == nil)
            }
            .padding(18)
        }
        .frame(width: 760)
        .background(theme.page)
        .task { await load() }
        .sheet(isPresented: $aiOpen) {
            OfferAssumptionsAISheet(store: store, offerID: offerID, items: items, goal: goal) { draft in
                items = draft.items
                if let generated = draft.goal { goal = generated }
                sources = draft.sources
            }
        }
    }

    private func option(_ key: String) -> OfferAssumptionsData.Option? { data?.options.first { $0.key == key } }

    private func card(_ index: Int, _ data: OfferAssumptionsData) -> some View {
        let item = items[index]
        let option = option(item.key)
        let guestLocked = item.key == "guest_count" && data.guestCount != nil
        let used = Set(items.enumerated().filter { $0.offset != index }.map { $0.element.key })
        let choices = data.options.filter { $0.key == "custom" || $0.key == item.key || !used.contains($0.key) }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text("\(index + 1)").font(.callout.weight(.bold)).frame(width: 26, height: 26)
                    .background(theme.accent.opacity(0.15), in: Circle()).foregroundStyle(theme.accent)
                Picker("", selection: Binding(get: { item.key }, set: { change(index, key: $0, data) })) {
                    ForEach(choices) { choice in Text(choice.label).tag(choice.key) }
                }
                .labelsHidden().fixedSize()
            }
            if item.key == "custom" {
                ProductField(label: "Własny tytuł założenia") {
                    TextField("", text: Binding(get: { item.label == option?.label ? "" : item.label },
                                                set: { items[index].label = String($0.prefix(80)) }),
                              prompt: Text("np. Energia na parkiecie"))
                        .textFieldStyle(.roundedBorder)
                }
            }
            if guestLocked {
                Text("Liczba pobierana automatycznie z informacji podstawowych oferty. Zmień ją tam, aby zaktualizować również wycenę.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ProductField(label: "Wartość liczbowa w burgundowym znaczniku",
                         help: "Np. „180”, „6 H” lub „2 SALE” — tylko gdy wynika to z ustaleń. Bez danych zostaw puste pole: PDF pokaże numer 0\(index + 1).") {
                TextField("", text: Binding(get: { item.badge_value ?? "" },
                                            set: { items[index].badge_value = String($0.uppercased(with: Locale(identifier: "pl_PL")).prefix(7)) }),
                          prompt: Text("Puste pole = 0\(index + 1)"))
                    .textFieldStyle(.roundedBorder).frame(width: 160)
                    .disabled(guestLocked)
            }
            ProductField(label: option?.question ?? item.label, help: "\(item.value.count)/\(data.maxLength)") {
                let binding = Binding(get: { item.value }, set: { items[index].value = String($0.prefix(data.maxLength)) })
                if option?.multiline == true {
                    ProductTextArea(text: binding, prompt: option?.placeholder ?? "", lines: 3...6).disabled(guestLocked)
                } else {
                    TextField("", text: binding, prompt: Text(option?.placeholder ?? "")).textFieldStyle(.roundedBorder).disabled(guestLocked)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
    }

    /// Zmiana kategorii karty (jak `onChange` listy w `EventAssumptionsEditor`).
    private func change(_ index: Int, key: String, _ data: OfferAssumptionsData) {
        guard let next = option(key) else { return }
        let guests = data.guestCount.map { Int($0) }
        items[index] = OfferAssumptionsData.Item(
            key: key,
            label: key == "custom" ? "" : next.label,
            value: key == "guest_count" && guests != nil ? "\(guests!) osób" : next.defaultValue,
            badge_value: key == "guest_count" && guests != nil ? "\(guests!)" : next.defaultBadge)
    }

    private func load() async {
        loadError = nil
        do {
            let next = try await store.assumptionsEditor(offerID)
            items = next.items
            goal = next.goal
            data = next
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać założeń.")
        }
    }

    private func save() async {
        problem = nil
        saving = true
        defer { saving = false }
        let body: [String: JSONValue] = ["items": .array(items.map(\.json)), "goal": .string(goal)]
        if await store.change(offerID, "assumptionsSave", body, success: "Założenia eventu zapisane") { dismiss() }
        else if let message = store.workspace?.error { problem = message }
    }
}

/// „Zaproponuj założenia z AI”: wytyczne (opcjonalnie) i cel wydarzenia; propozycja zastępuje treści trzech kart.
@MainActor struct OfferAssumptionsAISheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    let items: [OfferAssumptionsData.Item]
    let goal: String
    let onDraft: (OfferAssumptionsDraft) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var instructions = ""
    @State private var generateGoal = true
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Zaproponuj założenia z AI").font(.title3.weight(.semibold))
            VStack(alignment: .leading, spacing: 4) {
                Text("Podstawa propozycji").font(.caption).foregroundStyle(.secondary)
                Text("AI uzupełni kategorie wybrane w trzech kartach, w tej samej kolejności. Wykorzysta ustalenia, historię analiz zapytania, aktualne zatwierdzone podsumowanie, korespondencję oraz wybrane produkty.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    Text("\(index + 1). \(item.label.isEmpty ? item.key : item.label)").font(.callout)
                }
            }
            Toggle("Uzupełnij również cel eventu", isOn: $generateGoal)
            ProductField(label: "Co chcesz osiągnąć? (opcjonalnie)", help: "Puste pole = propozycja według bazowej instrukcji. \(instructions.count)/2000") {
                ProductTextArea(text: Binding(get: { instructions }, set: { instructions = String($0.prefix(2000)) }),
                                prompt: "Np. podkreśl prestiż eventu, komfort prelegentów i widoczność prezentacji. Ton profesjonalny, bez przesadnych sloganów.",
                                lines: 4...7)
            }
            Text("Propozycja zastąpi treści trzech wybranych założeń oraz — jeśli zaznaczono — cel eventu. Przed zapisaniem możesz je poprawić.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                if busy {
                    ProgressView().controlSize(.small)
                    Text("AI przygotowuje…").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy)
                Button { Task { await generate() } } label: { Label("Przygotuj propozycję", systemImage: "sparkles") }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(busy)
            }
        }
        .padding(18)
        .frame(width: 560)
        .background(theme.page)
        .disabled(busy)
    }

    private func generate() async {
        busy = true
        problem = nil
        defer { busy = false }
        do {
            let draft = try await store.draftAssumptions(offerID, items: items, goal: goal,
                                                         instructions: instructions.trimmingCharacters(in: .whitespacesAndNewlines), generateGoal: generateGoal)
            onDraft(draft)
            store.workspace?.succeed(generateGoal ? "AI uzupełniło wybrane założenia i cel eventu" : "AI uzupełniło wybrane założenia")
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się przygotować założeń przez AI")
        }
    }
}
