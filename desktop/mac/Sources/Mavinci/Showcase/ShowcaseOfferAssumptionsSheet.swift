import SwiftUI

// MARK: „Założenia i cel” oferty ze spotkania — jak „Założenia eventu” w ofercie (`OfferAssumptionsSheet`) i ta sama sekcja
// w pokazie w CRM, na iPadzie i telefonie: trzy karty (kategoria, własny tytuł, znacznik w PDF, treść z limitem) i cel eventu;
// karta liczby gości wypełnia się z pola „Liczba osób”. Kategorie z serwera (`op=offerAssumptions`), „Zaproponuj z AI” —
// `op=offerAssumptionsAI` (serwer dokłada zapytanie, pozycje, termin, miejsce i notatkę ze spotkania). „Gotowe” zapisuje karty
// i cel w szkicu oferty (bez zapisu na serwerze — trafią do oferty przy „Utwórz ofertę”).

@MainActor struct ShowcaseOfferAssumptionsSheet: View {
    @ObservedObject var offer: ShowcaseOfferStore
    let accent: Color
    /// Komunikat w oknie pokazu (sukces / błąd).
    let notify: (String, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var data: OfferAssumptionsData?
    @State private var items: [OfferAssumptionsData.Item] = []
    @State private var goal = ""
    @State private var loadError: String?
    @State private var aiOpen = false
    @State private var sources: String?

    /// Cel eventu — jak `EVENT_GOAL_MAX_LENGTH`.
    static let goalLimit = 2000

    private var guestCount: Int? { offer.draft.event.guestCount }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Założenia i cel eventu").font(.title3.weight(.semibold))
                    Text("Trzy najważniejsze informacje o realizacji — te same karty i znaczniki trafią do oferty PDF.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { aiOpen = true } label: { Label("Zaproponuj z AI", systemImage: "sparkles") }
                    .disabled(data == nil)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)

            if let data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if offer.draft.inquiryId != nil {
                            Text("Puste karty — oferta weźmie założenia i cel z zapytania klienta.").font(.caption).foregroundStyle(.secondary)
                        }
                        if let sources { Text(sources).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                        ForEach(items.indices, id: \.self) { index in card(index, data) }
                        ProductField(label: "Cel eventu", help: "\(goal.count)/\(Self.goalLimit)") {
                            ProductTextArea(text: Binding(get: { goal }, set: { goal = String($0.prefix(Self.goalLimit)) }),
                                            prompt: "Co klient chce osiągnąć? (np. integracja zespołu i podziękowanie za rok pracy)", lines: 3...6)
                        }
                    }
                    .padding(.horizontal, 18).padding(.bottom, 12)
                }
                .frame(height: 560)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć założeń", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
                .frame(height: 300)
            } else {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity).frame(height: 300)
            }

            HStack {
                Text("Zapis w szkicu oferty — trafi do oferty i PDF przy „Utwórz ofertę”.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Gotowe") { apply() }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(data == nil)
            }
            .padding(18)
        }
        .frame(width: 720)
        .task { await load() }
        .sheet(isPresented: $aiOpen) {
            ShowcaseOfferAssumptionsAISheet(offer: offer, items: items, goal: goal, options: data?.options ?? []) { draft in
                items = Self.syncGuests(draft.items, guestCount)
                if let generated = draft.goal { goal = String(generated.prefix(Self.goalLimit)) }
                sources = draft.sources
                notify(draft.goal != nil ? "AI uzupełniło założenia i cel eventu — sprawdź je i kliknij „Gotowe”." : "AI uzupełniło założenia — sprawdź je i kliknij „Gotowe”.", false)
            }
        }
    }

    private func option(_ key: String) -> OfferAssumptionsData.Option? { data?.options.first { $0.key == key } }

    private func card(_ index: Int, _ data: OfferAssumptionsData) -> some View {
        let item = items[index]
        let option = option(item.key)
        let guestCard = item.key == "guest_count"
        let used = Set(items.enumerated().filter { $0.offset != index }.map { $0.element.key })
        let choices = data.options.filter { $0.key == "custom" || $0.key == item.key || !used.contains($0.key) }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text("\(index + 1)").font(.callout.weight(.bold)).frame(width: 26, height: 26)
                    .background(accent.opacity(0.15), in: Circle()).foregroundStyle(accent)
                Picker("", selection: Binding(get: { item.key }, set: { change(index, key: $0, data) })) {
                    ForEach(choices) { choice in Text(choice.key == "custom" ? "Własne założenie" : choice.label).tag(choice.key) }
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
            if guestCard {
                Text(guestCount.map { "\($0) osób — z pola „Liczba osób” w sekcji Event." } ?? "Uzupełnij „Liczba osób” w sekcji Event — karta wypełni się sama.")
                    .font(.callout).foregroundStyle(accent)
            } else {
                ProductField(label: "Wartość liczbowa w znaczniku PDF",
                             help: "Np. „180”, „6 H” lub „2 SALE” — tylko gdy wynika to z ustaleń. Puste pole: PDF pokaże numer 0\(index + 1).") {
                    TextField("", text: Binding(get: { item.badge_value ?? "" },
                                                set: { items[index].badge_value = String($0.uppercased(with: Locale(identifier: "pl_PL")).prefix(7)) }),
                              prompt: Text("Puste pole = 0\(index + 1)"))
                        .textFieldStyle(.roundedBorder).frame(width: 160)
                }
                ProductField(label: option?.question ?? item.label, help: "\(item.value.count)/\(data.maxLength)") {
                    let binding = Binding(get: { item.value }, set: { items[index].value = String($0.prefix(data.maxLength)) })
                    if option?.multiline == true {
                        ProductTextArea(text: binding, prompt: option?.placeholder ?? "", lines: 3...6)
                    } else {
                        TextField("", text: binding, prompt: Text(option?.placeholder ?? "")).textFieldStyle(.roundedBorder)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    /// Zmiana kategorii karty — treść i znacznik domyślne kategorii, karta liczby gości z pola „Liczba osób”.
    private func change(_ index: Int, key: String, _ data: OfferAssumptionsData) {
        guard let next = data.options.first(where: { $0.key == key }) else { return }
        var cards = items
        cards[index] = OfferAssumptionsData.Item(key: key, label: key == "custom" ? "" : next.label, value: next.defaultValue, badge_value: next.defaultBadge)
        items = Self.syncGuests(cards, guestCount)
    }

    private func load() async {
        loadError = nil
        do {
            let next = try await offer.assumptionOptions()
            let saved = offer.draft.assumptions ?? []
            let cards = saved.count == 3
                ? saved.map { OfferAssumptionsData.Item(key: $0.key, label: $0.label, value: $0.value, badge_value: $0.badge) }
                : next.items
            items = Self.syncGuests(cards, guestCount)
            goal = offer.draft.goal ?? ""
            data = next
        } catch {
            loadError = offer.showcase?.failureText(error, "Nie udało się pobrać kategorii założeń.") ?? "Nie udało się pobrać kategorii założeń."
        }
    }

    /// Karty i cel do szkicu oferty.
    private func apply() {
        var next = offer.draft
        next.assumptions = Self.cards(items, guestCount)
        next.goal = goal
        offer.draft = next
        dismiss()
    }

    /// Karty do szkicu (znacznik w `badge`), z kartą liczby gości z pola „Liczba osób”.
    static func cards(_ items: [OfferAssumptionsData.Item], _ guests: Int?) -> [ShowcaseOfferAssumption] {
        syncGuests(items, guests).map { ShowcaseOfferAssumption(key: $0.key, label: $0.label, value: $0.value, badge: $0.badge_value ?? "") }
    }

    /// Karta liczby gości z pola „Liczba osób” (jak `syncGuestCountAssumptions`): istniejąca karta albo pierwsza pusta.
    static func syncGuests(_ items: [OfferAssumptionsData.Item], _ guests: Int?) -> [OfferAssumptionsData.Item] {
        var next = items
        guard let guests, (1...100_000).contains(guests) else {
            if guests == nil {
                for index in next.indices where next[index].key == "guest_count" {
                    next[index].value = ""
                    next[index].badge_value = ""
                }
            }
            return next
        }
        let card = OfferAssumptionsData.Item(key: "guest_count", label: "Liczba gości", value: "\(guests) osób", badge_value: "\(guests)")
        if let index = next.firstIndex(where: { $0.key == "guest_count" }) {
            next[index] = card
        } else if let index = next.firstIndex(where: { ShowcaseOfferRules.trimmed($0.value).isEmpty && ShowcaseOfferRules.trimmed($0.badge_value ?? "").isEmpty }) {
            next[index] = card
        } else if next.count < 3 {
            next.append(card)
        }
        return next
    }
}

/// „Zaproponuj założenia z AI”: wskazówki sprzedawcy (opcjonalnie) i cel eventu; propozycja zastępuje treści trzech kart.
@MainActor struct ShowcaseOfferAssumptionsAISheet: View {
    @ObservedObject var offer: ShowcaseOfferStore
    let items: [OfferAssumptionsData.Item]
    let goal: String
    let options: [OfferAssumptionsData.Option]
    let onDraft: (OfferAssumptionsDraft) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var instructions = ""
    @State private var generateGoal = true
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Zaproponuj założenia z AI").font(.title3.weight(.semibold))
            VStack(alignment: .leading, spacing: 4) {
                Text("Podstawa propozycji").font(.caption).foregroundStyle(.secondary)
                Text(offer.draft.inquiryId != nil
                     ? "AI uzupełni trzy wybrane karty w tej samej kolejności — z ustaleń, analiz i korespondencji zapytania, pozycji oferty, notatki ze spotkania i Twoich wskazówek."
                     : "AI uzupełni trzy wybrane karty w tej samej kolejności — z nazwy, terminu i miejsca eventu, pozycji oferty, notatki ze spotkania i Twoich wskazówek.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    Text("\(index + 1). \(title(item))").font(.callout)
                }
            }
            Toggle("Uzupełnij również cel eventu", isOn: $generateGoal)
            ProductField(label: "Co chcesz osiągnąć? (opcjonalnie)", help: "Puste pole = propozycja według bazowej instrukcji. \(instructions.count)/2000") {
                ProductTextArea(text: Binding(get: { instructions }, set: { instructions = String($0.prefix(2000)) }),
                                prompt: "Np. konferencja: podkreśl, że systemy liniowe dają każdemu na sali doskonały dźwięk. Ton profesjonalny, bez sloganów.",
                                lines: 4...7)
            }
            Text("Propozycja zastąpi treści trzech kart\(generateGoal ? " oraz cel eventu" : ""). Przed „Gotowe” możesz je poprawić.")
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
        .disabled(busy)
    }

    private func title(_ item: OfferAssumptionsData.Item) -> String {
        if item.key == "custom" { return item.label.isEmpty ? "Własne założenie" : item.label }
        return options.first { $0.key == item.key }?.label ?? (item.label.isEmpty ? item.key : item.label)
    }

    private func generate() async {
        busy = true
        problem = nil
        defer { busy = false }
        var draft = offer.draft
        draft.assumptions = ShowcaseOfferAssumptionsSheet.cards(items, draft.event.guestCount)
        draft.goal = goal
        do {
            let proposal = try await offer.draftAssumptions(draft, instructions: instructions.trimmingCharacters(in: .whitespacesAndNewlines),
                                                            generateGoal: generateGoal)
            guard proposal.items.count == 3 else {
                problem = "AI nie przygotowało trzech kompletnych założeń. Spróbuj ponownie."
                return
            }
            onDraft(proposal)
            dismiss()
        } catch {
            problem = offer.showcase?.failureText(error, "Nie udało się przygotować założeń przez AI.") ?? "Nie udało się przygotować założeń przez AI."
        }
    }
}
