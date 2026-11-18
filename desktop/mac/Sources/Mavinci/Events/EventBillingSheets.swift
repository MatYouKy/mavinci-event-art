import SwiftUI
import AppKit

// MARK: Okna edycji rozliczenia i prowizji wydarzenia (panel boczny karty, `EventBillingPanel`): sposób rozliczenia i nabywca
// faktur z opiekunami i sprzedawcą pozyskującym wydarzenie, wspólne rozliczenie kilku wydarzeń, dodanie osoby do prowizji
// (sprzedawca z kartoteki albo własne warunki), edycja wpisu ręcznego oraz termin i notatka prowizji z podsumowania.

// MARK: Wybór z wyszukiwaniem (`SearchCombobox`)

struct EventBillingOption: Identifiable, Hashable {
    let id: String
    let label: String
    var detail: String? = nil
    var keywords: String = ""
    func matches(_ term: String) -> Bool { "\(label) \(detail ?? "") \(keywords)".localizedStandardContains(term) }
}

@MainActor struct EventBillingSearchPicker: View {
    let options: [EventBillingOption]
    let selection: String
    /// Nazwa zapisanej pozycji, gdy lista jeszcze się wczytuje albo jej nie zawiera.
    var fallback: String? = nil
    let placeholder: String
    let prompt: String
    let empty: String
    var clearLabel: String? = nil
    var disabled = false
    let pick: (String) -> Void
    @State private var open = false
    @State private var query = ""

