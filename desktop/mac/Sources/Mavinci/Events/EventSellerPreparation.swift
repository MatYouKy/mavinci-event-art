import SwiftUI

// MARK: Przygotowanie wydarzenia z oferty (`SellerEventPreparation`) i potwierdzenie realizacji (`CreateSellerEventModal`):
// etap realizacji powiązanej z ofertą, przejścia do sekcji karty, a gdy wydarzenie oczekuje — sprawdzenie danych
// i osobne potwierdzenie realizacji (`complete_seller_event_handoff`, bez tworzenia kolejnej kopii wydarzenia).

@MainActor struct SellerPreparationPanel: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let offerID: String
    let go: (String) -> Void
    /// Po potwierdzeniu realizacji — odświeżenie kreatora, ustaleń i karty wydarzenia.
    let confirmed: () async -> Void
    @Environment(\.crmTheme) private var theme
    @State private var data: SellerPreparationState?
    @State private var error = ""
    @State private var loading = true
    @State private var refresh = 0
    @State private var confirming = false

    private static let sections: [(String, String, String)] = [
        ("phases", "Timeline", "Godziny i etapy pracy"), ("team", "Zespół", "Pracownicy i zaproszenia"), ("equipment", "Sprzęt", "Plan, braki i rezerwacje"),
        ("agenda", "Agenda", "Program eventu"), ("logistics", "Logistyka", "Transport, kierowcy i przejazdy"), ("finances", "Finanse i prowizje", "Planowane rozliczenia i wypłaty"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Przygotowanie eventu z oferty", systemImage: "calendar").font(.headline)
                Spacer()
                Button { refresh += 1 } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless).help("Odśwież przygotowanie eventu").disabled(loading)
            }
            if loading && data == nil {
                HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Wczytywanie stanu realizacji…").foregroundStyle(.secondary) }
            }
            if !error.isEmpty { Text(error).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            if let data, data.matching {
                let pending = data.stage == "awaiting_crm_confirmation"
                Text(pending ? "Oferta przyjęta — event istnieje i oczekuje na potwierdzenie realizacji. Możesz już przygotować plan."
                     : data.stage == "cancelled" ? "Event anulowany. Zachowano dokumenty i historię przygotowań."
                     : "Event jest powiązany z ofertą. Dalsze przygotowanie prowadzisz w standardowych sekcjach CRM.")
                    .font(.callout).foregroundStyle(pending ? Color.orange : Color.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                let seller = [data.sellerName ?? "", data.sellerOrganization ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
                if !seller.isEmpty { Text(seller).font(.callout).foregroundStyle(.secondary) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 8)], spacing: 8) {
                    ForEach(Self.sections, id: \.0) { section in
                        Button { go(section.0) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(section.1).font(.callout.weight(.medium)).foregroundStyle(theme.accent)
                                Text(section.2).font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(10).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                Text("Zakres sprzętu pochodzi z produktów i konfiguracji oferty. Linie planowane nie rezerwują egzemplarzy. Zespół i pojazdy wybierasz w CRM; nie wysyłamy zaproszeń przy samej akceptacji. Prowizja jest planowana tylko przy włączonym modelu prowizyjnym — nie jest wypłatą.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if pending && data.canManage && data.canCreateEvent {
                    Button { confirming = true } label: { Label("Sprawdź dane i potwierdź realizację", systemImage: "checkmark.seal") }
                        .buttonStyle(.borderedProminent).disabled(!data.autoEventReady)
                }
                if pending && !data.autoEventReady {
                    Text("Potwierdzenie wymaga migracji 20261028170000_seller_acceptance_event_handoff.sql.").font(.caption).foregroundStyle(.orange)
                }
            }
            if !loading && error.isEmpty && data?.matching != true {
                Text("Nie potwierdzono dostępu do tej relacji oferty i eventu. Odśwież dane lub wróć do oferty źródłowej.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .task(id: "\(offerID)|\(refresh)") { await load() }
        .sheet(isPresented: $confirming) {
            SellerRealizationConfirmSheet(store: store, eventID: eventID, offerID: offerID) {
                refresh += 1
                await confirmed()
            }
        }
    }

    private func load() async {
        loading = true
        error = ""
        defer { loading = false }
        do {
            data = try await store.tabQuery(eventID, "seller-arrangements", "preparation", ["offerId": offerID], as: SellerPreparationState.self)
        } catch {
            data = nil
            self.error = store.failureText(error, "Nie udało się wczytać stanu przygotowania.")
        }
    }
}

/// „Potwierdź realizację” — dane wydarzenia z oferty do sprawdzenia, terminy w czasie polskim, miejsce z bazy lokalizacji,
/// kategoria i opis; zapis tylko po zaznaczeniu osobnego potwierdzenia.
@MainActor struct SellerRealizationConfirmSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let offerID: String
    let created: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: SellerEventDraft?
    @State private var loading = true
    @State private var saving = false
    @State private var problem: String?
    @State private var name = ""
    @State private var location = ""
    @State private var locationID: String?
    @State private var description = ""
    @State private var categoryID = ""
    @State private var slots: [String: SellerSlot] = [:]
    @State private var confirmed = false
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Label("Potwierdź realizację", systemImage: "calendar").font(.title2.bold())
                Text("Event powstaje już przy akceptacji oferty. Tutaj sprawdzasz jego dane i potwierdzasz realizację — bez tworzenia kolejnej kopii.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if loading { HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Wczytywanie danych sprzedawcy…") } }
                    if let problem { Text(problem).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                    if let draft {
                        if let id = draft.eventId, draft.alreadyConfirmed {
                            Text("Ten event został już potwierdzony. Jego dalsze przygotowanie prowadzisz w CRM.")
                            Button("Przejdź do eventu") { dismiss(); state.showEvent(id, cardTab: nil) }.buttonStyle(.borderedProminent)
                        } else {
                            form(draft)
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack {
                Spacer()
                Button("Dokończę później") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                if let draft, !draft.alreadyConfirmed {
                    Button(saving ? "Potwierdzanie i zapisywanie…" : "Potwierdź realizację") { Task { await submit() } }
                        .buttonStyle(.borderedProminent).disabled(!confirmed || saving)
                }
            }
            .padding(16)
        }
        .frame(width: 720, height: 720)
        .interactiveDismissDisabled(saving)
        .task { await load() }
    }

    @ViewBuilder private func form(_ draft: SellerEventDraft) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(draft.brandName) · \(draft.offerNumber)")
            Text("Event oczekuje na Twoje potwierdzenie. Oferta, sprzedawca i plan przygotowania pozostają powiązane.").foregroundStyle(.orange)
        }
        .font(.callout).padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        VStack(alignment: .leading, spacing: 4) {
            Text("Nazwa eventu *").font(.callout.weight(.medium))
            TextField("Nazwa eventu", text: Binding(get: { name }, set: { name = String($0.prefix(250)) })).textFieldStyle(.roundedBorder).disabled(saving)
        }
        SellerEventDaysSummary(days: draft.eventDays)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(SellerText.schedule, id: \.key) { item in
                SellerSlotField(label: item.label + (item.key == "starts_at" || item.key == "ends_at" ? " *" : ""),
                                slot: Binding(get: { slots[item.key] ?? SellerSlot() }, set: { slots[item.key] = $0 }),
                                fallback: slots["starts_at"]?.date ?? "")
                    .disabled(saving)
            }
            Text("Godziny w strefie Europe/Warsaw. Brakujących godzin nie uzupełniamy automatycznie.").font(.caption).foregroundStyle(.secondary)
        }
        locationPicker(draft)
        VStack(alignment: .leading, spacing: 4) {
            Text("Kategoria (opcjonalnie)").font(.callout.weight(.medium))
            Picker("Kategoria eventu", selection: $categoryID) {
                Text("Bez kategorii").tag("")
                ForEach(draft.categories, id: \.id) { category in Text(category.name).tag(category.id) }
            }
            .labelsHidden().frame(maxWidth: 360).disabled(saving)
            if let error = draft.categoryError { Text(error).font(.caption).foregroundStyle(.orange) }
        }
        VStack(alignment: .leading, spacing: 6) {
            Text("KLIENT I KONTAKTY Z OFERTY").font(.callout.weight(.medium))
            let client = [draft.client.company, draft.client.name, draft.client.email, draft.client.phone].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            Text(client.isEmpty ? "Nie podano danych klienta" : client).textSelection(.enabled)
            ForEach(Array(draft.contacts.enumerated()), id: \.offset) { _, contact in
                Text([contact.name, contact.role, contact.email, contact.phone].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
            Text("Dane z oferty pozostają w opisie i ustaleniach. Istniejące powiązania klienta są zachowane. Prywatnej bazy sprzedawcy nie kopiujemy automatycznie do CRM; klient i nabywca nie są zastępowani hotelem sprzedawcy.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        VStack(alignment: .leading, spacing: 6) {
            Text("ZAKRES Z ZAAKCEPTOWANEJ OFERTY").font(.callout.weight(.medium))
            ForEach(draft.items, id: \.id) { item in
                Text("\(item.name) · \(SellerText.plain(.number(item.quantity))) \(item.unit?.nonEmpty ?? "szt.")")
            }
            if !draft.room.isEmpty { Text("Sala: \(draft.room)").font(.caption).foregroundStyle(.secondary) }
            if !draft.technical.isEmpty { Text("Wymagania: \(draft.technical)").font(.caption).foregroundStyle(.secondary) }
            if !draft.logistics.isEmpty { Text("Logistyka: \(draft.logistics)").font(.caption).foregroundStyle(.secondary) }
            Text("Zakres sprzętu jest planem, nie potwierdzoną rezerwacją. W CRM uzupełnisz Timeline, zespół, agendę i logistykę. Zmiana dat tutaj nie nadpisuje ręcznie przygotowanych faz Timeline.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        VStack(alignment: .leading, spacing: 4) {
            Text("Opis eventu").font(.callout.weight(.medium))
            TextEditor(text: Binding(get: { description }, set: { description = String($0.prefix(max(10000, draft.description.count))) }))
                .font(.body).frame(minHeight: 90).scrollContentBackground(.hidden)
                .padding(4).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6)).disabled(saving)
        }
        Toggle(isOn: $confirmed) {
            Text("Potwierdzam realizację po sprawdzeniu terminu, zasobów i ustaleń. Potwierdzę ten event w CRM, a sprzedawca otrzyma osobne powiadomienie.")
                .fixedSize(horizontal: false, vertical: true)
        }
        .toggleStyle(.checkbox).padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8)).disabled(saving)
    }

    /// Miejsce: podane przez sprzedawcę (bez powiązania) albo obiekt z bazy lokalizacji CRM.
    @ViewBuilder private func locationPicker(_ draft: SellerEventDraft) -> some View {
        let options = draft.locations.filter { $0.matches(query) }
        let sellerSelected = locationID == nil && !location.isEmpty
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Miejsce eventu").font(.callout.weight(.medium))
                Spacer()
                if locationID != nil || !location.isEmpty {
                    Button("Wyczyść") { locationID = nil; location = "" }.buttonStyle(.link).font(.caption).disabled(saving)
                }
            }
            TextField("Wyszukaj obiekt, miasto lub adres…", text: $query).textFieldStyle(.roundedBorder).disabled(saving)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    if !draft.location.isEmpty && (query.isEmpty || draft.location.lowercased().contains(query.lowercased())) {
                        row(title: draft.location, detail: "Miejsce podane przez sprzedawcę — bez powiązania z bazą", selected: sellerSelected && location == draft.location) {
                            locationID = nil; location = draft.location
                        }
                    }
                    ForEach(options) { item in
                        let detail = [item.address ?? "", item.city ?? "", item.postal_code ?? ""].filter { !$0.isEmpty }.joined(separator: ", ")
                        row(title: item.name, detail: detail.isEmpty ? (item.formatted_address ?? "") : detail, selected: locationID == item.id) {
                            locationID = item.id
                            location = [item.name, item.address ?? "", item.city ?? "", item.postal_code ?? ""].filter { !$0.isEmpty }.joined(separator: ", ")
                        }
                    }
                    if options.isEmpty && draft.location.isEmpty {
                        Text(draft.locationsError != nil ? "Nie udało się wczytać lokalizacji" : "Brak pasujących lokalizacji w bazie")
                            .font(.callout).foregroundStyle(.secondary).padding(6)
                    }
                }
            }
            .frame(height: 150)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            .disabled(saving)
            if let error = draft.locationsError { Text(error).font(.caption).foregroundStyle(.orange) }
            if !location.isEmpty { Text("Wybrane: \(location)").font(.caption).foregroundStyle(.secondary) }
            if locationID != nil { Text("Event zostanie powiązany z wybranym obiektem w bazie CRM.").font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func row(title: String, detail: String, selected: Bool, pick: @escaping () -> Void) -> some View {
        Button(action: pick) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "mappin").foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.callout.weight(.medium))
                    if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(theme.accent) }
            }
            .padding(6)
            .background(selected ? theme.accent.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let next = try await store.tabQuery(eventID, "seller-arrangements", "eventDraft", ["offerId": offerID], as: SellerEventDraft.self)
            draft = next
            name = next.name
            location = next.location
            locationID = next.locationId
            categoryID = next.categoryId ?? ""
            description = next.description
            var values: [String: SellerSlot] = [:]
            for item in SellerText.schedule { values[item.key] = SellerSlot(next.slot(item.key)) }
            slots = values
        } catch {
            problem = store.failureText(error, "Nie udało się wczytać danych eventu.")
        }
    }

    private func submit() async {
        guard let draft, !saving else { return }
        problem = nil
        guard confirmed else { problem = "Zaznacz osobne potwierdzenie realizacji po sprawdzeniu danych eventu."; return }
        var schedule: [String: JSONValue] = [:]
        var values: [String: String] = [:]
        for item in SellerText.schedule {
            let slot = slots[item.key] ?? SellerSlot()
            if slot.date.isEmpty != slot.time.isEmpty { problem = "\(item.label): uzupełnij datę oraz godzinę albo pozostaw oba pola puste."; return }
            if !slot.time.isEmpty && !SellerText.validTime(slot.time) { problem = "Popraw daty zaznaczone w formularzu."; return }
            schedule[item.key] = slot.json
            if !slot.date.isEmpty { values[item.key] = slot.date + "T" + slot.time }
        }
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let start = values["starts_at"], let end = values["ends_at"] else {
            problem = "Uzupełnij nazwę oraz daty i godziny rozpoczęcia i zakończenia eventu."; return
        }
        guard end > start else { problem = "Koniec musi być późniejszy niż początek eventu."; return }
        saving = true
        defer { saving = false }
        let body: [String: JSONValue] = [
            "offerId": .string(offerID), "sourceKey": .string(draft.sourceKey), "revision": .number(Double(draft.revision)), "confirm": .bool(true),
            "values": .object([
                "eventUpdatedAt": draft.eventUpdatedAt.map { JSONValue.string($0) } ?? JSONValue.null,
                "name": .string(title), "location": .string(location.trimmingCharacters(in: .whitespacesAndNewlines)),
                "locationId": locationID.map { JSONValue.string($0) } ?? JSONValue.null, "description": .string(description),
                "categoryId": categoryID.isEmpty ? .null : .string(categoryID), "schedule": .object(schedule),
            ]),
        ]
        do {
            try await store.tabAction(eventID, "seller-arrangements", "confirmRealization", body, reload: [], success: "Realizacja potwierdzona. Sprzedawca otrzyma osobne powiadomienie.", pending: "Potwierdzanie realizacji…")
            await created()
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać eventu. Formularz pozostaje otwarty.")
        }
    }
}

/// `SellerEventScheduleSummary` — dni i godziny z ustaleń oferty.
struct SellerEventDaysSummary: View {
    let days: [SellerDay]?
    var body: some View {
        if let days, !days.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Dni i godziny eventu · ustalenia oferty").font(.callout.weight(.medium))
                ForEach(Array(days.enumerated()), id: \.offset) { index, day in
                    (Text("Dzień \(index + 1)  ").foregroundColor(.secondary) + Text(SellerSchedule.eventDayLabel(day))).font(.callout)
                }
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}
