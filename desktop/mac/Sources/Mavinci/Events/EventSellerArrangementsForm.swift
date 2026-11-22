import SwiftUI

// MARK: Ustalenia realizacji (`SellerOfferArrangements`): sala z bazy hotelu albo wpis ręczny, uczestnicy, dni i godziny
// wydarzenia, montaż i demontaż, termin materiałów, wymagania, kontakty organizacyjne (także z bazy hotelu), klient i zespół.
// Wspólne dla oferty i realizacji; zapis z wersją (`save_seller_offer_arrangements`) nie zmienia cen, kalendarza ani akceptacji.

/// Formularz ustaleń (`Draft` w CRM). Przestrzeń: zapisana bez zmian, sala z bazy hotelu albo wpis ręczny.
struct SellerArrangementDraft: Equatable {
    enum Venue: Equatable { case keep, room(String), none }
    var room = ""
    var venue: Venue = .none
    var participants = ""
    var eventDays: [SellerDay]?
    var slots: [String: SellerSlot] = [:]
    var materialsDue = ""
    var technical = ""
    var logistics = ""
    var contacts: [SellerContactInfo] = []

    init() {}
    init(_ data: SellerArrangementsData) {
        let values = data.values
        room = values.room
        venue = values.venue == nil ? .none : .keep
        participants = values.participantCount.map { SellerText.plain(.number($0)) } ?? ""
        eventDays = values.eventDays
        for item in SellerText.schedule { slots[item.key] = SellerSlot(values.slot(item.key)) }
        materialsDue = String((values.materialsDueDate ?? "").prefix(10))
        technical = values.technical
        logistics = values.logistics
        contacts = values.contacts
    }
}

