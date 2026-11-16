import SwiftUI

// MARK: Przygotowanie realizacji krok po kroku (`SellerRealizationWizard`): kontakt na miejscu, miejsce i organizacja,
// materiały i wymagania (uzupełnia sprzedawca, sprawdza opiekun), plan realizacji (uzupełnia opiekun, potwierdza sprzedawca)
// i końcowe zatwierdzenie przygotowań. Szkic, przekazanie, zatwierdzenie i prośba o poprawki z identyfikatorem żądania
// (ponowienie nie dubluje), wersja i kontekst kroku sprawdzane w bazie; historia ostatnich zmian kroku.

@MainActor struct SellerRealizationWizardView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let offerID: String
    let refreshKey: Int
    /// Niezapisane ustalenia realizacji wstrzymują decyzje w krokach (jak `blocked` w CRM).
    let blocked: Bool
    @Binding var dirty: Bool
    /// Krok wskazany w powiadomieniu (`prepStep`).
    var focusStep: String?
    let go: (String) -> Void
    /// Po zapisie kroku — odświeżenie ustaleń (`seller-workspace-changed`).
    let changed: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var data: SellerWizardState?
    @State private var selected = "contact"
    @State private var payload: [String: JSONValue] = [:]
    @State private var note = ""
    @State private var editingApproved = false
    @State private var busy = false
    @State private var loading = true
    @State private var error = ""
    @State private var message = ""
    @State private var initialized = false
    @State private var request: (key: String, id: String)?
    @State private var readSequence = 0
    @State private var pendingStep: String?
    @State private var confirmingRefresh = false

    private var step: SellerWizardState.Step? { data?.steps.first { $0.key == selected } }
    private var definition: (key: String, title: String, author: String, reviewer: String)? { SellerWizardText.steps.first { $0.key == selected } }
    private var index: Int { SellerWizardText.keys.firstIndex(of: selected) ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("PRZYGOTOWANIE REALIZACJI KROK PO KROKU").font(.headline)
                Spacer()
                Button {
                    if dirty { confirmingRefresh = true } else { Task { await reload() } }
                } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
                .disabled(busy || loading)
            }
            Text("Dane, decyzje i poprawki są zapisane w krokach. Rozmowa pozostaje osobno. Wysłanie informacji ani zapis szkicu nie oznaczają zatwierdzenia.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if loading && data == nil { HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Wczytywanie przygotowań…") } }
            if !error.isEmpty { banner(error, .red) }
            if !message.isEmpty { banner(message, .green) }
            if blocked { Text("Najpierw zapisz lub odrzuć niezapisane ustalenia realizacji poniżej.").font(.caption).foregroundStyle(.orange) }
            if let data { content(data) }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .task(id: offerID) {
            await reload()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if NSApplication.shared.isActive { await reload() }
            }
        }
        .onChange(of: refreshKey) { _, _ in Task { await reload() } }
        .onChange(of: focusStep) { _, step in
            guard let step, data != nil, SellerWizardText.keys.contains(step), step != selected, !dirty, !busy else { return }
            apply(step)
        }
        .onDisappear { dirty = false }
        .alert("Zmienić krok i odrzucić niezapisane dane?", isPresented: Binding(get: { pendingStep != nil }, set: { if !$0 { pendingStep = nil } })) {
            Button("Odrzuć zmiany", role: .destructive) { if let key = pendingStep { apply(key) }; pendingStep = nil }
            Button("Anuluj", role: .cancel) { pendingStep = nil }
        }
        .alert("Odświeżyć i odrzucić niezapisane dane?", isPresented: $confirmingRefresh) {
            Button("Odśwież", role: .destructive) { dirty = false; request = nil; Task { await reload() } }
            Button("Anuluj", role: .cancel) {}
        }
    }

    private func banner(_ text: String, _ color: Color) -> some View {
        Text(text).font(.callout).foregroundStyle(color).fixedSize(horizontal: false, vertical: true)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Widok kroków

    @ViewBuilder private func content(_ data: SellerWizardState) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(SellerWizardText.keys.enumerated()), id: \.offset) { position, key in
                    let current = data.steps.first { $0.key == key }
                    let approved = key == "finish" ? data.completed : (current?.status == "approved" && current?.available == true)
                    let title = SellerWizardText.steps.first { $0.key == key }?.title ?? "Zatwierdzenie przygotowań"
                    Button { select(key) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            if approved { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                            else { Text("\(position + 1)/5").font(.caption.monospacedDigit()) }
                            Text(title).font(.caption).multilineTextAlignment(.leading)
                        }
                        .padding(10).frame(width: 150, alignment: .leading).frame(minHeight: 64, alignment: .topLeading)
                        .foregroundStyle(selected == key ? theme.accent : Color.secondary)
                        .background(selected == key ? theme.accent.opacity(0.15) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        Text("\(data.steps.filter { $0.available && $0.status == "approved" }.count)/4 kroków uzgodnionych · \(data.completed ? "przygotowania zatwierdzone" : "pozostaje końcowa decyzja opiekuna")")
            .font(.caption).foregroundStyle(.secondary)
        if data.active && !data.manager {
            Text("Masz dostęp tylko do podglądu przygotowań. Decyzje wymagają uprawnień do tej oferty i wydarzenia.").font(.callout).foregroundStyle(.orange)
        }
        if !data.active {
            Text(data.eventId == nil ? "Najpierw utwórz powiązane wydarzenie w CRM." : "Przygotowania są tylko do odczytu — sprawdź status wydarzenia i powiązanie oferty.")
                .font(.callout).foregroundStyle(.orange)
        }
        if let first = data.steps.first, first.status == "approved" {
            DisclosureGroup("Zatwierdzony kontakt na miejscu · \(SellerText.plain(first.payload["name"]))") {
                payloadView(first.payload).padding(.top, 6)
            }
            .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        }
        if selected == "finish" { finish(data) }
        else if let step, let definition { stepView(data, step, definition) }
        HStack {
            Button { select(SellerWizardText.keys[index - 1]) } label: { Label("Poprzedni", systemImage: "chevron.left") }
                .disabled(index == 0 || busy)
            Spacer()
            Button { select(SellerWizardText.keys[index + 1]) } label: { HStack(spacing: 4) { Text("Następny"); Image(systemName: "chevron.right") } }
                .disabled(index == SellerWizardText.keys.count - 1 || busy)
        }
        DisclosureGroup("Historia tego kroku · ostatnie zmiany") {
            let items = data.history.filter { $0.stepKey == selected }
            VStack(alignment: .leading, spacing: 10) {
                ForEach(items, id: \.revision) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(SellerText.timestamp(item.at)) · \(SellerWizardText.actions[item.action] ?? "Zmiana kroku") · wersja \(item.revision)")
                            .font(.caption).foregroundStyle(.secondary)
                        if let remark = item.reviewNote, !remark.isEmpty { Text(remark).font(.caption).foregroundStyle(.orange).textSelection(.enabled) }
                        if let values = item.payload { payloadView(values) }
                    }
                }
                if items.isEmpty { Text("Brak zapisanych zmian tego kroku.").font(.caption).foregroundStyle(.tertiary) }
            }
            .padding(.top, 6)
        }
        .padding(10).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        if dirty { Text("Masz niezapisane dane w tym kroku.").font(.caption).foregroundStyle(.orange) }
    }

    @ViewBuilder private func finish(_ data: SellerWizardState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ZATWIERDZENIE PRZYGOTOWAŃ · OPIEKUN").font(.callout.weight(.semibold))
            Text("Ten krok wymaga zatwierdzenia danych sprzedawcy, potwierdzenia planu przez sprzedawcę oraz osobnego potwierdzenia realizacji w CRM.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if data.confirmationRequired {
                Text("Realizacja nie została jeszcze potwierdzona w CRM. Zrób to w sekcji przygotowania wydarzenia.").font(.callout).foregroundStyle(.orange)
            }
            if data.completed {
                Text("Przygotowania zatwierdzone · \(SellerText.timestamp(data.completedAt))").font(.callout).foregroundStyle(.green)
            } else {
                Button { Task { await act("complete") } } label: { Label("Zatwierdź przygotowania", systemImage: "checkmark.seal") }
                    .buttonStyle(.borderedProminent).disabled(!data.canComplete || busy || blocked)
            }
            Text("Ta decyzja nie rezerwuje sprzętu, nie przypisuje pracowników i nie zmienia automatycznie statusu wydarzenia. Te operacje pozostają w CRM. Zmiana uzgodnionych danych wymaga ponownego sprawdzenia.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private func stepView(_ data: SellerWizardState, _ step: SellerWizardState.Step,
                                       _ definition: (key: String, title: String, author: String, reviewer: String)) -> some View {
        let previousRemark = data.history.first { $0.stepKey == selected && $0.action == "changes_requested" && ($0.reviewNote ?? "").isEmpty == false }
        let showForm = step.canSubmit && (step.status != "approved" || editingApproved)
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(index + 1). \(definition.title.uppercased())").font(.callout.weight(.semibold))
                Text("\(SellerWizardText.statuses[step.status] ?? "Sprawdź stan kroku") · \(step.status == "submitted" ? "Teraz: \(definition.reviewer)" : step.status == "approved" ? "Można przejść dalej" : "Teraz: \(definition.author)")")
                    .font(.callout).foregroundStyle(theme.accent)
            }
            if !step.available {
                banner("Najpierw zatwierdź poprzednie kroki. Zapisane dane tego kroku pozostają dostępne.", .orange)
            }
            if let remark = step.reviewNote, !remark.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Uwagi do tego kroku").font(.caption).foregroundStyle(theme.accent)
                    Text(remark).font(.callout).textSelection(.enabled)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            Group {
                if selected == "organization" {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Termin CRM: \(SellerText.localDate(data.context.startsAt)) — \(SellerText.localDate(data.context.endsAt))")
                        Text("Miejsce CRM: \(data.context.location?.nonEmpty ?? "Do ustalenia z opiekunem")")
                        Text("Zmianę terminu lub obiektu opiekun zapisuje w wydarzeniu. Ten krok nie nadpisuje kalendarza.").font(.caption).foregroundStyle(.secondary)
                    }
                    .font(.callout).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
                if selected == "materials" {
                    DisclosureGroup("Wymagania wynikające z oferty") {
                        VStack(alignment: .leading, spacing: 8) {
                            if let due = data.context.materialsDue, !due.isEmpty { Text("Materiały do: \(SellerText.localDate(due))") }
                            ForEach(Array(data.context.requirements.enumerated()), id: \.offset) { _, item in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.name).fontWeight(.semibold)
                                    let details = [item.technical, item.accommodation, item.logistics].compactMap { $0 }.filter { !$0.isEmpty }
                                    Text(details.isEmpty ? "Brak szczególnych wymagań zapisanych przy produkcie." : details.joined(separator: "\n"))
                                }
                            }
                        }
                        .font(.caption).foregroundStyle(.secondary).textSelection(.enabled).padding(.top, 6)
                    }
                    .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
                if selected == "plan" && data.eventId != nil {
                    FlowButtons(items: SellerWizardText.planChecks.map { ($0.tab, $0.label + " ↗") }) { tab in go(tab) }
                }
            }
            if (step.reviewNote ?? "").isEmpty, let previousRemark {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Wcześniejsze uwagi do sprawdzenia · \(SellerText.timestamp(previousRemark.at))").font(.caption).foregroundStyle(theme.accent)
                    Text(previousRemark.reviewNote ?? "").font(.callout).textSelection(.enabled)
                    if step.status == "submitted" {
                        Text("Powyżej są uwagi z poprzedniej rundy. Poniżej sprawdź ponownie przekazane dane.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            if step.canSubmit && step.status == "approved" && !editingApproved {
                Button("Zmień dane tego kroku") { editingApproved = true }.disabled(busy || blocked)
            }
            if showForm { form(data, step, definition) } else { payloadView(step.payload) }
            if step.canReview { review }
            if selected == "contact", let legacy = data.legacyContactBody, !legacy.isEmpty {
                DisclosureGroup("Wcześniej przekazana informacja z czatu — bez zatwierdzenia kroku") {
                    Text(legacy).font(.caption).foregroundStyle(.secondary).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                }
                .font(.caption)
            }
        }
    }

    private var review: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Uwagi do kroku — wymagane przy prośbie o poprawki").font(.callout)
            TextField("Uwagi do kroku", text: Binding(get: { note }, set: { note = String($0.prefix(3000)); dirty = true }), axis: .vertical)
                .lineLimit(3...8).textFieldStyle(.roundedBorder).labelsHidden().disabled(busy || blocked)
            HStack {
                Button { Task { await act("approve") } } label: { Label("Zatwierdź krok", systemImage: "checkmark") }
                    .buttonStyle(.borderedProminent).disabled(busy || blocked)
                Button { Task { await act("changes_requested") } } label: { Label("Poproś o poprawki", systemImage: "arrow.uturn.backward") }
                    .disabled(busy || blocked || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Formularze kroków

    @ViewBuilder private func form(_ data: SellerWizardState, _ step: SellerWizardState.Step,
                                   _ definition: (key: String, title: String, author: String, reviewer: String)) -> some View {
        let locked = step.status == "approved" && !dirty
        VStack(alignment: .leading, spacing: 10) {
            Group {
                switch selected {
                case "contact":
                    if let imported = SellerWizardText.legacyContact(data.legacyContactBody), step.payload.isEmpty {
                        Button("Wczytaj wcześniej przekazany kontakt") {
                            change(imported.mapValues { JSONValue.string($0) })
                        }
                    }
                    contactFields(data)
                    input("note", "Dodatkowe informacje", multiline: true, required: false)
                case "organization":
                    HStack(alignment: .top, spacing: 10) {
                        input("room", "Sala / przestrzeń")
                        input("participants", "Liczba uczestników")
                    }
                    input("access", "Dojazd, dostęp, odbiór zespołu na miejscu", multiline: true)
                    input("note", "Dodatkowe informacje", multiline: true, required: false)
                    Toggle("Sprawdziłem/-am pokazany termin i miejsce wydarzenia.", isOn: flag("schedule_confirmed")).toggleStyle(.checkbox)
                case "materials":
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Materiały *").font(.callout)
                        Picker("Materiały", selection: Binding(get: { SellerText.plain(payload["mode"]) }, set: { change(["mode": .string($0)]) })) {
                            Text("Wybierz…").tag("")
                            Text("Przekazuję materiały pod linkiem").tag("provided")
                            Text("Materiały nie są potrzebne").tag("none")
                        }
                        .labelsHidden().frame(maxWidth: 360)
                    }
                    if SellerText.plain(payload["mode"]) == "provided" { input("url", "Link do materiałów lub folderu") }
                    input("technical", "Potwierdzenie wymagań technicznych", multiline: true)
                    input("logistics", "Logistyka i noclegi — ustalenia lub „nie dotyczy”", multiline: true)
                    let none = SellerText.plain(payload["mode"]) == "none"
                    input("note", none ? "Dlaczego materiały nie są potrzebne?" : "Dodatkowe informacje", multiline: true, required: none)
                default:
                    Text("Przygotuj plan w sekcjach CRM, a następnie zaznacz sprawdzone obszary. Jeśli coś nie dotyczy wydarzenia, wyjaśnij to w podsumowaniu. Zaznaczenie nie wykonuje rezerwacji ani przypisania.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    ForEach(SellerWizardText.planChecks, id: \.key) { check in
                        Toggle(check.label, isOn: flag(check.key)).toggleStyle(.checkbox)
                    }
                    input("summary", "Plan do potwierdzenia przez sprzedawcę — bez wewnętrznych cen i rozliczeń", multiline: true)
                }
            }
            .disabled(busy || blocked)
            HStack {
                Button("Zapisz szkic") { Task { await act("save") } }.disabled(locked || busy || blocked)
                Button { Task { await submit() } } label: {
                    HStack(spacing: 6) {
                        if busy { ProgressView().controlSize(.small) }
                        Text("Przekaż do sprawdzenia · \(definition.reviewer)")
                    }
                }
                .buttonStyle(.borderedProminent).disabled(locked || busy || blocked)
            }
            if step.status == "approved" {
                Text("Zmiana zatwierdzonych danych otworzy ten krok ponownie i może wymagać ponownego potwierdzenia kolejnych kroków.")
                    .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// `SellerOnsiteContactFields` — osoba kontaktowa na miejscu (propozycja w kroku, bez zmiany wizytówki i bazy kontaktów).
    @ViewBuilder private func contactFields(_ data: SellerWizardState) -> some View {
        let source = SellerText.plain(payload["source"])
        let hasClient = data.client.hasData
        VStack(alignment: .leading, spacing: 8) {
            Text("Kto będzie osobą kontaktową na miejscu?").font(.callout)
            HStack(spacing: 8) {
                ForEach(SellerWizardText.sources, id: \.value) { choice in
                    Button { selectSource(choice.value, data) } label: {
                        HStack(spacing: 6) {
                            Image(systemName: source == choice.value ? "largecircle.fill.circle" : "circle")
                            Text(choice.label)
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .foregroundStyle(source == choice.value ? theme.accent : Color.primary)
                        .background(source == choice.value ? theme.accent.opacity(0.15) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(choice.value == "client" && !hasClient)
                    .opacity(choice.value == "client" && !hasClient ? 0.5 : 1)
                }
            }
            if !hasClient {
                Text("Przy tej ofercie nie ma danych klienta. Wybierz osobistą koordynację lub inny kontakt.").font(.caption).foregroundStyle(.secondary)
            }
            if !source.isEmpty {
                let company = (data.client.company?.nonEmpty).map { ": " + $0 } ?? ""
                Text((source == "seller" ? "Dane z Twojej wizytówki. Sprawdź telefon dostępny w dniu wydarzenia."
                      : source == "client" ? "Dane klienta z tej oferty\(company). Uzupełnij brakujące pola."
                      : "Podaj dane osoby, z którą zespół będzie mógł skontaktować się na miejscu.")
                     + " Możesz poprawić pola poniżej — nie zmieni to wizytówki ani bazy kontaktów.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if source == "seller" {
                    // Sesja CRM nie jest sesją portalu sprzedawcy — wizytówki sprzedawcy nie podstawiamy (jak w CRM).
                    Text("Nie udało się pobrać Twoich danych. Uzupełnij je ręcznie.").font(.caption).foregroundStyle(.orange)
                }
                Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 8) {
                    GridRow {
                        input("name", "Imię i nazwisko", limit: 160)
                        input("role", "Stanowisko / rola", limit: 100)
                    }
                    GridRow {
                        input("phone", "Telefon", limit: 50)
                        input("email", "E-mail (opcjonalnie)", required: false, limit: 254)
                    }
                }
            }
        }
    }

    private func selectSource(_ source: String, _ data: SellerWizardState) {
        let trim = { (value: String?) in (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        switch source {
        case "seller":
            change(["source": .string(source), "name": .string(""), "role": .string("Koordynator na miejscu"), "phone": .string(""), "email": .string("")])
        case "client":
            change(["source": .string(source), "name": .string(trim(data.client.name)), "role": .string("Klient — kontakt na miejscu"),
                    "phone": .string(trim(data.client.phone)), "email": .string(trim(data.client.email))])
        default:
            change(["source": .string(source), "name": .string(""), "role": .string(""), "phone": .string(""), "email": .string("")])
        }
    }

    private func input(_ key: String, _ label: String, multiline: Bool = false, required: Bool = true, limit: Int? = nil) -> some View {
        let max = limit ?? (key == "summary" ? 4000 : multiline ? 3000 : key == "room" ? 200 : 2000)
        let binding = Binding<String>(get: { SellerText.plain(payload[key]) }, set: { change([key: .string(String($0.prefix(max)))]) })
        return VStack(alignment: .leading, spacing: 4) {
            Text(label + (required ? " *" : "")).font(.callout)
            if multiline {
                TextField(label, text: binding, axis: .vertical).lineLimit(3...10).textFieldStyle(.roundedBorder).labelsHidden()
            } else {
                TextField(label, text: binding).textFieldStyle(.roundedBorder).labelsHidden()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func flag(_ key: String) -> Binding<Bool> {
        Binding(get: { payload[key] == .bool(true) }, set: { change([key: .bool($0)]) })
    }

    /// `PayloadView` — zapisane dane kroku w kolejności bazy, bez pustych pól.
    private func payloadView(_ value: [String: JSONValue]) -> some View {
        let keys = SellerWizardText.orderedKeys(value).filter { key in
            guard SellerWizardText.fields[key] != nil, let item = value[key] else { return false }
            return item != .null && item != .string("")
        }
        return VStack(alignment: .leading, spacing: 8) {
            ForEach(keys, id: \.self) { key in
                VStack(alignment: .leading, spacing: 2) {
                    Text(SellerWizardText.fields[key] ?? key).font(.caption).foregroundStyle(.secondary)
                    Text(SellerWizardText.value(key, value[key] ?? JSONValue.null)).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
            }
            if keys.isEmpty { Text("Brak zapisanych danych.").font(.caption).foregroundStyle(.tertiary) }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Stan i zapis

    private func initialPayload(_ next: SellerWizardState, _ key: String) -> [String: JSONValue] {
        if let saved = next.steps.first(where: { $0.key == key })?.payload, !saved.isEmpty { return saved }
        switch key {
        case "organization":
            let participants: JSONValue = next.context.participants.map { $0 == 0 ? JSONValue.string("") : JSONValue.number($0) } ?? JSONValue.string("")
            return ["room": .string(next.context.room?.nonEmpty ?? next.context.location?.nonEmpty ?? ""), "participants": participants,
                    "access": .string(""), "schedule_confirmed": .bool(false)]
        case "materials":
            return ["mode": .string(""), "url": .string(""), "technical": .string(next.context.technical ?? ""),
                    "logistics": .string(next.context.logistics ?? ""), "note": .string("")]
        default:
            return [:]
        }
    }

    private func adopt(_ next: SellerWizardState) {
        data = next
        var key = selected
        if !initialized {
            if let focusStep, SellerWizardText.keys.contains(focusStep) { key = focusStep }
            else { key = next.steps.first { $0.status != "approved" }?.key ?? "finish" }
            initialized = true
        }
        selected = key
        payload = initialPayload(next, key)
        note = ""
        editingApproved = false
    }

    private func reload() async {
        if dirty || busy { return }
        readSequence += 1
        let sequence = readSequence
        loading = true
        do {
            let next = try await store.tabQuery(eventID, "seller-arrangements", "wizard", ["offerId": offerID], as: SellerWizardState.self)
            if sequence == readSequence && !dirty && !busy { adopt(next); error = "" }
        } catch {
            if sequence == readSequence { self.error = store.failureText(error, "Nie udało się wczytać kroków.") }
        }
        if sequence == readSequence { loading = false }
    }

    private func select(_ key: String) {
        if busy { return }
        if dirty { pendingStep = key; return }
        apply(key)
    }

    private func apply(_ key: String) {
        dirty = false
        request = nil
        message = ""
        note = ""
        editingApproved = false
        selected = key
        if let data { payload = initialPayload(data, key) }
    }

    private func change(_ patch: [String: JSONValue]) {
        dirty = true
        payload.merge(patch) { _, new in new }
        message = ""
    }

    /// Wymagane pola formularza (jak walidacja przeglądarki przy „Przekaż do sprawdzenia”); pełne sprawdzenie robi baza.
    private func missing() -> String? {
        func text(_ key: String) -> String { SellerText.plain(payload[key]).trimmingCharacters(in: .whitespacesAndNewlines) }
        func need(_ key: String, _ label: String) -> String? { text(key).isEmpty ? "Uzupełnij pole „\(label)”." : nil }
        switch selected {
        case "contact":
            if text("source").isEmpty { return "Wybierz osobę kontaktową na miejscu." }
            for (key, label) in [("name", "Imię i nazwisko"), ("role", "Stanowisko / rola"), ("phone", "Telefon")] {
                if let problem = need(key, label) { return problem }
            }
            let email = text("email")
            if !email.isEmpty && email.range(of: #"^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$"#, options: .regularExpression) == nil {
                return "Popraw adres e-mail albo pozostaw to pole puste."
            }
        case "organization":
            for (key, label) in [("room", "Sala / przestrzeń"), ("participants", "Liczba uczestników"), ("access", "Dojazd, dostęp, odbiór zespołu na miejscu")] {
                if let problem = need(key, label) { return problem }
            }
            guard let count = Int(text("participants")), (1...1_000_000).contains(count) else {
                return "Liczba uczestników: podaj liczbę całkowitą od 1 do 1 000 000."
            }
        case "materials":
            if text("mode").isEmpty { return "Uzupełnij pole „Materiały”." }
            if text("mode") == "provided" {
                if let problem = need("url", "Link do materiałów lub folderu") { return problem }
                guard let url = URL(string: text("url")), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
                    return "Podaj poprawny adres linku do materiałów (https://…)."
                }
            }
            if let problem = need("technical", "Potwierdzenie wymagań technicznych") { return problem }
            if let problem = need("logistics", "Logistyka i noclegi — ustalenia lub „nie dotyczy”") { return problem }
            if text("mode") == "none", let problem = need("note", "Dlaczego materiały nie są potrzebne?") { return problem }
        case "plan":
            if let problem = need("summary", "Plan do potwierdzenia przez sprzedawcę — bez wewnętrznych cen i rozliczeń") { return problem }
        default:
            break
        }
        return nil
    }

    private func submit() async {
        if let problem = missing() { error = problem; message = ""; return }
        await act("submit")
    }

    private func act(_ action: String) async {
        guard let data, !busy, !blocked else { return }
        let current = data.steps.first { $0.key == selected }
        var body: [String: JSONValue] = [
            "step": .string(selected), "operation": .string(action), "revision": .number(Double(data.revision)),
            "contextKey": .string(selected == "finish" ? data.finishKey : (current?.contextKey ?? "")),
            "payload": .object(["save", "submit"].contains(action) ? payload : [:]),
            "note": .string(["approve", "changes_requested"].contains(action) ? note : ""),
        ]
        let key = body.canonicalKey
        if request?.key != key { request = (key: key, id: UUID().uuidString.lowercased()) }
        body["offerId"] = .string(offerID)
        body["requestId"] = .string(request?.id ?? UUID().uuidString.lowercased())
        busy = true
        readSequence += 1
        error = ""
        defer { busy = false; loading = false }
        do {
            let reply = try await store.tabAction(eventID, "seller-arrangements", "wizardUpdate", body, reload: [], success: nil, pending: nil)
            let next = try JSONDecoder().decode(SellerWizardState.self, from: reply)
            dirty = false
            request = nil
            adopt(next)
            message = action == "save" ? "Szkic zapisany. Krok nie jest jeszcze przekazany do sprawdzenia."
                : action == "submit" ? "Dane zapisane w kroku i przekazane drugiej stronie."
                : action == "changes_requested" ? "Uwagi zapisane. Krok wrócił do poprawy."
                : action == "complete" ? "Przygotowania zatwierdzone przez opiekuna." : "Krok zatwierdzony. Można przejść dalej."
            changed()
        } catch {
            self.error = store.failureText(error, "Nie udało się potwierdzić zapisu. Dane pozostają w formularzu.")
        }
    }
}

/// Przyciski-odnośniki zawijane do kolejnych wierszy (np. sekcje karty wydarzenia do sprawdzenia planu).
struct FlowButtons: View {
    let items: [(String, String)]
    let action: (String) -> Void
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(items, id: \.0) { item in
                Button(item.1) { action(item.0) }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