    private var selected: EventBillingOption? { options.first { $0.id == selection } }
    private var title: String? { selected?.label ?? (selection.isEmpty ? nil : fallback) }
    private var filtered: [EventBillingOption] {
        let terms = query.split(whereSeparator: \.isWhitespace).map(String.init)
        return Array(options.filter { option in terms.allSatisfy { option.matches($0) } }.prefix(200))
    }

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 6) {
                Text(title ?? placeholder).foregroundStyle(title == nil ? Color.secondary : Color.primary).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .disabled(disabled)
        .popover(isPresented: $open, arrowEdge: .bottom) { list }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("", text: $query, prompt: Text(prompt)).textFieldStyle(.roundedBorder)
            List {
                if let clearLabel, !selection.isEmpty {
                    Button(clearLabel) { choose("") }.buttonStyle(.plain).foregroundStyle(.secondary)
                }
                ForEach(filtered) { option in
                    Button { choose(option.id) } label: {
                        HStack(spacing: 6) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(option.label)
                                if let detail = option.detail?.nonEmpty { Text(detail).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer(minLength: 4)
                            if option.id == selection { Image(systemName: "checkmark") }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                if filtered.isEmpty { Text(empty).foregroundStyle(.secondary) }
            }
            .listStyle(.plain)
        }
        .padding(12).frame(width: 400, height: 420)
    }

    private func choose(_ id: String) {
        open = false
        query = ""
        pick(id)
    }
}

/// Pole formularza okna: etykieta, opcjonalnie dopisek „(opcjonalnie)”, treść i podpowiedź.
private struct EventBillingField<Content: View>: View {
    let label: String
    var optional = false
    var hint: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 4) {
                Text(label).font(.callout.weight(.medium))
                if optional { Text("(opcjonalnie)").font(.callout).foregroundStyle(.tertiary) }
            }
            content
            if let hint { Text(hint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Termin (data bez godziny) albo brak.
private struct EventBillingDayField: View {
    @Binding var day: String

    var body: some View {
        HStack(spacing: 8) {
            Toggle("Ustal termin", isOn: Binding(get: { !day.isEmpty }, set: { day = $0 ? (day.isEmpty ? FinanceText.dayString(Date()) : day) : "" }))
                .toggleStyle(.checkbox)
            if !day.isEmpty {
                DatePicker("", selection: Binding(get: { FinanceText.dayDate(day) ?? Date() }, set: { day = FinanceText.dayString($0) }), displayedComponents: .date)
                    .labelsHidden().fixedSize()
            }
        }
    }
}

// MARK: Edycja sposobu rozliczenia (`EventBillingContextCard` w trybie edycji)

@MainActor struct EventBillingEditSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let data: EventBillingData
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var arrangement = "direct"
    @State private var organizationID = ""
    @State private var purchaseOrder = ""
    @State private var contactIDs: [String] = []
    @State private var referralEnabled = false
    @State private var referralID = ""
    @State private var organizations: [EventBillingQuery.Option]?
    @State private var organizationsError: String?
    @State private var contacts: [EventBillingQuery.OrgContact]?
    @State private var contactsFor = ""
    @State private var sellers: [EventBillingQuery.Seller]?
    @State private var sellersError: String?
    @State private var error: String?
    @State private var saving = false
    @State private var prepared = false

    private var billing: EventBillingData.Billing { data.billing }
    private var savedReferralID: String { billing.referral?.id ?? "" }
    private var sellersLoading: Bool { billing.referralSchema && sellers == nil && sellersError == nil }
    private var referralBlocked: Bool { billing.referralSchema && (sellersLoading || sellersError != nil) }
    private var selectedSeller: EventBillingQuery.Seller? { sellers?.first { $0.id == referralID } }
    private var organizationLabel: String {
        organizations?.first { $0.id == organizationID }?.label ?? (organizationID == billing.billingOrganizationId ? billing.billingOrganizationName : nil) ?? "organizacji"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Rozliczenie wydarzenia").font(.title3.weight(.light))
                Text("Określ nabywcę faktur i osoby odpowiedzialne za rozliczenie.").font(.callout).foregroundStyle(.secondary)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    EventBillingField(label: "Sposób rozliczenia") {
                        Picker("", selection: $arrangement) {
                            ForEach(EventBillingText.arrangements, id: \.0) { Text($0.1).tag($0.0) }
                        }
                        .labelsHidden()
                    }
                    EventBillingField(label: "Numer PO / zamówienia klienta", optional: true,
                                      hint: "Numer będzie dostępny w umowie jako zmienna „Numer PO / zamówienia klienta”.") {
                        TextField("", text: $purchaseOrder, prompt: Text("np. Order No. 5501949741")).textFieldStyle(.roundedBorder)
                    }
                    payer
                    referral
                    if arrangement != "direct" && !organizationID.isEmpty { contactsSection }
                }
                .padding(.trailing, 8)
            }
            .frame(minHeight: 280, maxHeight: 560)
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz rozliczenie") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving || referralBlocked)
            }
        }
        .padding(20).frame(width: 580)
        .task { await prepare() }
        .onChange(of: arrangement) { _, value in if value == "direct" { organizationID = "" } }
        .onChange(of: organizationID) { _, id in Task { await loadContacts(id) } }
        .onChange(of: purchaseOrder) { _, value in if value.count > 200 { purchaseOrder = String(value.prefix(200)) } }
    }

    // MARK: Nabywca

    @ViewBuilder private var payer: some View {
        if arrangement == "direct" {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "building.2").foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nabywca faktury").font(.caption).foregroundStyle(.secondary)
                    Text(billing.invoiceBuyer?.name ?? billing.clientName?.nonEmpty ?? "Klient przypisany do wydarzenia").font(.callout.weight(.medium))
                    if let buyer = billing.invoiceBuyer {
                        Text("Z karty klienta (Dane do faktury): \(billing.clientName?.nonEmpty ?? "klient") jako odbiorca\(buyer.role == 8 ? " — jednostka podrzędna JST" : "").")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        } else {
            EventBillingField(label: "Organizacja będąca nabywcą faktur") {
                EventBillingSearchPicker(
                    options: (organizations ?? []).filter { $0.id != billing.clientOrganizationId }
                        .map { EventBillingOption(id: $0.id, label: $0.label, detail: $0.description) },
                    selection: organizationID,
                    fallback: organizationID == billing.billingOrganizationId ? billing.billingOrganizationName : nil,
                    placeholder: "Wyszukaj hotel lub inną organizację...", prompt: "Wyszukaj hotel lub inną organizację...",
                    empty: organizations == nil ? "Wczytywanie organizacji…" : "Brak pasującej organizacji",
                    disabled: saving
                ) { id in
                    guard id != organizationID else { return }
                    organizationID = id
                    contactIDs = []
                }
                if let organizationsError {
                    HStack(spacing: 6) {
                        Text(organizationsError).font(.caption).foregroundStyle(EventBillingText.warning)
                        Button("Spróbuj ponownie") { Task { await loadOrganizations() } }.buttonStyle(.link).linkCursor().font(.caption)
                    }
                }
            }
        }
    }

    // MARK: Sprzedawca pozyskujący wydarzenie

    private var referral: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Wydarzenie pozyskane przez sprzedawcę", isOn: $referralEnabled)
                .toggleStyle(.checkbox).font(.callout.weight(.medium))
                .disabled(saving || !billing.referralSchema || referralBlocked)
                .help(billing.referralSchema ? "Sprzedawca, który pozyskał wydarzenie"
                      : "Wybór sprzedawcy oczekuje na włączenie zapisu w bazie. Pozostałe dane rozliczenia możesz zapisać.")
            Text("Sprzedawca może otrzymać prowizję także wtedy, gdy klient rozlicza się bezpośrednio. Przypisanie nie zmienia nabywcy faktury ani osoby kontaktowej klienta.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if sellersLoading {
                HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Wczytuję przypisanie sprzedawcy…").font(.caption).foregroundStyle(.secondary) }
            }
            if let sellersError {
                VStack(alignment: .leading, spacing: 4) {
                    Text(sellersError).font(.caption).foregroundStyle(EventBillingText.warning)
                    Button("Odśwież sprzedawców") { Task { await loadSellers() } }.buttonStyle(.link).linkCursor().font(.caption).disabled(saving)
                }
            }
            if referralEnabled {
                EventBillingSearchPicker(
                    options: (sellers ?? []).map { EventBillingOption(id: $0.id, label: $0.label, detail: $0.description, keywords: $0.keywords) },
                    selection: referralID,
                    fallback: referralID == savedReferralID ? billing.referral?.label : nil,
                    placeholder: "Wyszukaj sprzedawcę po nazwisku, firmie lub e-mailu…", prompt: "Wyszukaj sprzedawcę po nazwisku, firmie lub e-mailu…",
                    empty: "Brak sprzedawcy — dodaj profil w kartotece sprzedawców",
                    disabled: saving || referralBlocked
                ) { referralID = $0 }
                if let seller = selectedSeller {
                    Text(seller.description).font(.caption).foregroundStyle(.secondary)
                    if !seller.commissionReady {
                        Text("Przypisanie osoby nie ustala kwoty do wypłaty. Uzupełnij warunki dla marki lub ustal prowizję ręcznie w sekcji „Sprzedawcy i prowizje”.")
                            .font(.caption).foregroundStyle(EventBillingText.warning).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Text("Po zapisie obowiązują warunki sprzedawcy dla marki wydarzenia, z uwzględnieniem uzgodnień zaakceptowanej oferty. Prowizję umowną możesz edytować w sekcji „Sprzedawcy i prowizje”. Bez zaakceptowanej oferty naliczenie oczekuje na podstawę netto po rabacie.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if !savedReferralID.isEmpty && (!referralEnabled || referralID != savedReferralID) {
                Text("Zmiana lub usunięcie przypisania nie kasuje wcześniejszej prowizji ani wypłaty. Sprawdź dotychczasowe naliczenie w sekcji „Sprzedawcy i prowizje”.")
                    .font(.caption).foregroundStyle(EventBillingText.warning).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Opiekunowie rozliczenia

    private var contactsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Opiekunowie rozliczenia po stronie \(organizationLabel)", systemImage: "person.2").font(.callout.weight(.medium))
            Text("Jeśli zaznaczona osoba jest sprzedawcą z aktywną prowizją dla marki wydarzenia, zapis doda ją automatycznie do sekcji „Sprzedawcy i prowizje”. Kwota jest liczona od wartości netto zaakceptowanej oferty. Bez niej zapisujemy stawkę i oczekiwanie na podstawę.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if contacts == nil || contactsFor != organizationID {
                HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Ładowanie kontaktów...").font(.caption).foregroundStyle(.secondary) }
            } else if let contacts, !contacts.isEmpty {
                VStack(spacing: 6) {
                    ForEach(contacts) { contact in contactRow(contact) }
                }
            } else {
                Text("Ta organizacja nie ma jeszcze osób kontaktowych. Dodaj je w kartotece organizacji, aby system mógł podpowiadać odbiorców faktur.")
                    .font(.caption).foregroundStyle(.secondary).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
        }
    }

    private func contactRow(_ contact: EventBillingQuery.OrgContact) -> some View {
        let selected = contactIDs.contains(contact.id)
        return Button {
            if selected { contactIDs.removeAll { $0 == contact.id } } else { contactIDs.append(contact.id) }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: selected ? "checkmark.square.fill" : "square").foregroundStyle(selected ? theme.accent : Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(contact.name).font(.callout)
                    if let position = contact.position?.nonEmpty { Text(position).font(.caption).foregroundStyle(.secondary) }
                    Text(contact.email?.nonEmpty ?? contact.phone?.nonEmpty ?? "Brak danych kontaktowych").font(.caption).foregroundStyle(.tertiary)
                }
                Spacer(minLength: 4)
                if selected && contactIDs.first == contact.id && contactIDs.count > 1 { Text("główny").font(.caption2).foregroundStyle(.secondary) }
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? theme.accent.opacity(0.12) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(selected ? theme.accent.opacity(0.6) : Color.clear, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(saving)
    }

    // MARK: Dane

    private func prepare() async {
        guard !prepared else { return }
        prepared = true
        arrangement = billing.arrangement
        organizationID = billing.billingOrganizationId ?? ""
        purchaseOrder = billing.purchaseOrderNumber ?? ""
        contactIDs = billing.contacts.map(\.id)
        referralEnabled = billing.referral != nil
        referralID = savedReferralID
        if billing.referralSchema { Task { await loadSellers() } }
        await loadOrganizations()
    }

    private func loadOrganizations() async {
        organizationsError = nil
        do {
            organizations = try await store.tabQuery(eventID, "billing", "organizations", as: EventBillingQuery.Organizations.self).organizations
        } catch {
            organizationsError = store.failureText(error, "Nie udało się pobrać organizacji.")
        }
    }

    private func loadSellers() async {
        sellersError = nil
        sellers = nil
        do {
            sellers = try await store.tabQuery(eventID, "billing", "sellers", as: EventBillingQuery.Sellers.self).sellers
        } catch {
            sellersError = store.failureText(error, "Nie udało się wczytać przypisanego sprzedawcy i jego warunków. Odśwież dane przed zapisem.")
        }
    }

    /// Osoby kontaktowe płatnika; zaznaczenia spoza listy znikają (jak w CRM po wczytaniu kontaktów).
    private func loadContacts(_ organization: String) async {
        guard !organization.isEmpty else { contacts = nil; contactsFor = ""; return }
        contacts = nil
        do {
            let list = try await store.tabQuery(eventID, "billing", "contacts", ["organization": organization], as: EventBillingQuery.Contacts.self).contacts
            guard organization == organizationID else { return }
            contacts = list
            contactsFor = organization
            let available = Set(list.map(\.id))
            contactIDs = contactIDs.filter { available.contains($0) }
        } catch {
            guard organization == organizationID else { return }
            contacts = []
            contactsFor = organization
            self.error = store.failureText(error, "Nie udało się pobrać osób kontaktowych organizacji.")
        }
    }

    private func save() async {
        guard !saving else { return }
        error = nil
        if referralBlocked { error = "Poczekaj na wczytanie danych sprzedawcy lub odśwież je przed zapisem."; return }
        if referralEnabled && referralID.isEmpty { error = "Wybierz sprzedawcę, który pozyskał wydarzenie, albo odznacz pole polecenia."; return }
        if referralEnabled && referralID != savedReferralID && selectedSeller?.status != "active" { error = "Wybierz aktywnego sprzedawcę z kartoteki."; return }
        if arrangement != "direct" && organizationID.isEmpty { error = "Wybierz organizację, która będzie rozliczać wydarzenie"; return }
        saving = true
        defer { saving = false }
        let payload: [String: JSONValue] = [
            "arrangement": .string(arrangement),
            "billingOrganizationId": .string(arrangement == "direct" ? "" : organizationID),
            "purchaseOrderNumber": .string(purchaseOrder),
            "contactIds": .array(arrangement == "direct" ? [] : contactIDs.map { .string($0) }),
            "referralEnabled": .bool(referralEnabled),
            "referralPartnerId": .string(referralEnabled ? referralID : ""),
            "savedReferralPartnerId": .string(savedReferralID),
        ]
        do {
            let reply = try await store.tabAction(eventID, "billing", "saveBilling", payload, reload: EventBillingText.reloads(store, eventID), success: nil)
            state.succeed(EventBillingText.reply(reply)?.message?.nonEmpty ?? "Sposób rozliczenia wydarzenia został zapisany")
            dismiss()
            // Karta wydarzenia (płatnik w danych wydarzenia, Finanse) po zmianie sposobu rozliczenia.
            Task { await store.load(eventID) }
        } catch {
            self.error = store.failureText(error, "Nie udało się zapisać rozliczenia wydarzenia")
        }
    }
}

// MARK: Wspólne rozliczenie kilku wydarzeń

@MainActor struct EventSettlementEditSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let page: EventCardPage
    let data: EventBillingData
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name = "Wspólne rozliczenie wydarzeń"
    @State private var eventIDs: [String] = []
    @State private var primary = ""
    @State private var search = ""
    @State private var candidates: [EventBillingQuery.Candidate]?
    @State private var loadError: String?
    @State private var error: String?
    @State private var saving = false
    @State private var dissolving = false
    @State private var prepared = false

    private var hasGroup: Bool { data.settlement != nil }
    private var event: EventFields { EventFields(raw: page.event ?? [:]) }

    private func info(_ id: String) -> (name: String, date: String?) {
        if let item = data.settlement?.events.first(where: { $0.id == id }) { return (item.name, item.date) }
        if let item = candidates?.first(where: { $0.id == id }) { return (item.name, item.date) }
        if id == eventID { return (event.name, event["event_date"].nonEmpty) }
        return ("Wydarzenie", nil)
    }

    /// Wydarzenia tego samego klienta, kontaktu albo płatnika (jak `availableSettlementEvents` w CRM), zawężone wyszukiwaniem.
    private var available: [EventBillingQuery.Candidate] {
        let billing = data.billing
        let client = billing.clientOrganizationId ?? ""
        let payer = (billing.arrangement == "direct" ? billing.clientOrganizationId : billing.billingOrganizationId) ?? ""
        let contact = event["contact_person_id"]
        let terms = search.split(whereSeparator: \.isWhitespace).map(String.init)
        return (candidates ?? []).filter { candidate in
            guard candidate.id != eventID, !eventIDs.contains(candidate.id) else { return false }
            let matches = (!client.isEmpty && candidate.organizationId == client)
                || (!contact.isEmpty && candidate.contactPersonId == contact)
                || (!payer.isEmpty && (candidate.billingOrganizationId == payer || candidate.organizationId == payer))
            guard matches else { return false }
            let text = "\(candidate.name) \(candidate.date ?? "") \(EventBillingText.day(candidate.date, empty: ""))"
            return terms.allSatisfy { text.localizedStandardContains($0) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Wspólne rozliczenie").font(.title3.weight(.light))
                Text("Połącz osobne realizacje, gdy mają otrzymać jedną fakturę. Timeline, zespół, sprzęt i koszty pozostają oddzielne, a przychód faktury jest przypisywany do każdego wydarzenia.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            EventBillingField(label: "Nazwa rozliczenia") {
                TextField("", text: $name, prompt: Text("Wspólne rozliczenie wydarzeń")).textFieldStyle(.roundedBorder)
            }
            EventBillingField(label: "Wydarzenia w rozliczeniu") {
                VStack(spacing: 6) {
                    ForEach(eventIDs, id: \.self) { id in memberRow(id) }
                }
            }
            if eventIDs.count > 1 {
                EventBillingField(label: "Wydarzenie główne dla faktury",
                                  hint: "Dokument pozostaje jeden. W pozostałych wydarzeniach będzie widoczny jako faktura wspólna wraz z przypisaną częścią przychodu.") {
                    Picker("", selection: $primary) {
                        ForEach(eventIDs, id: \.self) { id in
                            let item = info(id)
                            Text("\(item.name) · \(EventBillingText.day(item.date))").tag(id)
                        }
                    }
                    .labelsHidden()
                }
            }
            candidatesSection
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
            HStack {
                if hasGroup {
                    Button("Rozłącz grupę…", systemImage: "scissors", role: .destructive) { dissolving = true }.disabled(saving)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz rozliczenie") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(20).frame(width: 580)
        .task { await prepare() }
        .confirmationDialog("Rozłączyć wspólne rozliczenie?", isPresented: $dissolving, titleVisibility: .visible) {
            Button("Rozłącz grupę", role: .destructive) { Task { await dissolve() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Wydarzenia znów będą rozliczane osobno. Historia faktur pozostanie zachowana.")
        }
    }

    private func memberRow(_ id: String) -> some View {
        let item = info(id)
        let current = id == eventID
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.name).font(.callout)
                Label(EventBillingText.day(item.date) + (current ? " · aktualne wydarzenie" : ""), systemImage: "calendar")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            if !current {
                Button("Usuń") {
                    eventIDs.removeAll { $0 == id }
                    if primary == id { primary = eventID }
                }
                .buttonStyle(.link).linkCursor().font(.caption).foregroundStyle(CrmTheme.rgb(0xef4444)).disabled(saving)
            }
        }
        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private var candidatesSection: some View {
        EventBillingField(label: "Dodaj wydarzenie tego klienta lub płatnika") {
            TextField("", text: $search, prompt: Text("Szukaj po nazwie lub dacie...")).textFieldStyle(.roundedBorder)
            let list = available
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    if candidates == nil && loadError == nil {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 50)
                    } else if let loadError {
                        HStack(spacing: 6) {
                            Text(loadError).font(.caption).foregroundStyle(EventBillingText.warning)
                            Button("Spróbuj ponownie") { Task { await loadCandidates() } }.buttonStyle(.link).linkCursor().font(.caption)
                        }
                    } else if list.isEmpty {
                        Text("Brak kolejnych wydarzeń tego klienta lub płatnika.").font(.caption).foregroundStyle(.secondary).padding(.vertical, 6)
                    }
                    ForEach(list.prefix(60)) { candidate in
                        Button {
                            if !eventIDs.contains(candidate.id) { eventIDs.append(candidate.id) }
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "plus.circle").foregroundStyle(theme.accent)
                                Text(candidate.name).font(.callout).lineLimit(1)
                                Spacer(minLength: 4)
                                Text(EventBillingText.day(candidate.date)).font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 6).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).disabled(saving)
                    }
                }
            }
            .frame(height: 170)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func prepare() async {
        guard !prepared else { return }
        prepared = true
        if let settlement = data.settlement {
            name = settlement.name
            eventIDs = settlement.events.map(\.id)
            if !eventIDs.contains(eventID) { eventIDs.insert(eventID, at: 0) }
            primary = eventIDs.contains(settlement.primaryEventId) ? settlement.primaryEventId : eventID
        } else {
            eventIDs = [eventID]
            primary = eventID
        }
        await loadCandidates()
    }

    private func loadCandidates() async {
        loadError = nil
        do {
            candidates = try await store.tabQuery(eventID, "billing", "settlementEvents", as: EventBillingQuery.Candidates.self).events
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać wydarzeń.")
        }
    }

    private func save() async {
        guard !saving else { return }
        error = nil
        if eventIDs.count < 2 {
            error = hasGroup ? "Grupa musi zawierać co najmniej dwa wydarzenia. Aby ją usunąć, wybierz „Rozłącz grupę”."
                : "Wybierz co najmniej dwa wydarzenia do wspólnego rozliczenia."
            return
        }
        saving = true
        defer { saving = false }
        let payload: [String: JSONValue] = [
            "eventIds": .array(eventIDs.map { .string($0) }), "name": .string(name),
            "primaryEventId": .string(eventIDs.contains(primary) ? primary : eventID), "hasGroup": .bool(hasGroup),
        ]
        do {
            let reply = try await store.tabAction(eventID, "billing", "saveSettlement", payload, reload: EventBillingText.reloads(store, eventID), success: nil)
            state.succeed(EventBillingText.reply(reply)?.message?.nonEmpty ?? "Wspólne rozliczenie zostało zapisane")
            dismiss()
        } catch {
            self.error = store.failureText(error, "Nie udało się zapisać wspólnego rozliczenia")
        }
    }

    private func dissolve() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let reply = try await store.tabAction(eventID, "billing", "dissolve", [:], reload: EventBillingText.reloads(store, eventID), success: nil)
            state.succeed(EventBillingText.reply(reply)?.message?.nonEmpty ?? "Wydarzenia zostały rozłączone. Historia faktur pozostała zachowana.")
            dismiss()
        } catch {
            self.error = store.failureText(error, "Nie udało się rozłączyć wydarzeń")
        }
    }
}

// MARK: Prowizja: dodanie osoby, edycja wpisu ręcznego, termin i notatka prowizji z podsumowania

struct EventCommissionDraft {
    var beneficiaryType = "salesperson"
    var source = "partner"
    var beneficiaryId = ""
    var manualName = ""
    var organizationId = ""
    var calculationType = "percent"
    var baseAmount = 0.0
    var baseDescription = EventBillingText.defaultBaseDescription
    var rate = 0.0
    var fixedAmount = 0.0
    var paymentMethod = "invoice"
    var dividendTaxRate = EventBillingText.defaultDividendTax
    var dueDate = ""
    var notes = ""

    /// `editCommission`: osoba z kartoteki, pracownik, kontakt albo spoza bazy.
    init(baseAmount: Double = 0) { self.baseAmount = baseAmount }
    init(_ commission: EventBillingData.Commission) {
        let partner = commission.salesPartnerId?.nonEmpty
        let employee = commission.employeeId?.nonEmpty
        let contact = commission.contactId?.nonEmpty
        source = partner != nil ? "partner" : employee != nil ? "employee" : contact != nil ? "contact" : "manual"
        beneficiaryType = commission.beneficiaryType
        beneficiaryId = partner ?? employee ?? contact ?? ""
        manualName = source == "manual" ? commission.name : ""
        organizationId = commission.organizationId ?? ""
        calculationType = commission.calculationType
        baseAmount = commission.baseAmount
        baseDescription = commission.baseDescription ?? ""
        rate = commission.rate
        fixedAmount = commission.amount
        paymentMethod = commission.paymentMethod
        dividendTaxRate = commission.dividendTaxRate
        dueDate = String((commission.dueDate ?? "").prefix(10))
        notes = commission.notes ?? ""
    }
}

@MainActor struct EventCommissionEditSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let editing: EventBillingData.Commission?
    let acceptedOfferNet: Double
    /// Pozycja „Prowizja / narzut sprzedawcy” z podsumowania: kwota dla wskazanej osoby (wpis ręczny w rejestrze prowizji,
    /// na koncie tej osoby, z rejestrem wypłat) zamiast pozycji kosztu bez osoby.
    var sellerCost = false
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var options: EventBillingQuery.CommissionOptions?
    @State private var loadError: String?
    @State private var form = EventCommissionDraft()
    @State private var customize = false
    @State private var saving = false
    @State private var error: String?
    @State private var prepared = false
    /// Druga należność tej samej osoby w wydarzeniu — świadome potwierdzenie (inaczej serwer odrzuci wpis).
    @State private var allowSecond = false
    @State private var askSecond = false

    private var automatic: Bool { editing?.automatic == true }
    private var showDetails: Bool { editing != nil || customize || form.source != "partner" }
    private var selectedPartner: EventBillingQuery.Partner? { options?.partners.first { $0.id == form.beneficiaryId } }
    private var preview: (nominal: Double, companyCost: Double, burden: Double) {
        EventBillingText.amounts(calculationType: form.calculationType, base: form.baseAmount, rate: form.rate, fixed: form.fixedAmount,
                                 payment: form.paymentMethod, tax: form.dividendTaxRate)
    }
    private var title: String {
        if editing != nil { return "Edytuj warunki dla tego wydarzenia" }
        return sellerCost ? "Prowizja / narzut sprzedawcy — przypisz osobę" : "Wybierz osobę — warunki uzupełnią się automatycznie"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.title3.weight(.light))
            if automatic {
                automaticForm
            } else if let options {
                ScrollView { formBody(options).padding(.trailing, 8) }.frame(minHeight: 200, maxHeight: 640)
            } else if let loadError {
                HStack(spacing: 6) {
                    Text(loadError).font(.callout).foregroundStyle(EventBillingText.warning)
                    Button("Spróbuj ponownie") { Task { await loadOptions() } }
                }
            } else {
                ProgressView("Wczytywanie sprzedawców i osób…").controlSize(.small).frame(maxWidth: .infinity, minHeight: 120)
            }
            if let error { Text(error).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : editing != nil ? "Zapisz zmiany" : "Dodaj do rozliczenia") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving || (!automatic && options == nil))
            }
        }
        .padding(20).frame(width: 680)
        .task { await prepare() }
    }

    // MARK: Prowizja z podsumowania — tylko termin i notatka

    private var automaticForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Kwotę, podstawę i odbiorcę tej prowizji ustala podsumowanie wydarzenia. Tutaj zmienisz tylko termin wypłaty i notatkę.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            EventBillingField(label: "Termin wypłaty", optional: true) { EventBillingDayField(day: $form.dueDate) }
            notesField
        }
    }

    private var notesField: some View {
        EventBillingField(label: "Notatka", optional: true) {
            TextField("", text: $form.notes, prompt: Text("Ustalenia dotyczące prowizji..."), axis: .vertical)
                .lineLimit(2...5).textFieldStyle(.roundedBorder)
        }
    }

    // MARK: Formularz osoby i warunków

    private func formBody(_ options: EventBillingQuery.CommissionOptions) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if sellerCost && editing == nil {
                Text("Kwota trafi na konto prowizji wskazanej osoby (z rejestrem wypłat) i jako koszt do podsumowania wydarzenia — dzięki temu ta sama należność nie zostanie zapłacona dwa razy. Narzut z oferty z narzutem jest już w podsumowaniu i na koncie sprzedawcy — nie dopisuj go tutaj.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            }
            if showDetails { personKind(options) }
            person(options)
            if !showDetails, let partner = selectedPartner { termsSummary(partner, options) }
            if showDetails, form.source != "manual", !form.beneficiaryId.isEmpty { personCheck(options) }
            if !showDetails {
                Button("Inna osoba lub własne warunki") { customize = true }.buttonStyle(.link).linkCursor().font(.callout)
            }
            if showDetails {
                terms(options)
                previewTiles
            }
        }
    }

    private func personKind(_ options: EventBillingQuery.CommissionOptions) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
            GridRow {
                EventBillingField(label: "Rodzaj beneficjenta") {
                    Picker("", selection: $form.beneficiaryType) {
                        ForEach(EventBillingText.beneficiaryTypes, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .labelsHidden()
                }
                EventBillingField(label: "Gdzie jest osoba") {
                    Picker("", selection: Binding(get: { form.source }, set: { value in
                        form.source = value
                        form.beneficiaryId = ""
                        allowSecond = false; askSecond = false
                    })) {
                        ForEach(EventBillingText.sources, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .labelsHidden()
                }
            }
            GridRow {
                EventBillingField(label: "Powiązany hotel / firma", optional: true) {
                    EventBillingSearchPicker(
                        options: options.organizations.map { EventBillingOption(id: $0.id, label: $0.label, detail: $0.description) },
                        selection: form.organizationId,
                        placeholder: "Wyszukaj hotel lub firmę...", prompt: "Wyszukaj hotel lub firmę...", empty: "Brak pasującej organizacji",
                        clearLabel: "Bez powiązanej organizacji", disabled: saving
                    ) { organizationChanged($0, options) }
                }
                .gridCellColumns(2)
            }
        }
    }

    /// Osoba z organizacji: bieżące powiązanie kontaktu albo organizacja profilu sprzedawcy.
    private func belongs(_ ids: [String]?, _ primary: String?, to organization: String) -> Bool {
        (ids ?? []).contains(organization) || primary == organization
    }

    /// Wybrany hotel / firma zawęża listę osób; osoba spoza tej organizacji zostaje odznaczona.
    private func organizationChanged(_ id: String, _ options: EventBillingQuery.CommissionOptions) {
        form.organizationId = id
        guard !id.isEmpty, !form.beneficiaryId.isEmpty, form.source == "contact" || form.source == "partner" else { return }
        if !beneficiaryOptions(options).contains(where: { $0.id == form.beneficiaryId }) {
            form.beneficiaryId = ""
            allowSecond = false; askSecond = false
        }
    }

    private func beneficiaryOptions(_ options: EventBillingQuery.CommissionOptions) -> [EventBillingOption] {
        let organization = showDetails ? form.organizationId : ""
        switch form.source {
        case "partner":
            return options.partners
                .filter { ($0.status == "active" && $0.term != nil) || (editing != nil && $0.id == form.beneficiaryId) }
                .filter { organization.isEmpty || belongs($0.organizationIds, $0.organizationId, to: organization) || $0.id == form.beneficiaryId }
                .map { EventBillingOption(id: $0.id, label: $0.label, detail: $0.detail) }
        case "employee":
            return options.employees.map { EventBillingOption(id: $0.id, label: $0.label, detail: $0.detail) }
        default:
            return options.contacts
                .filter { organization.isEmpty || belongs($0.organizationIds, $0.organizationId, to: organization) || $0.id == form.beneficiaryId }
                .map { EventBillingOption(id: $0.id, label: $0.label, detail: $0.detail) }
        }
    }

    @ViewBuilder private func person(_ options: EventBillingQuery.CommissionOptions) -> some View {
        if showDetails && form.source == "manual" {
            EventBillingField(label: "Imię i nazwisko / nazwa") {
                TextField("", text: $form.manualName, prompt: Text("np. Katarzyna Kowalska")).textFieldStyle(.roundedBorder)
            }
        } else {
            let list = beneficiaryOptions(options)
            EventBillingField(label: form.source == "partner" ? "Wyszukaj sprzedawcę" : "Wyszukaj i wybierz osobę") {
                VStack(alignment: .leading, spacing: 4) {
                    EventBillingSearchPicker(
                        options: list, selection: form.beneficiaryId,
                        fallback: editing.flatMap { saved in form.beneficiaryId == EventCommissionDraft(saved).beneficiaryId ? saved.name : nil },
                        placeholder: "Wpisz imię, nazwisko lub e-mail...", prompt: "Wpisz imię, nazwisko lub e-mail...", empty: "Brak pasującej osoby",
                        clearLabel: "Wyczyść wybór", disabled: saving
                    ) { id in
                        if id.isEmpty { form.beneficiaryId = ""; allowSecond = false; askSecond = false } else { select(id, options) }
                    }
                    if showDetails, form.source != "employee", let organization = options.organizations.first(where: { $0.id == form.organizationId }) {
                        let count = list.filter { $0.id != form.beneficiaryId || form.beneficiaryId.isEmpty }.count
                        Text(verbatim: count == 0
                             ? "\(organization.label) nie ma przypisanych osób\(form.source == "partner" ? " w kartotece sprzedawców" : " kontaktowych"). Dodaj osobę w karcie organizacji albo wyczyść „Powiązany hotel / firma”."
                             : "Pokazuję osoby z: \(organization.label) (\(count)). Wyczyść „Powiązany hotel / firma”, aby zobaczyć wszystkich.")
                            .font(.caption).foregroundStyle(count == 0 ? EventBillingText.warning : Color.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    // MARK: Sprawdzenie osoby w rozliczeniu (kartoteka, stawka, podsumowanie, narzut, wcześniejsze wpisy)

    private struct PersonFacts {
        var partner: EventBillingQuery.Partner?
        var partnerId: String?
        var contactId: String?
        var employeeId: String?
        var external: EventBillingQuery.SettlementPreview.External?
        var markup: EventBillingQuery.SettlementPreview.Markup?
        var manual: [EventBillingQuery.Existing] = []
        var automatic: [EventBillingQuery.Existing] = []
    }

    private func facts(_ options: EventBillingQuery.CommissionOptions) -> PersonFacts {
        var facts = PersonFacts()
        let id = form.beneficiaryId
        switch form.source {
        case "partner":
            facts.partner = options.partners.first { $0.id == id }
            facts.partnerId = id; facts.contactId = facts.partner?.contactId; facts.employeeId = facts.partner?.employeeId
        case "contact":
            facts.contactId = id; facts.partner = options.partners.first { $0.contactId == id }; facts.partnerId = facts.partner?.id
        case "employee":
            facts.employeeId = id; facts.partner = options.partners.first { $0.employeeId == id }; facts.partnerId = facts.partner?.id
        default:
            return facts
        }
        let same: (String?, String?, String?) -> Bool = { partner, contact, employee in
            (facts.partnerId != nil && partner == facts.partnerId) || (facts.contactId != nil && contact == facts.contactId)
                || (facts.employeeId != nil && employee == facts.employeeId)
        }
        let rows = (options.existing ?? []).filter { $0.id != editing?.id && same($0.partnerId, $0.contactId, $0.employeeId) }
        facts.manual = rows.filter { !$0.automatic }
        facts.automatic = rows.filter(\.automatic)
        facts.external = options.settlement?.external.first { same($0.partnerId, $0.contactId, nil) }
        if let partnerId = facts.partnerId { facts.markup = options.settlement?.markups.first { $0.partnerId == partnerId } }
        return facts
    }

    /// Stawka „% od naszego zysku”: ustalona dla wydarzenia, z oferty prowizyjnej tej osoby albo z kartoteki (marka wydarzenia).
    private func effectiveRate(_ partner: EventBillingQuery.Partner, _ options: EventBillingQuery.CommissionOptions) -> (rate: Double, source: String)? {
        if let override = partner.override { return (override.rate, "stawka ustalona dla tego wydarzenia" + (override.reason.isEmpty ? "" : ": \(override.reason)")) }
        if let offer = options.offerCommission, offer.partnerId == partner.id { return (offer.rate, "stawka z oferty prowizyjnej sprzedawcy") }
        if let term = partner.term { return (term.rate, "kartoteka sprzedawców — marka wydarzenia") }
        return nil
    }

    /// Szacunek jak w podsumowaniu: podstawa = zysk przed prowizjami sprzedawców ÷ (1 + Σ stawka × narzut podatkowy),
    /// kwota = podstawa × stawka (prowizja jest kosztem, więc liczy się od zysku po swoim koszcie).
    private func estimate(rate: Double, method: String, tax: Double, partnerId: String?, _ settlement: EventBillingQuery.SettlementPreview) -> (base: Double, amount: Double) {
        let factor: (String, Double) -> Double = { payment, dividend in payment == "cash_dividend" ? 1 / (1 - min(99.99, max(0, dividend)) / 100) : 1 }
        guard settlement.profitBeforeExternal > 0, rate > 0 else { return (max(0, settlement.profitBeforeExternal), 0) }
        let others = settlement.external.filter { $0.eligible && ($0.partnerId == nil || $0.partnerId != partnerId) }
            .reduce(0.0) { $0 + $1.rate / 100 * factor($1.paymentMethod, $1.dividendTaxRate) }
        let base = ((settlement.profitBeforeExternal / (1 + others + rate / 100 * factor(method, tax))) * 100).rounded() / 100
        return (base, ((base * rate / 100) * 100).rounded() / 100)
    }

    private func statusLabel(_ status: String) -> String { EventBillingText.statuses.first { $0.0 == status }?.1 ?? status }

    private func factLine(_ symbol: String, _ text: String, _ color: Color = .secondary) -> some View {
        Label { Text(verbatim: text).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: symbol) }
            .font(.caption).foregroundStyle(color)
    }

    @ViewBuilder private func personCheck(_ options: EventBillingQuery.CommissionOptions) -> some View {
        let f = facts(options)
        VStack(alignment: .leading, spacing: 6) {
            Text("Sprawdzenie w rozliczeniu wydarzenia").font(.callout.weight(.medium))
            if let markup = f.markup {
                factLine("exclamationmark.octagon", "Narzut z oferty tego sprzedawcy: \(EventBillingText.money(markup.net)) — \(markup.included ? "w naszej fakturze; jest kosztem w podsumowaniu i należnością na jego koncie do wypłaty" : "poza naszą fakturą (rozlicza go hotel / agencja)"). Nie dopisuj narzutu drugi raz.", CrmTheme.rgb(0xfca5a5))
            }
            if let partner = f.partner {
                if let rate = effectiveRate(partner, options) {
                    factLine("percent", "\(EventBillingText.number(rate.rate))% od naszego zysku — \(rate.source)" + (partner.term.map { " · \(EventBillingText.payment($0.paymentMethod))" } ?? ""))
                } else {
                    factLine("exclamationmark.triangle", "Jest w kartotece sprzedawców, ale bez aktywnej prowizji dla marki wydarzenia — % od zysku nie jest ustalony. Ustal warunki w kartotece (wtedy kwotę policzy podsumowanie) albo wpisz je poniżej.", EventBillingText.warning)
                }
            } else if form.source != "employee" {
                factLine("questionmark.circle", "Brak w kartotece sprzedawców — % od naszego zysku nie jest ustalony. Wpisz go poniżej albo dodaj osobę do kartoteki sprzedawców: wtedy kwotę policzy podsumowanie wydarzenia.", EventBillingText.warning)
            }
            if let external = f.external {
                factLine(external.eligible ? "checkmark.seal" : "info.circle", external.eligible
                         ? "Podsumowanie liczy już tej osobie \(EventBillingText.money(external.amount)) (\(EventBillingText.number(external.rate))% od zysku po kosztach i koszcie prowizji)."
                         : "W podsumowaniu bez kwoty: \(external.skipReason ?? "brak warunków").")
            } else if let settlement = options.settlement, let partner = f.partner, let rate = effectiveRate(partner, options) {
                let method = partner.term?.paymentMethod ?? form.paymentMethod
                let value = estimate(rate: rate.rate, method: method, tax: partner.term?.dividendTaxRate ?? form.dividendTaxRate, partnerId: partner.id, settlement)
                factLine("function", "Przy obecnym rozliczeniu: zysk przed prowizjami sprzedawców \(EventBillingText.money(settlement.profitBeforeExternal)) → podstawa \(EventBillingText.money(value.base)) → \(EventBillingText.money(value.amount)).")
            } else if let settlement = options.settlement {
                factLine("function", "Zysk przed prowizjami sprzedawców w rozliczeniu: \(EventBillingText.money(settlement.profitBeforeExternal)) (zysk netto \(EventBillingText.money(settlement.profitNet))).")
            }
            ForEach(f.automatic, id: \.id) { row in
                factLine("arrow.triangle.2.circlepath", "Ma prowizję z podsumowania: " + EventBillingText.money(row.amount) + " (" + statusLabel(row.status) + "). Wpis ręczny zastąpi ją dopiero po zatwierdzeniu przez finanse (albo gdy dodaje go administrator) — nie zapłacisz dwa razy.")
            }
            ForEach(f.manual, id: \.id) { row in
                factLine("exclamationmark.triangle", "Ma już ręczną prowizję w tym wydarzeniu: " + row.name + " — " + EventBillingText.money(row.amount) + " (" + statusLabel(row.status) + "). Edytuj tamten wpis zamiast dodawać drugi.", EventBillingText.warning)
            }
            if editing == nil && (!f.manual.isEmpty || askSecond) && f.markup == nil {
                Toggle(isOn: $allowSecond) { Text("To inna należność niż istniejący wpis — dodaj drugi").font(.caption) }.toggleStyle(.checkbox)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func termsSummary(_ partner: EventBillingQuery.Partner, _ options: EventBillingQuery.CommissionOptions) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Warunki z kartoteki sprzedawcy dla marki wydarzenia").font(.callout)
                Spacer()
                Button("Edytuj", systemImage: "pencil") { customize = true }.buttonStyle(.link).linkCursor().font(.callout)
            }
            Text(verbatim: "\(EventBillingText.number(form.rate))% od naszego zysku · \(EventBillingText.payment(form.paymentMethod))").font(.callout.weight(.medium))
            if let rate = effectiveRate(partner, options) {
                Text(verbatim: "Źródło stawki: \(rate.source).").font(.caption).foregroundStyle(.secondary)
            }
            Text(verbatim: "Kwotę policzy podsumowanie wydarzenia: % od zysku netto (po kosztach i koszcie samej prowizji).").font(.caption).foregroundStyle(.secondary)
            if let organization = options.organizations.first(where: { $0.id == form.organizationId }) {
                Text(organization.description ?? organization.label).font(.caption)
            }
            personCheck(options)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func terms(_ options: EventBillingQuery.CommissionOptions) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if form.source != "employee" {
                Text("Ręczny wpis dla sprzedawcy zewnętrznego zastępuje wyliczenie z podsumowania dopiero, gdy jest zatwierdzony przez finanse (albo dodał go administrator). Do tego czasu czeka i nie pomniejsza zysku. Po wysłaniu podsumowania wpisy ręczne zmienia tylko finanse lub administrator.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                GridRow {
                    EventBillingField(label: "Sposób naliczenia") {
                        Picker("", selection: $form.calculationType) {
                            Text("Procent od podstawy netto").tag("percent")
                            Text("Stała kwota").tag("fixed")
                        }
                        .labelsHidden()
                    }
                    EventBillingField(label: "Sposób wypłaty") {
                        Picker("", selection: $form.paymentMethod) {
                            ForEach(EventBillingText.paymentMethods, id: \.0) { Text($0.1).tag($0.0) }
                        }
                        .labelsHidden()
                    }
                }
                GridRow {
                    if form.calculationType == "percent" {
                        EventBillingField(label: "Podstawa netto") {
                            TextField("", value: $form.baseAmount, format: .number.precision(.fractionLength(0...2))).textFieldStyle(.roundedBorder)
                        }
                        EventBillingField(label: "Prowizja (% od podstawy)") {
                            TextField("", value: $form.rate, format: .number.precision(.fractionLength(0...2))).textFieldStyle(.roundedBorder)
                        }
                    } else {
                        EventBillingField(label: sellerCost ? "Kwota prowizji / narzutu netto dla osoby" : "Kwota należna osobie") {
                            TextField("", value: $form.fixedAmount, format: .number.precision(.fractionLength(0...2))).textFieldStyle(.roundedBorder)
                        }
                        .gridCellColumns(2)
                    }
                }
                if form.calculationType == "percent" {
                    GridRow {
                        basePresets(options).gridCellColumns(2)
                    }
                }
                GridRow {
                    EventBillingField(label: "Czego dotyczy podstawa") {
                        TextField("", text: $form.baseDescription, prompt: Text("np. Podest z zaakceptowanej oferty")).textFieldStyle(.roundedBorder)
                    }
                    EventBillingField(label: "Termin wypłaty", optional: true) { EventBillingDayField(day: $form.dueDate) }
                }
                if form.paymentMethod == "cash_dividend" {
                    GridRow {
                        EventBillingField(label: "Modelowa stawka podatku od dywidendy (%)") {
                            TextField("", value: $form.dividendTaxRate, format: .number.precision(.fractionLength(0...2))).textFieldStyle(.roundedBorder)
                        }
                        Color.clear.frame(height: 1)
                    }
                }
            }
            notesField
        }
    }

    /// Podstawa jednym kliknięciem: zysk z rozliczenia wydarzenia („% od naszego zysku”) albo wartość netto zaakceptowanej oferty.
    @ViewBuilder private func basePresets(_ options: EventBillingQuery.CommissionOptions) -> some View {
        HStack(spacing: 14) {
            Text("Podstawa:").font(.caption).foregroundStyle(.secondary)
            if let settlement = options.settlement {
                Button("Zysk z rozliczenia: \(EventBillingText.money(settlement.profitBeforeExternal))") {
                    form.baseAmount = max(0, settlement.profitBeforeExternal)
                    form.baseDescription = EventBillingText.profitBaseDescription
                }
                .buttonStyle(.link).linkCursor().font(.caption)
            }
            Button("Wartość oferty netto: \(EventBillingText.money(options.acceptedOfferNet))") {
                form.baseAmount = options.acceptedOfferNet
                form.baseDescription = EventBillingText.defaultBaseDescription
            }
            .buttonStyle(.link).linkCursor().font(.caption)
        }
    }

    private var previewTiles: some View {
        let amounts = preview
        return HStack(spacing: 12) {
            tile("Osoba otrzyma", amounts.nominal, EventBillingText.violet)
            tile("Koszt dla spółki", amounts.companyCost, EventBillingText.amber)
            tile("Narzut podatkowy", amounts.burden, .primary)
        }
        .padding(12)
        .background(EventBillingText.amber.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.1), lineWidth: 1))
    }

    private func tile(_ label: String, _ value: Double, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased()).font(.caption2.weight(.medium)).tracking(0.5).foregroundStyle(.tertiary)
            Text(EventBillingText.money(value)).font(.title3.monospacedDigit()).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Wybór osoby (`selectBeneficiary`)

    /// Sprzedawca z kartoteki (także wskazany jako kontakt lub pracownik) przenosi warunki marki: stawka (ustalona dla wydarzenia,
    /// z oferty prowizyjnej albo z kartoteki), sposób wypłaty, podatek — kwotę liczy podsumowanie. Osoba bez warunków w kartotece:
    /// wpis ręczny, podstawa domyślnie zysk z rozliczenia wydarzenia („% od naszego zysku”). Przy kwocie dla sprzedawcy
    /// (`sellerCost`) zawsze wpis ręczny — sprzedawca z kartoteki zapisuje się na swój kontakt.
    private func select(_ id: String, _ options: EventBillingQuery.CommissionOptions) {
        error = nil
        allowSecond = false; askSecond = false
        let partner = options.partners.first { candidate in
            switch form.source {
            case "partner": return candidate.id == id
            case "contact": return candidate.contactId == id
            case "employee": return candidate.employeeId == id
            default: return false
            }
        }
        if sellerCost {
            if form.source == "partner", let partner {
                if let contact = partner.contactId?.nonEmpty { form.source = "contact"; form.beneficiaryId = contact }
                else if let employee = partner.employeeId?.nonEmpty { form.source = "employee"; form.beneficiaryId = employee }
                else { error = "Ten sprzedawca nie ma kontaktu ani pracownika — wybierz osobę jako kontakt CRM."; return }
            } else {
                form.beneficiaryId = id
            }
            if form.organizationId.isEmpty, let organization = partner?.organizationId?.nonEmpty
                ?? options.contacts.first(where: { $0.id == form.beneficiaryId })?.organizationId?.nonEmpty {
                form.organizationId = organization
            }
            return
        }
        if let partner, let term = partner.term, partner.status == "active" {
            customize = false
            form.source = "partner"
            form.calculationType = "percent"
            form.baseAmount = options.acceptedOfferNet
            form.baseDescription = EventBillingText.defaultBaseDescription
            form.beneficiaryId = partner.id
            form.organizationId = partner.organizationId ?? form.organizationId
            form.beneficiaryType = partner.partnerType == "internal_employee" ? "employee" : "salesperson"
            form.rate = effectiveRate(partner, options)?.rate ?? term.rate
            if !term.paymentMethod.isEmpty { form.paymentMethod = term.paymentMethod }
            form.dividendTaxRate = term.dividendTaxRate
            return
        }
        if form.source == "partner" {
            error = "Uzupełnij warunki sprzedawcy dla marki wydarzenia w kartotece sprzedawców albo wybierz tę osobę jako kontakt CRM i wpisz warunki ręcznie."
            return
        }
        form.beneficiaryId = id
        if form.source == "contact", form.organizationId.isEmpty, let organization = options.contacts.first(where: { $0.id == id })?.organizationId?.nonEmpty {
            form.organizationId = organization
        }
        // „% od naszego zysku”: podstawą jest zysk z rozliczenia wydarzenia (przed prowizjami sprzedawców), nie wartość oferty.
        if editing == nil, form.source != "employee", form.calculationType == "percent", let settlement = options.settlement,
           form.baseDescription == EventBillingText.defaultBaseDescription {
            form.baseAmount = max(0, settlement.profitBeforeExternal)
            form.baseDescription = EventBillingText.profitBaseDescription
        }
    }

    // MARK: Dane i zapis

    private func prepare() async {
        guard !prepared else { return }
        prepared = true
        if let editing {
            form = EventCommissionDraft(editing)
            customize = true
        } else {
            form = EventCommissionDraft(baseAmount: acceptedOfferNet)
            if sellerCost {
                customize = true
                form.source = "contact"
                form.calculationType = "fixed"
                form.beneficiaryType = "salesperson"
                form.paymentMethod = "invoice"
                form.baseDescription = "Prowizja / narzut sprzedawcy (z podsumowania wydarzenia)"
            }
        }
        if !automatic { await loadOptions() }
    }

    private func loadOptions() async {
        loadError = nil
        do {
            options = try await store.tabQuery(eventID, "billing", "commissionOptions", as: EventBillingQuery.CommissionOptions.self)
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać sprzedawców i osób.")
        }
    }

    private func save() async {
        guard !saving else { return }
        error = nil
        if automatic, let editing {
            await submit("commissionSchedule", ["id": .string(editing.id), "dueDate": .string(form.dueDate), "notes": .string(form.notes)],
                         fallback: "Termin i notatka zapisane", failure: "Nie udało się zapisać zmian. Odśwież dane.")
            return
        }
        if !showDetails && form.source == "partner" {
            guard !form.beneficiaryId.isEmpty else { error = "Wybierz sprzedawcę z kartoteki"; return }
            if let options, facts(options).markup != nil {
                error = "Ten sprzedawca ma w wydarzeniu ofertę z narzutem — narzut jest już w podsumowaniu i na jego koncie. Nie dodawaj mu prowizji drugi raz."
                return
            }
            saving = true
            defer { saving = false }
            do {
                let data = try await store.tabAction(eventID, "billing", "commissionPartner", ["salesPartnerId": .string(form.beneficiaryId)],
                                                     reload: EventBillingText.reloads(store, eventID), success: nil)
                let reply = EventBillingText.reply(data)
                guard reply?.commissionId?.nonEmpty != nil else {
                    error = reply?.message?.nonEmpty ?? "Uzupełnij dane potrzebne do naliczenia."
                    return
                }
                state.succeed(reply?.message?.nonEmpty ?? "Sprzedawca dodany — kwotę prowizji liczy podsumowanie wydarzenia")
                dismiss()
            } catch {
                self.error = store.failureText(error, "Nie udało się zapisać prowizji.")
            }
            return
        }
        let missingPerson = form.source == "manual" ? form.manualName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : form.beneficiaryId.isEmpty
        if missingPerson {
            error = sellerCost ? "Wskaż osobę, której należy się ta kwota — bez osoby nie trafi na jej konto i rejestr wypłat." : "Wybierz osobę albo wpisz nazwę beneficjenta"
            return
        }
        guard preview.nominal > 0 else { error = "Kwota prowizji musi być większa od zera"; return }
        if editing == nil, let options {
            let f = facts(options)
            if f.markup != nil {
                error = "Ten sprzedawca ma w wydarzeniu ofertę z narzutem — narzut jest już w podsumowaniu i na jego koncie do wypłaty. Nie dopisuj go drugi raz."
                return
            }
            if !f.manual.isEmpty && !allowSecond {
                error = "Ta osoba ma już ręczną prowizję w tym wydarzeniu. Edytuj tamten wpis albo zaznacz, że to inna należność."
                return
            }
        }
        var payload: [String: JSONValue] = [
            "beneficiarySource": .string(form.source), "beneficiaryId": .string(form.beneficiaryId), "beneficiaryType": .string(form.beneficiaryType),
            "manualName": .string(form.manualName), "organizationId": .string(form.organizationId), "calculationType": .string(form.calculationType),
            "baseAmount": .number(form.baseAmount), "baseDescription": .string(form.baseDescription), "rate": .number(form.rate),
            "fixedAmount": .number(form.fixedAmount), "paymentMethod": .string(form.paymentMethod), "dividendTaxRate": .number(form.dividendTaxRate),
            "dueDate": .string(form.dueDate), "notes": .string(form.notes), "allowSecond": .bool(allowSecond),
        ]
        if let editing { payload["id"] = .string(editing.id) }
        await submit("commissionSave", payload, fallback: editing != nil ? "Prowizja została zaktualizowana" : "Prowizja została naliczona",
                     failure: "Nie udało się zapisać prowizji")
    }

    private func submit(_ action: String, _ body: [String: JSONValue], fallback: String, failure: String) async {
        saving = true
        defer { saving = false }
        do {
            let data = try await store.tabAction(eventID, "billing", action, body, reload: EventBillingText.reloads(store, eventID), success: nil)
            state.succeed(EventBillingText.reply(data)?.message?.nonEmpty ?? fallback)
            dismiss()
        } catch {
            let text = store.failureText(error, failure)
            self.error = text
            // Serwer wykrył drugą należność tej samej osoby — pokaż potwierdzenie „inna należność”.
            if text.contains("potwierdź to w formularzu") { askSecond = true }
        }
    }
}