@MainActor struct SellerOfferArrangementsView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let offerID: String
    let refreshKey: Int
    @Binding var dirty: Bool
    let go: (String) -> Void
    /// Po zapisie — odświeżenie kreatora i listy ofert (`onSaved` w CRM).
    let saved: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: SellerArrangementsData?
    @State private var draft = SellerArrangementDraft()
    @State private var savedDraft = SellerArrangementDraft()
    @State private var loading = true
    @State private var saving = false
    @State private var error = ""
    @State private var message = ""
    @State private var customRoom = false
    @State private var expanded: Set<Int> = []
    @State private var assetURLs: [String: String] = [:]
    @State private var assetsLoading = false
    @State private var assetsLoaded = false
    @State private var requestSequence = 0
    @State private var confirmingReload = false
    @State private var confirmingDays = false

    private var isDirty: Bool { draft != savedDraft }
    private var hotel: SellerArrangementsData.Hotel? { data?.hotel }
    private var hotelReady: Bool { data != nil && data?.hotelError == nil }
    /// Przestrzeń wskazana w formularzu (zapisana albo wybrana z bazy hotelu).
    private var currentVenue: SellerVenueInfo? {
        switch draft.venue {
        case .keep: return data?.values.venue
        case .room(let id):
            guard let hotel, let organization = hotel.organization, let location = hotel.location,
                  let room = location.rooms.first(where: { $0.id == id }) else { return nil }
            return SellerVenueInfo(organizationId: organization.id, organizationName: organization.name, locationId: location.id,
                                   locationName: location.name, room: room, technicalDetails: location.technicalDetails)
        case .none: return nil
        }
    }
    private var savedRoomInHotel: Bool {
        guard let venue = currentVenue, let organization = hotel?.organization else { return false }
        return venue.organizationId == organization.id
    }
    /// Zapisana sala spoza aktualnej listy sal hotelu — pokazywana jako „(zapisana w ofercie)”.
    private var savedExtraVenue: SellerVenueInfo? {
        guard savedRoomInHotel, let venue = currentVenue else { return nil }
        let rooms = hotel?.location?.rooms ?? []
        return rooms.contains { $0.id == venue.room.id } ? nil : venue
    }
    private var daysError: String {
        guard let days = draft.eventDays else { return "" }
        return SellerSchedule.build(days.isEmpty ? [SellerSchedule.empty()] : days).error
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("USTALENIA REALIZACJI").font(.callout.weight(.semibold))
                    Text("Tutaj zapisujemy konkretne ustalenia i kontakty. Są wspólne dla oferty i powiązanej realizacji. Pytania oraz propozycje omawiamy w rozmowie obok.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button { if isDirty { confirmingReload = true } else { Task { await load(foreground: true) } } } label: {
                    Label("Wczytaj ustalenia", systemImage: "arrow.clockwise")
                }
                .disabled(loading || saving)
            }
            if loading && data == nil { HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Wczytywanie ustaleń i kontaktów…") } }
            if !error.isEmpty { note(error + " Twoje niezapisane zmiany nie zostały zastąpione.", .red) }
            if !message.isEmpty { note(message, theme.accent) }
            if let data { content(data) }
        }
        .task(id: offerID) { await load(foreground: true) }
        .onChange(of: refreshKey) { _, _ in Task { await load(foreground: false) } }
        .onChange(of: isDirty || saving) { _, value in dirty = value }
        .onDisappear { dirty = false }
        .alert("Wczytać zapisane dane i porzucić niezapisane zmiany w ustaleniach?", isPresented: $confirmingReload) {
            Button("Wczytaj", role: .destructive) { Task { await load(foreground: true) } }
            Button("Anuluj", role: .cancel) {}
        }
        .alert("Dotychczasowy zakres nie określa godzin każdego dnia. Ustalić je osobno?", isPresented: $confirmingDays) {
            Button("Ustal osobno") { startDays() }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Początek i koniec zostaną obliczone z nowych dni po zapisaniu ustaleń.")
        }
    }

    private func note(_ text: String, _ color: Color) -> some View {
        Text(text).font(.callout).foregroundStyle(color).fixedSize(horizontal: false, vertical: true)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    private func box<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) { content() }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func content(_ data: SellerArrangementsData) -> some View {
        HStack(alignment: .top, spacing: 10) {
            box {
                Text("Termin i miejsce z oferty").font(.caption).foregroundStyle(.secondary)
                Text(SellerText.localDate(data.offer.eventDate.map { String($0.prefix(10)) }))
                Text(data.offer.location?.nonEmpty ?? "Miejsce do ustalenia")
            }
            box {
                Text("Wartości oferty netto").font(.caption).foregroundStyle(.secondary)
                Text("Cena dla sprzedawcy: \(data.offer.baseNet == nil ? "—" : SellerText.money(data.offer.baseNet))")
                Text("Cena klienta: \(data.offer.clientNet == nil ? "—" : SellerText.money(data.offer.clientNet))")
            }
        }
        .font(.callout)
        if let event = data.event {
            box {
                Text("Terminy zapisane w kalendarzu CRM · \(event.name)").font(.caption).foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 6) {
                    ForEach(SellerText.schedule, id: \.key) { item in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.label).font(.caption).foregroundStyle(.secondary)
                            Text(SellerText.localDate(event.slot(item.key))).font(.callout)
                        }
                    }
                }
                if let location = event.location, !location.isEmpty { Text("Miejsce: \(location)").font(.callout) }
                if event.canViewCrm {
                    Button("Otwórz realizację — harmonogram i przypisanie zespołu") {
                        if event.id == eventID { go("phases") } else { state.showEvent(event.id, cardTab: "phases") }
                    }
                    .buttonStyle(.link).linkCursor().font(.caption)
                }
            }
        }
        Text("Ustalenia poniżej są wspólne dla sprzedawcy i CRM. Ich zapis nie zmienia cen, kalendarza ani akceptacji. Opiekun osobno zatwierdza decyzję i aktualizuje harmonogram realizacji.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if data.canEdit { editor(data) } else { readOnly(data) }
        VStack(alignment: .leading, spacing: 8) {
            Text("KLIENT I ZESPÓŁ REALIZACJI").font(.caption.weight(.semibold))
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8, alignment: .top), GridItem(.flexible(), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
                let company = (data.client.company ?? "").trimmingCharacters(in: .whitespaces)
                SellerContactCard(name: (data.client.name ?? "").nonEmpty ?? company.nonEmpty ?? "Klient — dane do uzupełnienia",
                                  role: company.isEmpty ? "Klient" : "Klient · \(company)", email: data.client.email, phone: data.client.phone)
                ForEach(data.team, id: \.id) { person in
                    SellerContactCard(name: person.name, role: person.role, email: person.email, phone: person.phone)
                }
            }
            Text(data.team.isEmpty ? "Opiekun lub zespół nie zostali jeszcze przypisani. Po przypisaniu w CRM pojawią się tutaj wraz ze służbowym kontaktem."
                 : "Pokazujemy opiekuna oraz osoby z potwierdzonym przydziałem do realizacji — wyłącznie służbowe dane kontaktowe.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        Text(data.values.updatedAt.map { "Zapisana wersja \(data.values.revision) · \(SellerText.timestamp($0))" } ?? "Nie zapisano jeszcze dodatkowych ustaleń.")
            .font(.caption).foregroundStyle(.tertiary)
    }

    // MARK: Edycja

    @ViewBuilder private func editor(_ data: SellerArrangementsData) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                roomField(data).frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Liczba uczestników").font(.caption).foregroundStyle(.secondary)
                    TextField("Do ustalenia", text: Binding(get: { draft.participants }, set: { draft.participants = String($0.filter(\.isNumber).prefix(7)) }))
                        .textFieldStyle(.roundedBorder).frame(width: 140)
                }
            }
            if let venue = currentVenue { venueDetails(venue) }
            if let days = draft.eventDays { daysEditor(days.isEmpty ? [SellerSchedule.empty()] : days) }
            VStack(alignment: .leading, spacing: 8) {
                Text("Harmonogram ustaleń · czas polski (Europe/Warsaw)").font(.caption).foregroundStyle(.secondary)
                ForEach(SellerText.schedule.filter { draft.eventDays == nil || $0.key == "setup_at" || $0.key == "teardown_at" }, id: \.key) { item in
                    SellerSlotField(label: item.label, slot: Binding(get: { draft.slots[item.key] ?? SellerSlot() }, set: { draft.slots[item.key] = $0 }),
                                    fallback: data.offer.eventDate.map { String($0.prefix(10)) } ?? "")
                }
            }
            if draft.eventDays == nil {
                Button { askDays() } label: { Label("Ustal godziny dla poszczególnych dni", systemImage: "plus") }
            }
            SellerDateField(label: "Termin dostarczenia materiałów", value: $draft.materialsDue, fallback: data.offer.eventDate.map { String($0.prefix(10)) } ?? "")
            DisclosureGroup("Dodatkowe wymagania techniczne i logistyczne\(draft.technical.isEmpty && draft.logistics.isEmpty ? " · opcjonalnie" : " · uzupełnione")") {
                VStack(alignment: .leading, spacing: 8) {
                    textArea("Wymagania techniczne", "Wymagania dotyczące tego eventu, poza opisem wybranej sali", $draft.technical)
                    textArea("Logistyka i wymagania organizacyjne", "Np. wjazd, rozładunek, parking, nocleg", $draft.logistics)
                }
                .padding(.top, 6)
            }
            .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            contactsEditor(data)
            HStack(spacing: 10) {
                Button { Task { await save() } } label: {
                    HStack(spacing: 6) {
                        if saving { ProgressView().controlSize(.small) } else { Image(systemName: "square.and.arrow.down") }
                        Text(saving ? "Zapisywanie…" : "Zapisz ustalenia")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!isDirty || !daysError.isEmpty || saving || loading)
                if isDirty { Text("Masz niezapisane zmiany.").font(.caption).foregroundStyle(.orange) }
            }
        }
        .disabled(saving || loading)
    }

    private func textArea(_ title: String, _ prompt: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(title, text: Binding(get: { text.wrappedValue }, set: { text.wrappedValue = String($0.prefix(3000)) }), prompt: Text(prompt), axis: .vertical)
                .lineLimit(3...10).textFieldStyle(.roundedBorder).labelsHidden()
        }
    }

    /// Sala / przestrzeń: wybór z bazy hotelu tej oferty albo inna przestrzeń wpisana ręcznie.
    @ViewBuilder private func roomField(_ data: SellerArrangementsData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Sala / przestrzeń").font(.caption).foregroundStyle(.secondary)
            if hotelReady, let hotel {
                if let organization = hotel.organization { Text("Podpowiedzi: \(organization.name)").font(.caption).foregroundStyle(.secondary) }
                if hotel.available && hotel.organization == nil {
                    Text("Wybierz organizację w edycji oferty, aby korzystać z jej przestrzeni i kontaktów.").font(.caption).foregroundStyle(.secondary)
                }
                if !hotel.available {
                    Text("Brak bazy hotelowej dla organizacji zapisanej przy tej ofercie. Organizację wybierzesz w edycji oferty; inną przestrzeń możesz wpisać ręcznie.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if hotel.organization != nil && hotel.location == nil {
                    Text("Hotel nie ma przypisanej lokalizacji. Opiekun CRM musi ją powiązać z organizacją, a następnie dodać sale.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if let location = hotel.location, location.rooms.isEmpty {
                    Text("Nie dodano jeszcze sal w lokalizacji tego hotelu. Poproś opiekuna CRM o uzupełnienie przestrzeni.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if hotel?.available == true && !customRoom, let hotel {
                let rooms = hotel.location?.rooms ?? []
                let savedExtra = savedExtraVenue
                Picker("Wybierz salę hotelu", selection: Binding(get: { savedRoomInHotel ? (currentVenue?.room.id ?? "") : "" }, set: { pickRoom($0) })) {
                    Text(rooms.isEmpty && savedExtra == nil ? "Brak sal — dodaj je w ustawieniach hotelu" : "Wyszukaj salę lub przestrzeń hotelu…").tag("")
                    ForEach(rooms, id: \.id) { room in Text(room.notes.isEmpty ? room.name : "\(room.name) — \(room.notes)").tag(room.id) }
                    if let savedExtra { Text("\(savedExtra.room.name) (zapisana w ofercie)").tag(savedExtra.room.id) }
                }
                .labelsHidden()
                .disabled(!hotelReady || hotel.organization == nil)
            } else {
                TextField("Nazwa innej przestrzeni", text: Binding(get: { draft.room }, set: { draft.room = String($0.prefix(200)); draft.venue = .none }))
                    .textFieldStyle(.roundedBorder)
            }
            if let hotel, hotel.available {
                HStack(spacing: 12) {
                    Button(customRoom ? "Wybierz z bazy hotelu" : "Inna przestrzeń — wpisz ręcznie") { customRoom.toggle() }.buttonStyle(.link).font(.caption)
                    if let organization = hotel.organization {
                        Button("Ustawienia przestrzeni i kontaktów") { state.openCRM("/crm/contacts/\(organization.id)?tab=branding#hotel-directory") }
                            .buttonStyle(.link).font(.caption).help("Baza sal i kontaktów hotelu w ustawieniach organizacji")
                    }
                }
            }
            if let venue = currentVenue, !savedRoomInHotel {
                Text("Wybrana do oferty: \(venue.organizationName) · \(venue.room.name). Zapisana przestrzeń pozostaje bez zmian.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let hotelError = data.hotelError {
                Text(hotelError + " Możesz nadal wpisać dane ręcznie.").font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func pickRoom(_ id: String) {
        guard hotelReady, let hotel else { return }
        if !id.isEmpty && savedRoomInHotel && id == currentVenue?.room.id { return }
        if let room = hotel.location?.rooms.first(where: { $0.id == id }), hotel.location != nil, hotel.organization != nil {
            draft.room = room.name
            draft.venue = .room(room.id)
        } else {
            draft.room = ""
            draft.venue = .none
        }
    }

    /// Plany i informacje o przestrzeni (`TechnicalDetailsView` sali i lokalizacji hotelu) — pliki podpisywane przy rozwinięciu.
    private func venueDetails(_ venue: SellerVenueInfo) -> some View {
        DisclosureGroup("\(venue.organizationName) · \(venue.room.name) — plany i informacje o przestrzeni") {
            VStack(alignment: .leading, spacing: 10) {
                if !venue.room.notes.isEmpty { Text(venue.room.notes).foregroundStyle(.secondary).textSelection(.enabled) }
                LocationTechnicalView(value: venue.room.technical, urls: assetURLs, loading: assetsLoading)
                LocationTechnicalView(value: venue.technicalDetails, urls: assetURLs, loading: assetsLoading)
            }
            .padding(.top, 6)
            .task { await loadAssets() }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    /// `SellerEventSchedule` — dni wydarzenia z godzinami (także przez północ), maks. 31 dni.
    @ViewBuilder private func daysEditor(_ days: [SellerDay]) -> some View {
        let built = SellerSchedule.build(days)
        VStack(alignment: .leading, spacing: 8) {
            Text("Termin i godziny eventu").font(.callout.weight(.medium))
            ForEach(Array(days.enumerated()), id: \.offset) { index, day in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 10) {
                        SellerDateField(label: index == 0 ? "Data eventu" : "Dzień \(index + 1)", value: dayBinding(days, index, \.date),
                                        fallback: index > 0 ? SellerSchedule.nextDay(days[index - 1].date) : "")
                        Text("Od").foregroundStyle(.secondary)
                        SellerTimeField(label: "Dzień \(index + 1) — początek", value: dayBinding(days, index, \.startTime))
                        Text("Do").foregroundStyle(.secondary)
                        SellerTimeField(label: "Dzień \(index + 1) — koniec", value: dayBinding(days, index, \.endTime))
                        if index > 0 {
                            Button { changeDays(days.enumerated().filter { $0.offset != index }.map(\.element)) } label: { Image(systemName: "trash") }
                                .buttonStyle(.borderless).help("Usuń dzień \(index + 1)")
                        }
                    }
                    if SellerSchedule.build([day]).error.isEmpty && !day.startTime.isEmpty && !day.endTime.isEmpty && day.endTime < day.startTime {
                        Text("Koniec: \(SellerSchedule.dayLabel(SellerSchedule.nextDay(day.date))), \(day.endTime) · następny dzień").font(.caption).foregroundStyle(theme.accent)
                    }
                }
            }
            if !built.error.isEmpty { Text(built.error).font(.caption).foregroundStyle(.red) }
            HStack {
                Button { changeDays(days + [SellerSchedule.empty(SellerSchedule.nextDay(days[days.count - 1].date))]) } label: { Label("Kolejny dzień", systemImage: "plus") }
                    .disabled(!built.error.isEmpty || days.first?.date.isEmpty != false || days.count >= SellerSchedule.maxDays
                              || SellerSchedule.nextDay(days[days.count - 1].date).isEmpty)
                Spacer()
                Text("Godziny opcjonalne · czas polski").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func dayBinding(_ days: [SellerDay], _ index: Int, _ field: WritableKeyPath<SellerDay, String>) -> Binding<String> {
        Binding(get: { index < days.count ? days[index][keyPath: field] : "" }, set: { value in
            var next = days
            guard index < next.count else { return }
            next[index][keyPath: field] = value
            changeDays(next)
        })
    }

    /// `changeEventDays` — dni oraz początek i koniec obliczone z nich (jak w formularzu CRM).
    private func changeDays(_ days: [SellerDay]) {
        let built = SellerSchedule.build(days)
        draft.eventDays = days
        draft.slots["starts_at"] = SellerSlot(built.startsAt)
        draft.slots["ends_at"] = SellerSlot(built.endsAt)
    }

    private func currentRange() -> (String?, String?) {
        func value(_ key: String) -> String? {
            guard let slot = draft.slots[key], !slot.date.isEmpty, !slot.time.isEmpty else { return nil }
            return slot.date + "T" + slot.time
        }
        return (value("starts_at"), value("ends_at"))
    }

    private func askDays() {
        let (start, end) = currentRange()
        if SellerSchedule.hasLegacyRange(eventDays: nil, startsAt: start, endsAt: end) { confirmingDays = true } else { startDays() }
    }

    private func startDays() {
        let (start, end) = currentRange()
        let fallback = draft.slots["starts_at"]?.date.nonEmpty ?? data?.offer.eventDate.map { String($0.prefix(10)) } ?? ""
        changeDays(SellerSchedule.daysFrom(eventDays: nil, startsAt: start, endsAt: end, fallback: fallback))
    }

    @ViewBuilder private func contactsEditor(_ data: SellerArrangementsData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("KONTAKTY ORGANIZACYJNE").font(.caption.weight(.semibold))
            Text("Osoby po stronie hotelu, klienta lub organizatora. Dane widoczne także dla drugiej strony.").font(.caption).foregroundStyle(.secondary)
            if let hotel, hotel.available {
                let available = hotel.contacts.filter { person in !draft.contacts.contains { $0.name == person.name && $0.email == person.email && $0.phone == person.phone } }
                Menu {
                    if available.isEmpty { Text("Brak kolejnych kontaktów — dodaj je w ustawieniach hotelu") }
                    ForEach(available, id: \.id) { person in
                        Button([person.name, [person.role, person.phone, person.email].filter { !$0.isEmpty }.joined(separator: " · ")].filter { !$0.isEmpty }.joined(separator: " — ")) {
                            guard hotelReady, draft.contacts.count < 12 else { return }
                            draft.contacts.append(SellerContactInfo(name: person.name, role: person.role, email: person.email, phone: person.phone))
                        }
                    }
                } label: { Label("Wyszukaj kontakt hotelu — np. technik, recepcja, sprzedaż…", systemImage: "person.crop.circle.badge.plus") }
                .fixedSize()
                .disabled(!hotelReady || hotel.organization == nil || draft.contacts.count >= 12)
            }
            ForEach(Array(draft.contacts.enumerated()), id: \.offset) { index, person in
                DisclosureGroup(isExpanded: Binding(get: { expanded.contains(index) }, set: { if $0 { expanded.insert(index) } else { expanded.remove(index) } })) {
                    VStack(alignment: .leading, spacing: 8) {
                        Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 8) {
                            GridRow {
                                contactField(index, "Imię i nazwisko *", \.name, 160)
                                contactField(index, "Rola przy evencie", \.role, 100)
                            }
                            GridRow {
                                contactField(index, "E-mail", \.email, 254)
                                contactField(index, "Telefon", \.phone, 50)
                            }
                        }
                        Button(role: .destructive) { removeContact(index) } label: { Label("Usuń kontakt z ustaleń", systemImage: "trash") }
                            .buttonStyle(.borderless).font(.caption)
                    }
                    .padding(.top, 6)
                } label: {
                    HStack(spacing: 6) {
                        Text(person.name.isEmpty ? "Nowy kontakt" : person.name + (person.role.isEmpty ? "" : " · " + person.role)).foregroundStyle(theme.accent)
                        Text(person.phone.nonEmpty ?? person.email.nonEmpty ?? "Dane i edycja").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            Button {
                draft.contacts.append(SellerContactInfo(name: "", role: "", email: "", phone: ""))
                expanded.insert(draft.contacts.count - 1)
            } label: { Label("Inny kontakt — tylko do tej oferty", systemImage: "plus") }
            .disabled(draft.contacts.count >= 12)
        }
    }

    private func contactField(_ index: Int, _ title: String, _ field: WritableKeyPath<SellerContactInfo, String>, _ limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(title, text: Binding(get: { index < draft.contacts.count ? draft.contacts[index][keyPath: field] : "" }, set: { value in
                guard index < draft.contacts.count else { return }
                draft.contacts[index][keyPath: field] = String(value.prefix(limit))
            }))
            .textFieldStyle(.roundedBorder).labelsHidden()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func removeContact(_ index: Int) {
        guard index < draft.contacts.count else { return }
        draft.contacts.remove(at: index)
        expanded = Set(expanded.compactMap { $0 < index ? $0 : $0 > index ? $0 - 1 : nil })
    }

    // MARK: Podgląd (bez uprawnień do edycji)

    @ViewBuilder private func readOnly(_ data: SellerArrangementsData) -> some View {
        let values = data.values
        VStack(alignment: .leading, spacing: 10) {
            Text("Masz dostęp do podglądu. Edycja wymaga uprawnień do zarządzania ofertą tej marki.").font(.caption).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 8) {
                fact("Sala / przestrzeń", values.room.nonEmpty ?? "Nie ustalono")
                fact("Uczestnicy", values.participantCount.map { SellerText.plain(.number($0)) } ?? "Nie ustalono")
                ForEach(SellerText.schedule, id: \.key) { item in fact("\(item.label) · czas polski", SellerText.localDate(values.slot(item.key))) }
                fact("Materiały do", SellerText.localDate(values.materialsDueDate))
            }
            SellerEventDaysSummary(days: values.eventDays)
            if let venue = values.venue {
                DisclosureGroup("Plany i zapisane informacje o przestrzeni") {
                    VStack(alignment: .leading, spacing: 10) {
                        if !venue.room.notes.isEmpty { Text(venue.room.notes).textSelection(.enabled) }
                        LocationTechnicalView(value: venue.room.technical, urls: assetURLs, loading: assetsLoading)
                        LocationTechnicalView(value: venue.technicalDetails, urls: assetURLs, loading: assetsLoading)
                    }
                    .padding(.top, 6)
                    .task { await loadAssets() }
                }
                .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            fact("Wymagania techniczne", values.technical.nonEmpty ?? "Nie ustalono")
            fact("Logistyka", values.logistics.nonEmpty ?? "Nie ustalono")
            Text("KONTAKTY ORGANIZACYJNE").font(.caption.weight(.semibold))
            if values.contacts.isEmpty {
                Text("Nie dodano jeszcze kontaktów organizacyjnych.").font(.caption).foregroundStyle(.tertiary)
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8, alignment: .top), GridItem(.flexible(), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
                    ForEach(Array(values.contacts.enumerated()), id: \.offset) { _, contact in
                        SellerContactCard(name: contact.name, role: contact.role, email: contact.email, phone: contact.phone)
                    }
                }
            }
        }
    }

    private func fact(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Odczyt i zapis

    private func accept(_ next: SellerArrangementsData, reset: Bool) {
        let nextDraft = SellerArrangementDraft(next)
        let venueChanged = next.values.venue != data?.values.venue || next.hotel != data?.hotel
        data = next
        if venueChanged { assetsLoaded = false; assetURLs = [:] }
        if reset || nextDraft != savedDraft {
            savedDraft = nextDraft
            draft = nextDraft
            customRoom = !nextDraft.room.isEmpty && next.values.venue == nil
            expanded = Set(nextDraft.contacts.indices.filter { nextDraft.contacts[$0].name.isEmpty })
        }
    }

    /// Odczyt w tle nigdy nie zastępuje niezapisanego formularza (podpowiedzi hotelu odświeżają się zawsze).
    private func load(foreground: Bool) async {
        requestSequence += 1
        let sequence = requestSequence
        let editing = draft
        if foreground || data == nil { loading = true; error = ""; message = "" }
        do {
            let next = try await store.tabQuery(eventID, "seller-arrangements", "arrangements", ["offerId": offerID], as: SellerArrangementsData.self)
            guard sequence == requestSequence else { return }
            if draft == editing && (foreground || (!isDirty && !saving)) {
                accept(next, reset: foreground)
                error = ""
            } else if data != nil {
                data?.hotel = next.hotel
                data?.hotelError = next.hotelError
            }
        } catch {
            if sequence == requestSequence { self.error = store.failureText(error, "Nie udało się wczytać lub zapisać danych. Spróbuj ponownie.") }
        }
        if sequence == requestSequence { loading = false }
    }

    private func loadAssets() async {
        guard !assetsLoaded, !assetsLoading else { return }
        struct Reply: Decodable { let urls: [String: String] }
        assetsLoading = true
        defer { assetsLoading = false }
        if let reply = try? await store.tabQuery(eventID, "seller-arrangements", "venueAssets", ["offerId": offerID], as: Reply.self) {
            assetURLs = reply.urls
            assetsLoaded = true
        }
    }

    /// Te same sprawdzenia co formularz CRM przed zapisem; serwer powtarza je i odczytuje przestrzeń z bazy hotelu na nowo.
    private func problem() -> String? {
        if !daysError.isEmpty { return "Popraw daty i godziny zaznaczone w formularzu." }
        var values: [String: String] = [:]
        for item in SellerText.schedule {
            if draft.eventDays != nil && (item.key == "starts_at" || item.key == "ends_at") {
                if let slot = draft.slots[item.key], !slot.date.isEmpty { values[item.key] = slot.date + "T" + slot.time }
                continue
            }
            let slot = draft.slots[item.key] ?? SellerSlot()
            if slot.date.isEmpty != slot.time.isEmpty || (!slot.time.isEmpty && !SellerText.validTime(slot.time)) {
                return "\(item.label): uzupełnij datę i godzinę albo pozostaw oba pola puste."
            }
            if !slot.date.isEmpty { values[item.key] = slot.date + "T" + slot.time }
        }
        if let start = values["starts_at"], let end = values["ends_at"], end < start { return "Sprawdź kolejność terminów: montaż, początek, koniec i demontaż." }
        if let setup = values["setup_at"], let start = values["starts_at"], setup > start { return "Sprawdź kolejność terminów: montaż, początek, koniec i demontaż." }
        if let teardown = values["teardown_at"], let end = values["ends_at"], teardown < end { return "Sprawdź kolejność terminów: montaż, początek, koniec i demontaż." }
        if let count = Int(draft.participants), count > 1_000_000 { return "Liczba uczestników: podaj liczbę całkowitą od 0 do 1 000 000." }
        for contact in draft.contacts {
            if contact.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Uzupełnij imię i nazwisko każdego kontaktu organizacyjnego." }
            let email = contact.email.trimmingCharacters(in: .whitespacesAndNewlines)
            if !email.isEmpty && email.range(of: #"^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$"#, options: .regularExpression) == nil { return "Nieprawidłowy e-mail kontaktu" }
        }
        return nil
    }

    private func save() async {
        guard let data, data.canEdit, !saving else { return }
        error = ""
        message = ""
        if let problem = problem() { error = problem; return }
        let venue: JSONValue
        switch draft.venue {
        case .keep: venue = .object(["mode": .string("keep")])
        case .room(let id): venue = .object(["mode": .string("room"), "roomId": .string(id)])
        case .none: venue = .object(["mode": .string("none")])
        }
        var schedule: [String: JSONValue] = [:]
        for item in SellerText.schedule { schedule[item.key] = (draft.slots[item.key] ?? SellerSlot()).json }
        let body: [String: JSONValue] = [
            "offerId": .string(offerID), "revision": .number(Double(data.values.revision)), "room": .string(draft.room), "venue": venue,
            "participantCount": .string(draft.participants), "eventDays": draft.eventDays.map { JSONValue.array($0.map(\.json)) } ?? JSONValue.null,
            "schedule": .object(schedule), "materialsDueDate": .string(draft.materialsDue), "technical": .string(draft.technical),
            "logistics": .string(draft.logistics), "contacts": .array(draft.contacts.map(\.json)),
        ]
        requestSequence += 1
        saving = true
        defer { saving = false }
        do {
            let reply = try await store.tabAction(eventID, "seller-arrangements", "saveArrangements", body, reload: [], success: nil, pending: nil)
            let next = try JSONDecoder().decode(SellerArrangementsData.self, from: reply)
            accept(next, reset: true)
            message = "Ustalenia zapisano. Dotychczasowa decyzja o akceptacji pozostaje bez zmian."
            await saved()
        } catch {
            self.error = store.failureText(error, "Nie udało się wczytać lub zapisać danych. Spróbuj ponownie.")
        }
    }
}
