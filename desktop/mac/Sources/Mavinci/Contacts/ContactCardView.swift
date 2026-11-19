import SwiftUI
import AppKit

// MARK: Karta kontaktu i organizacji — 1:1 z `/crm/contacts/[id]`: nagłówek z szybkimi czynnościami, zakładki według uprawnień
// (organizacja: Szczegóły z danymi do faktury, lokalizacją, reprezentantami i osobami decyzyjnymi, Osoby kontaktowe, Notatki,
// Faktury, Realizacje; kontakt i osoba prywatna: Dane kontaktowe, Organizacje) oraz „Relacja i segmentacja” (opiekun, etap relacji,
// segmentacja i komunikacja, domeny organizacji, duplikaty i scalanie, zapytania, broszury). Edycja i dodawanie — arkusze
// `OrganizationEditorSheet` / `PersonEditorSheet`; zapisy przez `/bridge/native/v1/contacts` (RLS i wyzwalacze jak w CRM).
// „Klient 360°”, „Zapytania”, „Oferty”, „Sprzedaż sprzedawcy” — `ContactCustomer360View.swift`; „Usługi” podwykonawcy —
// `SubcontractorServicesPanel`; „Dodaj zapytanie” — `NewInquirySheet` z danymi klienta. „Branding ofert” (`CrmOfferBrandingPanel`)
// — `OfferBrandingPanel`; „Sale i przestrzenie” hotelu (`OrganizationHotelSpaces`) — lokalizacja i `LocationSpacesPanel`.

enum ContactCardTab: String, Identifiable {
    case customer360, inquiries, offers, venue, details, persons, organizations, notes, invoices, events, branding, services, seller, relation
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .customer360: return "clock.arrow.circlepath"
        case .inquiries: return "tray"
        case .offers: return "doc.richtext"
        case .venue: return "square.split.2x2"
        case .branding: return "paintpalette"
        case .services: return "wrench.and.screwdriver"
        case .seller: return "percent"
        case .details: return "doc.text"
        case .persons: return "person.2"
        case .organizations: return "building.2"
        case .notes: return "note.text"
        case .invoices: return "doc.plaintext"
        case .events: return "calendar"
        case .relation: return "person.crop.circle.badge.checkmark"
        }
    }
}

/// Arkusze karty.
enum ContactCardSheet: Identifiable {
    case edit, linkPerson, linkOrganization, decisionMaker, segmentation
    case merge(ContactEntry)
    /// „Dodaj zapytanie” z danymi klienta (`ContactQuickActions`).
    case newInquiry(NewInquiryClient)
    var id: String {
        switch self {
        case .newInquiry: return "new-inquiry"
        case .edit: return "edit"
        case .linkPerson: return "link-person"
        case .linkOrganization: return "link-organization"
        case .decisionMaker: return "decision-maker"
        case .segmentation: return "segmentation"
        case .merge(let entry): return "merge-\(entry.id)"
        }
    }
}

/// Czynności wymagające potwierdzenia.
enum ContactCardConfirm: Identifiable {
    case unlink(relationId: String, name: String, organization: Bool)
    case removeMaker(ContactCardDecisionMaker)
    case removeNote(ContactCardNote)
    var id: String {
        switch self {
        case .unlink(let relationId, _, _): return "unlink-\(relationId)"
        case .removeMaker(let maker): return "maker-\(maker.id)"
        case .removeNote(let note): return "note-\(note.id)"
        }
    }
    var title: String {
        switch self {
        case .unlink: return "Usuń powiązanie"
        case .removeMaker: return "Usuń osobę decyzyjną"
        case .removeNote: return "Usuń notatkę"
        }
    }
    var message: String {
        switch self {
        case .unlink(_, let name, let organization):
            return organization ? "Czy na pewno chcesz usunąć powiązanie z organizacją „\(name)”?" : "Czy na pewno chcesz usunąć powiązanie osoby „\(name)” z organizacją?"
        case .removeMaker(let maker): return "Usunąć „\(maker.name)” z listy osób decyzyjnych?"
        case .removeNote: return "Czy na pewno chcesz usunąć tę notatkę?"
        }
    }
}

@MainActor struct ContactCardView: View {
    @ObservedObject var store: ContactsStore
    let ref: ContactRef
    let actions: ContactActions
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var tab: ContactCardTab = .details
    @State private var sheet: ContactCardSheet?
    @State private var confirm: ContactCardConfirm?
    @State private var noteDraft = ""
    @State private var ownerID = ""
    @State private var lifecycle = "lead"
    @State private var domains = ""
    @State private var preparingInquiry = false

    private var card: ContactCard? { store.card(ref.id) }
    private var entry: ContactEntry? { store.entry(ref.id) }
    private var isOrganization: Bool { ref.kind == .organization }
    private var loading: Bool { store.cardLoading.contains(ref.id) }
    private var title: String {
        if let organization = card?.organization { return organization.displayName }
        if let person = card?.contact { return person.name }
        return entry?.name ?? (isOrganization ? "Organizacja" : "Kontakt")
    }
    private var subtitle: String {
        if let organization = card?.organization {
            return [ContactDictionaries.label(organization.businessType, in: ContactDictionaries.businessTypes), "Klient"].filter { !$0.isEmpty }.joined(separator: " • ")
        }
        return ref.kind.label
    }
    /// Zapisane opiekun, etap relacji i domeny — formularz „Relacja” zaczyna od nich po każdym odczycie karty.
    private var savedOwner: String { card?.organization?.ownerId ?? card?.contact?.ownerId ?? "" }
    private var savedLifecycle: String { card?.organization?.lifecycle ?? card?.contact?.lifecycle ?? "lead" }
    private var savedDomains: String { (card?.organization?.domains ?? []).joined(separator: ", ") }
    private var stamp: String { "\(savedOwner)|\(savedLifecycle)|\(savedDomains)" }

    var body: some View {
        Group {
            if let card {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        header(card)
                        if !card.warnings.isEmpty {
                            Label("Nie udało się wczytać: \(card.warnings.joined(separator: ", ")).", systemImage: "exclamationmark.triangle")
                                .font(.callout).foregroundStyle(.orange)
                        }
                        tabBar(card)
                        content(card)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if let error = store.cardErrors[ref.id] {
                ContentUnavailableView {
                    Label("Nie można otworzyć karty", systemImage: "person.crop.circle.badge.exclamationmark")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadCard(ref) } }
                    Button("Wróć do listy") { store.opened = nil }
                }
            } else {
                ProgressView("Pobieranie karty…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.page)
        .navigationTitle(title)
        .navigationSubtitle(subtitle)
        .toolbar { toolbar }
        .sheet(item: $sheet) { item in
            sheetContent(item)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                            titleVisibility: .visible, presenting: confirm) { item in
            Button("Usuń", role: .destructive) { perform(item) }
            Button("Anuluj", role: .cancel) {}
        } message: { item in
            Text(item.message)
        }
        .task(id: ref.id) {
            tab = .details
            prepare()
            await store.loadCard(ref)
            prepare()
        }
        .onChange(of: stamp) { _, _ in prepare() }
    }

    private func prepare() {
        ownerID = savedOwner
        lifecycle = savedLifecycle
        domains = savedDomains
    }

    // MARK: Pasek narzędzi
    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button { store.opened = nil } label: { Label("Kontakty", systemImage: "chevron.left") }
                .help("Wróć do listy kontaktów")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if loading { ProgressView().controlSize(.small).help("Odświeżanie karty") }
            Button { sheet = .edit } label: { Label("Edytuj", systemImage: "pencil") }
                .help("Edytuj dane (⌘E)").keyboardShortcut("e").disabled(card == nil)
            Button { Task { await store.loadCard(ref) } } label: { Label("Odśwież kartę", systemImage: "arrow.clockwise") }
                .disabled(loading)
            Menu {
                Button("Karta w CRM", systemImage: "safari") {
                    state.openCRM("/crm/contacts/\(ref.id)")
                }
                // „Pokaż portal hotelowi” jak w menu karty CRM: organizacja-klient albo osoba kontaktowa (nie osoba prywatna).
                if canShowDemo {
                    Button("Pokaż portal hotelowi", systemImage: "rectangle.on.rectangle") {
                        if isOrganization { state.showSellerDemo(organization: ref.id, hotel: title) } else { state.showSellerDemo(contact: ref.id) }
                    }
                }
                // Osoba: „Mianuj sprzedawcą” (kreator z tą osobą) albo karta i rozmowa istniejącego sprzedawcy.
                if !isOrganization && canManageSalespeople {
                    if entry?.seller == true {
                        Button("Karta sprzedawcy", systemImage: "person.crop.rectangle") { state.showSeller(contactID: ref.id) }
                        Button("Rozmowa ze sprzedawcą", systemImage: "bubble.left.and.bubble.right") { openSellerChat() }
                    } else {
                        Button("Mianuj sprzedawcą…", systemImage: "person.badge.plus") { state.appointSeller(contactID: ref.id) }
                    }
                }
                Divider()
                Button("Kopiuj adres e-mail", systemImage: "doc.on.doc") { copy(entry?.email ?? "", "adres e-mail") }
                    .disabled(entry?.email.isEmpty ?? true)
                Button("Kopiuj numer telefonu", systemImage: "phone.arrow.up.right") { copy(entry?.callPhone ?? "", "numer telefonu") }
                    .disabled(entry?.callPhone.isEmpty ?? true)
                if card?.access.canManage == true, let entry {
                    Divider()
                    Button("Usuń…", systemImage: "trash", role: .destructive) { actions.remove(entry) }
                }
            } label: { Label("Więcej", systemImage: "ellipsis.circle") }
        }
    }

    // MARK: Nagłówek
    private func header(_ card: ContactCard) -> some View {
        HStack(alignment: .top, spacing: 14) {
            if let entry {
                ContactAvatarView(entry: entry, size: 64)
            } else {
                Image(systemName: ref.kind.symbol).font(.system(size: 28)).foregroundStyle(theme.accent)
                    .frame(width: 64, height: 64).background(theme.accent.opacity(0.1), in: Circle())
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.title2.weight(.semibold)).textSelection(.enabled)
                HStack(spacing: 6) {
                    pill(ref.kind.label, ref.kind.color)
                    if let organization = card.organization {
                        pill(ContactDictionaries.label(organization.status, in: ContactDictionaries.organizationStatuses), organization.status == "active" ? CrmTheme.rgb(0x4ade80) : .secondary)
                    }
                    if let entry, entry.seller { pill(entry.sellerLabel, entry.sellerColor) }
                }
                if let organization = card.organization, !organization.alias.isEmpty {
                    Text("Pełna nazwa: \(organization.name)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
                if let person = card.contact, !person.isIndividual, !person.position.isEmpty {
                    Text(person.position).foregroundStyle(.secondary)
                }
                if let links = card.organizations, !links.isEmpty { organizationChips(links) }
            }
            Spacer(minLength: 12)
            quickActions
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func organizationChips(_ links: [ContactCardOrgLink]) -> some View {
        HStack(spacing: 6) {
            Text(links.count == 1 ? "Organizacja:" : "Organizacje:").font(.caption).foregroundStyle(.secondary)
            ForEach(links, id: \.relationId) { link in
                Button { store.open(link.id, kind: .organization) } label: {
                    Label(link.name, systemImage: "building.2").font(.caption)
                }
                .buttonStyle(.link).linkCursor()
            }
        }
    }

    private var quickActions: some View {
        VStack(alignment: .trailing, spacing: 6) {
            HStack(spacing: 6) {
                Button { if let entry { actions.call(entry) } } label: { Label("Zadzwoń", systemImage: "phone") }
                    .buttonStyle(.borderedProminent).disabled(entry?.callPhone.isEmpty ?? true)
                Button { if let entry { actions.email(entry) } } label: { Label("Napisz e-mail", systemImage: "envelope") }
                    .disabled(entry?.email.isEmpty ?? true)
                Button { if let entry { actions.meeting(entry) } } label: { Label("Spotkanie", systemImage: "calendar.badge.plus") }
                    .disabled(entry == nil)
                if canCreateInquiry {
                    Button { Task { await startInquiry() } } label: { Label("Dodaj zapytanie", systemImage: "plus") }
                        .help("Utwórz zapytanie w lejku sprzedażowym z danymi klienta.").disabled(preparingInquiry)
                }
                // Osoba (kontakt lub osoba prywatna): mianowanie sprzedawcą albo karta istniejącego sprzedawcy.
                if !isOrganization && canManageSalespeople {
                    if entry?.seller == true {
                        Button { state.showSeller(contactID: ref.id) } label: { Label("Karta sprzedawcy", systemImage: "person.crop.rectangle") }
                            .help("Gotowość do pracy, oferty, rozmowy i rozliczenia sprzedawcy.")
                    } else {
                        Button { state.appointSeller(contactID: ref.id) } label: { Label("Mianuj sprzedawcą", systemImage: "person.badge.plus") }
                            .help("Kreator „Nowy sprzedawca” z tą osobą: organizacja, warunki marek, opiekun i e-mail z dostępem do portalu (link do hasła, logowanie, instrukcja).")
                    }
                }
            }
            .controlSize(.small)
        }
    }

    /// Kopia do schowka z potwierdzeniem.
    private func copy(_ value: String, _ label: String) {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        state.succeed("Skopiowano \(label): \(text)")
    }

    /// Rozmowy ze sprzedawcą (ten kontakt) — arkusz rozmów na ekranie Sprzedawców.
    private func openSellerChat() {
        state.showSellerChat(SellerChatRequest(sellerID: nil, contactID: ref.id, name: title, conversationID: nil),
                             href: "/crm/contacts/\(ref.id)?tab=seller&section=chat")
    }

    /// Jak `canCreateInquiry` w `ContactQuickActions`.
    private var canCreateInquiry: Bool {
        guard let employee = state.employee else { return false }
        return employee.isAdmin || employee.has("inquiries_manage") || employee.has("inquiries_manage_all") || employee.has("tasks_create")
    }

    /// Dane klienta do nowego zapytania (organizacja — jej dane; osoba — jej dane i jedyna obecna organizacja).
    private func startInquiry() async {
        preparingInquiry = true
        defer { preparingInquiry = false }
        struct Reply: Decodable { var contactId: String?; var organizationId: String?; var name: String; var email: String; var phone: String }
        do {
            let reply = try await Customer360API.get(state, ["op": "inquiryClient", "kind": isOrganization ? "organization" : "contact", "id": ref.id], as: Reply.self)
            sheet = .newInquiry(NewInquiryClient(contactID: reply.contactId, organizationID: reply.organizationId, name: reply.name.isEmpty ? title : reply.name,
                                                 email: reply.email.nonEmpty, phone: reply.phone.nonEmpty))
        } catch {
            state.error = Customer360API.message(error, "Nie udało się pobrać danych klienta do zapytania. Spróbuj ponownie.")
        }
    }

    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.medium)).lineLimit(1).padding(.horizontal, 8).padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }

    // MARK: Zakładki
    private func tabs(_ card: ContactCard) -> [ContactCardTab] {
        guard isOrganization else {
            var list: [ContactCardTab] = [.customer360, .inquiries, .offers, .details, .organizations]
            if entry?.seller == true { list.append(.seller) }
            list.append(.relation)
            return list
        }
        var list: [ContactCardTab] = []
        if card.tabs.contains("customer360") { list += [.customer360, .inquiries, .offers] }
        // „Sale i przestrzenie” — hotel, przy dostępie do szczegółów organizacji (jak w CRM).
        if card.tabs.contains("details"), card.organization?.businessType == "hotel" { list.append(.venue) }
        if card.tabs.contains("details") { list.append(.details) }
        if card.tabs.contains("contacts") { list.append(.persons) }
        if card.tabs.contains("notes") { list.append(.notes) }
        if card.tabs.contains("invoices") { list.append(.invoices) }
        if card.tabs.contains("events") { list.append(.events) }
        // „Branding ofert” — jak w CRM: administrator, zarządzanie kontaktami albo finansami.
        if canManageSalespeople { list.append(.branding) }
        // „Usługi” — organizacja-podwykonawca z kartą podwykonawcy (jak w CRM).
        if card.tabs.contains("services"), let organization = card.organization, organization.organizationType == "subcontractor",
           !organization.subcontractorId.isEmpty { list.append(.services) }
        list.append(.relation)
        return list
    }

    private func label(_ item: ContactCardTab, _ card: ContactCard) -> String {
        switch item {
        case .customer360: return "Klient 360°"
        case .inquiries: return "Zapytania"
        case .offers: return "Oferty"
        case .venue: return "Sale i przestrzenie"
        case .branding: return "Branding ofert"
        case .services: return "Usługi"
        case .seller: return "Sprzedaż sprzedawcy"
        case .details: return isOrganization ? "Szczegóły" : "Dane kontaktowe"
        case .persons: return "Osoby kontaktowe (\(card.persons?.count ?? 0))"
        case .organizations: return "Organizacje (\(card.organizations?.count ?? 0))"
        case .notes: return "Notatki (\(card.notes?.count ?? 0))"
        case .invoices: return "Faktury (\(card.invoices?.count ?? 0))"
        case .events: return "Realizacje (\(card.events?.count ?? 0))"
        case .relation: return "Relacja i segmentacja"
        }
    }

    private func current(_ card: ContactCard) -> ContactCardTab {
        let visible = tabs(card)
        return visible.contains(tab) ? tab : (visible.first ?? .relation)
    }

    private func tabBar(_ card: ContactCard) -> some View {
        let selected = current(card)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(tabs(card)) { item in
                    Button { tab = item } label: {
                        Label(label(item, card), systemImage: item.symbol)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .foregroundStyle(selected == item ? theme.accent : Color.secondary)
                            .overlay(alignment: .bottom) { if selected == item { Rectangle().fill(theme.accent).frame(height: 2) } }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private func content(_ card: ContactCard) -> some View {
        switch current(card) {
        case .customer360:
            Customer360View(ref: ref, store: store, isHotel: card.organization?.businessType == "hotel", organizationName: title).id(ref.id)
            if !isOrganization && entry?.seller == true && canViewFinances {
                Button("Zobacz rozliczenia prowizji, wypłaty i pozostałe saldo →") { state.openCRM("/crm/contacts/\(ref.id)?tab=seller&section=settlements") }
                    .buttonStyle(.link).linkCursor()
            }
        case .inquiries: CustomerInquiriesPanel(ref: ref).id(ref.id)
        case .offers: CustomerOffersPanel(ref: ref).id(ref.id)
        case .services:
            if let organization = card.organization, !organization.subcontractorId.isEmpty {
                SubcontractorServicesPanel(subcontractorID: organization.subcontractorId)
                    .id(organization.subcontractorId)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
            }
        case .seller: sellerTab
        case .venue:
            if let organization = card.organization { hotelSpacesTab(card, organization) }
        case .branding: brandingTab(card)
        case .details:
            if let organization = card.organization { organizationDetails(card, organization) }
            else if let person = card.contact { personDetails(person) }
        case .persons: personsTab(card)
        case .organizations: organizationsTab(card)
        case .notes: notesTab(card)
        case .invoices: invoicesTab(card)
        case .events: eventsTab(card)
        case .relation: relationTab(card)
        }
    }

    // MARK: Szczegóły organizacji
    @ViewBuilder private func organizationDetails(_ card: ContactCard, _ org: ContactCardOrganization) -> some View {
        panel("Informacje podstawowe", accessory: editButton) {
            fieldGrid {
                field("Nazwa pełna", org.name)
                field("Alias (krótka nazwa)", org.alias)
                field("NIP", org.nip)
                field("Profil działalności", ContactDictionaries.label(org.businessType, in: ContactCardText.businessTypes + ContactDictionaries.businessTypes))
                field("Forma prawna / typ podmiotu", ContactDictionaries.label(org.legalForm, in: ContactDictionaries.legalForms))
                if ContactCardText.requiresKrs(org.legalForm) { field("KRS", org.krs) }
                field("REGON", org.regon)
                field("Numer identyfikacji wewnętrznej KSeF", org.ksefInternalId)
                field("Adres", [org.address, [org.postalCode, org.city].filter { !$0.isEmpty }.joined(separator: " "), org.country].filter { !$0.isEmpty }.joined(separator: ", "))
                field("E-mail", org.email)
                field("Telefon", org.phone)
                field("Strona www", org.website)
                field("Ocena", org.rating.map { "\(String(repeating: "★", count: $0)) (\($0)/5)" } ?? "Brak oceny")
                field("Status", ContactDictionaries.label(org.status, in: ContactDictionaries.organizationStatuses))
            }
            if !org.notes.isEmpty { field("Notatki", org.notes) }
        }
        invoicePanel(card, org)
        locationPanel(card, org)
        representationPanel(card, org)
    }

    private var editButton: some View {
        Button { sheet = .edit } label: { Label("Edytuj…", systemImage: "pencil") }.controlSize(.small)
    }

    private func invoicePanel(_ card: ContactCard, _ org: ContactCardOrganization) -> some View {
        panel("Dane do faktury") {
            Text("Na kogo wystawiamy faktury za tę organizację. Umowę i wydarzenia nadal prowadzisz z nią samą.")
                .font(.caption).foregroundStyle(.secondary)
            if let buyer = card.buyer {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "building.columns").foregroundStyle(theme.accent)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("NABYWCA NA FAKTURACH").font(.caption2.weight(.semibold)).foregroundStyle(theme.accent.opacity(0.8))
                        Button("\(buyer.name)\(buyer.nip.isEmpty ? "" : " · NIP \(buyer.nip)")") { store.open(buyer.id, kind: .organization) }
                            .buttonStyle(.link).linkCursor()
                        Text("Ta organizacja na fakturze jako odbiorca — \(ContactCardText.roleLabel(org.invoiceRecipientRole)).").font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else if !org.invoiceBuyerId.isEmpty {
                Text("Nabywca na fakturach jest niedostępny w Twoim zakresie danych.").foregroundStyle(.secondary)
            } else {
                Text("Faktury wystawiamy na tę organizację.")
            }
            let units = card.units ?? []
            if !units.isEmpty {
                Text("JEDNOSTKI ROZLICZANE NA TĘ ORGANIZACJĘ").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 4)
                ForEach(units) { unit in
                    Button { store.open(unit.id, kind: .organization) } label: {
                        HStack {
                            Text(unit.name).lineLimit(1)
                            Spacer()
                            Text(unit.role == 2 ? "jednostka wewnętrzna" : "JST").font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 5).padding(.horizontal, 8)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func locationPanel(_ card: ContactCard, _ org: ContactCardOrganization) -> some View {
        panel(org.businessType == "hotel" ? "Lokalizacja hotelu i przestrzenie" : "Powiązana lokalizacja") {
            if let location = card.location {
                HStack(alignment: .top) {
                    Image(systemName: "mappin.and.ellipse").foregroundStyle(theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(location.name).fontWeight(.medium).textSelection(.enabled)
                        if !location.address.isEmpty { Text(location.address).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    }
                    Spacer()
                    Button("Otwórz lokalizację") { state.showLocation(location.id) }.controlSize(.small)
                }
                if org.businessType == "hotel" {
                    Text("Sale, wymiary, zasilanie, rzuty i zdjęcia pochodzą z powiązanej lokalizacji. Zmiany są wspólne dla CRM i portalu sprzedawcy.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else if card.locationMissing == true {
                Label("Powiązana lokalizacja jest niedostępna. Sprawdź uprawnienia do lokalizacji.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
            } else {
                Text("Brak przypisanej lokalizacji").foregroundStyle(.secondary)
            }
        }
    }

    private func representationPanel(_ card: ContactCard, _ org: ContactCardOrganization) -> some View {
        let makers = card.decisionMakers ?? []
        let representative: ContactCardPersonRef? = org.contactIsRepresentative ? card.primaryContact : card.legalRepresentative
        var signers = Set(makers.filter(\.canSign).map(\.contactId))
        if let representative { signers.insert(representative.id) }
        let joint = org.representationType == "joint" || org.representationType == "joint_with_proxy"
        return panel("Reprezentanci i osoby decyzyjne", accessory: editButton) {
            subheading("Osoba kontaktowa", symbol: "person.crop.circle")
            personSummary(card.primaryContact, title: "")
            subheading("Reprezentant / osoba uprawniona", symbol: "checkmark.shield")
            if org.contactIsRepresentative { Text("Osoba kontaktowa jest też osobą uprawnioną do zawarcia umowy.").font(.caption).foregroundStyle(.secondary) }
            personSummary(representative, title: org.legalRepresentativeTitle)
            subheading("Sposób reprezentacji", symbol: "text.book.closed")
            Text(ContactCardText.representationHelp(org.legalForm)).font(.caption).foregroundStyle(.secondary)
            if org.representationType.isEmpty && org.representationRule.isEmpty {
                Text("Nie zweryfikowano sposobu reprezentacji.").foregroundStyle(.orange)
            } else {
                field("Typ", ContactDictionaries.label(org.representationType, in: ContactCardText.representation))
                field("Zasada", org.representationRule)
                HStack(spacing: 16) {
                    Text("Podstawa: \(org.representationBasis.isEmpty ? "—" : org.representationBasis)")
                    Text("Sprawdzono: \(org.representationVerifiedAt.isEmpty ? "—" : ContactCardText.day(org.representationVerifiedAt))")
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            if joint && signers.count < 2 {
                Label("Reprezentacja łączna wymaga wskazania co najmniej dwóch osób uprawnionych do podpisu zgodnie z dokładną zasadą reprezentacji. Wskazano: \(signers.count).",
                      systemImage: "exclamationmark.octagon")
                    .font(.caption).foregroundStyle(.red)
            }
            HStack {
                subheading("Osoby decyzyjne i dodatkowi reprezentanci", symbol: "person.2.badge.gearshape")
                Spacer()
                Button { sheet = .decisionMaker } label: { Label("Dodaj…", systemImage: "plus") }.controlSize(.small)
            }
            if makers.isEmpty { Text("Brak osób decyzyjnych").foregroundStyle(.secondary) }
            ForEach(makers) { maker in makerRow(maker) }
        }
    }

    private func makerRow(_ maker: ContactCardDecisionMaker) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(maker.name).fontWeight(.medium)
                if !maker.title.isEmpty { Text(maker.title).font(.caption).foregroundStyle(CrmTheme.rgb(0x4ade80)) }
                Toggle("Uprawniony do podpisu / współreprezentacji", isOn: Binding(get: { maker.canSign }, set: { next in
                    Task { await store.run("Zapisywanie…", "decisionMaker", ["action": .string("sign"), "id": .string(maker.id), "canSign": .bool(next)], reload: ref) }
                }))
                .toggleStyle(.checkbox).font(.caption)
            }
            Spacer()
            Button { confirm = .removeMaker(maker) } label: { Image(systemName: "trash") }
                .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń osobę decyzyjną")
        }
        .padding(8)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func personSummary(_ person: ContactCardPersonRef?, title: String) -> some View {
        if let person {
            Button { store.open(person.id, kind: store.entry(person.id)?.contactKind ?? .contact) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(person.name).fontWeight(.medium)
                    if !title.isEmpty { Text(title).font(.caption).foregroundStyle(CrmTheme.rgb(0xfbbf24)) }
                    else if !person.position.isEmpty { Text(person.position).font(.caption).foregroundStyle(.secondary) }
                    if !person.email.isEmpty { Text(person.email).font(.caption).foregroundStyle(.secondary) }
                    if !person.phone.isEmpty { Text(person.phone).font(.caption).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Otwórz kartę kontaktu")
        } else {
            Text("Nie wybrano").foregroundStyle(.secondary)
        }
    }

    // MARK: Dane kontaktu i osoby prywatnej
    private func personDetails(_ person: ContactCardPersonData) -> some View {
        panel("Dane kontaktowe", accessory: editButton) {
            fieldGrid {
                field("Imię", person.firstName)
                field("Nazwisko", person.lastName)
                field("E-mail", person.email)
                if !person.isIndividual { field("Stanowisko", person.position) }
                field(person.isIndividual ? "Telefon główny" : "Telefon prywatny", person.phone)
                field(person.isIndividual ? "Numer alternatywny" : "Telefon komórkowy", person.mobile)
                if person.isIndividual { field("Osoba alternatywna", person.alternativeContact) }
                if !person.isIndividual { field("Telefon firmowy", person.businessPhone) }
                field("Miasto", person.city)
                field("Kod pocztowy", person.postalCode)
                field("Adres", person.address)
                if !person.isIndividual { field("NIP", person.nip) }
                if person.isIndividual {
                    field("PESEL", person.pesel)
                    field("Numer dowodu", person.idNumber)
                    field("Rodzaj uroczystości", ContactDictionaries.label(person.eventType, in: ContactDictionaries.eventTypes))
                }
            }
            if person.isIndividual { field("Szczegóły uroczystości", person.eventDetails) }
            field("Notatki", person.notes)
        }
    }

    // MARK: Osoby kontaktowe i organizacje
    private func personsTab(_ card: ContactCard) -> some View {
        let persons = card.persons ?? []
        let addButton = Button { sheet = .linkPerson } label: { Label("Dodaj osobę…", systemImage: "plus") }.controlSize(.small)
        return panel("Osoby kontaktowe", accessory: addButton) {
            if persons.isEmpty { Text("Brak osób kontaktowych").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12) }
            ForEach(persons, id: \.relationId) { person in personRow(person) }
        }
    }

    private func personRow(_ person: ContactCardPerson) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button { store.open(person.id, kind: store.entry(person.id)?.contactKind ?? .contact) } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "person").foregroundStyle(theme.accent).frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(person.name).fontWeight(.medium)
                            if person.primary { pill("Główny kontakt", theme.accent) }
                        }
                        if !person.position.isEmpty { Text(person.position).font(.caption).foregroundStyle(.secondary) }
                        if !person.email.isEmpty { Label(person.email, systemImage: "envelope").font(.caption) }
                        if !person.phone.isEmpty { Label(person.phone, systemImage: "phone").font(.caption) }
                        if !person.mobile.isEmpty { Label("\(person.mobile) (komórkowy)", systemImage: "iphone").font(.caption) }
                    }
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Otwórz kartę kontaktu")
            Button { confirm = .unlink(relationId: person.relationId, name: person.name, organization: false) } label: { Image(systemName: "trash") }
                .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń powiązanie z organizacją")
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func organizationsTab(_ card: ContactCard) -> some View {
        let links = card.organizations ?? []
        let addButton = Button { sheet = .linkOrganization } label: { Label("Powiąż z organizacją…", systemImage: "plus") }.controlSize(.small)
        return panel("Organizacje", accessory: addButton) {
            if links.isEmpty { Text("Brak aktywnych powiązań.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12) }
            ForEach(links, id: \.relationId) { link in
                HStack {
                    Button { store.open(link.id, kind: .organization) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "building.2").foregroundStyle(theme.accent).frame(width: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.name).fontWeight(.medium)
                                Text(link.position.isEmpty ? "kontakt" : link.position).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if link.primary { pill("Główny kontakt", theme.accent) }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Button { confirm = .unlink(relationId: link.relationId, name: link.name, organization: true) } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń powiązanie z organizacją")
                }
                .padding(10)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    // MARK: Notatki
    private func notesTab(_ card: ContactCard) -> some View {
        let notes = card.notes ?? []
        let draft = noteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        return panel("Szybkie notatki") {
            HStack {
                TextField("Dodaj szybką notatkę…", text: $noteDraft).textFieldStyle(.roundedBorder).onSubmit { addNote() }
                Button { addNote() } label: { Label("Dodaj", systemImage: "plus") }.disabled(draft.isEmpty)
            }
            if notes.isEmpty { Text("Brak notatek").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12) }
            ForEach(notes) { note in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(note.note).textSelection(.enabled)
                        Text([ContactCardText.stamp(note.createdAt), note.author].filter { !$0.isEmpty }.joined(separator: " • "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if note.own || card.access.isAdmin {
                        Button { confirm = .removeNote(note) } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń notatkę")
                    }
                }
                .padding(10)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func addNote() {
        let note = noteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !note.isEmpty else { return }
        Task {
            let body: [String: JSONValue] = ["action": .string("add"), "organizationId": .string(ref.id), "note": .string(note)]
            if await store.run("Dodawanie notatki…", "note", body, reload: ref) != nil { noteDraft = "" }
        }
    }

    // MARK: Faktury i realizacje
    private func invoicesTab(_ card: ContactCard) -> some View {
        let invoices = card.invoices ?? []
        let gross = invoices.reduce(0) { $0 + $1.gross }
        let net = invoices.reduce(0) { $0 + $1.net }
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                tile("Liczba faktur", "\(invoices.count)")
                tile("Wartość brutto", ContactCardText.money(gross))
                tile("Wartość netto", ContactCardText.money(net))
            }
            panel("Faktury") {
                if invoices.isEmpty { Text("Brak faktur").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12) }
                ForEach(invoices) { invoice in
                    Button { state.showInvoice(invoice.id) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 8) {
                                    Text(invoice.number.isEmpty ? "Faktura" : invoice.number).fontWeight(.medium)
                                    pill(ContactCardText.invoiceStatus(invoice.status), invoiceColor(invoice.status))
                                }
                                Text("Data wystawienia: \(ContactCardText.day(invoice.issueDate))").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(ContactCardText.money(invoice.gross)).fontWeight(.semibold).foregroundStyle(theme.accent)
                                Text("Netto: \(ContactCardText.money(invoice.net))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(10)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Otwórz fakturę w Finansach")
                }
            }
        }
    }

    private func invoiceColor(_ status: String) -> Color {
        switch status {
        case "paid": return CrmTheme.rgb(0x4ade80)
        case "issued": return CrmTheme.rgb(0x60a5fa)
        case "draft": return .secondary
        default: return CrmTheme.rgb(0xf87171)
        }
    }

    private func eventsTab(_ card: ContactCard) -> some View {
        let events = card.events ?? []
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                tile("Liczba realizacji", "\(events.count)")
                tile("Zakończonych", "\(events.filter { $0.status == "completed" }.count)")
            }
            panel("Realizacje") {
                if events.isEmpty { Text("Brak realizacji").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12) }
                ForEach(events) { event in
                    Button { state.showEvent(event.id) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.name).fontWeight(.medium)
                                Text("Data wydarzenia: \(ContactCardText.day(event.date))").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            pill(EventDetailsActionCard.statusLabel(event.status), theme.accent)
                        }
                        .padding(10)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Otwórz wydarzenie")
                }
            }
        }
    }

    // MARK: Sprzedaż sprzedawcy
    private var canViewFinances: Bool { state.employee?.has("finances_view") == true || state.employee?.has("finances_manage") == true }

    @ViewBuilder private var sellerTab: some View {
        panel("Sprzedaż sprzedawcy") {
            if let entry {
                HStack(spacing: 8) {
                    pill(entry.sellerLabel, entry.sellerColor)
                    Text(entry.sellerHelp).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Text("Gotowość do pracy, oferty na osi, realizacje, prowizje i narzuty tej osoby są na jej karcie w sekcji Sprzedawcy.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button { state.showSeller(contactID: ref.id) } label: { Label("Otwórz kartę sprzedawcy", systemImage: "person.crop.rectangle") }
                    .buttonStyle(.borderedProminent)
                Button { openSellerChat() } label: { Label("Rozmowa", systemImage: "bubble.left.and.bubble.right") }
                if canViewFinances {
                    Button("Rozliczenia prowizji — w CRM") { state.openCRM("/crm/contacts/\(ref.id)?tab=seller&section=settlements") }
                }
            }
        }
    }

    // MARK: Relacja i segmentacja
    @ViewBuilder private func relationTab(_ card: ContactCard) -> some View {
        responsibilityPanel(card)
        if !isOrganization { duplicatesPanel(card) }
        segmentationPanel(card)
        if isOrganization, let organization = card.organization { domainsPanel(organization) }
        inquiriesPanel
        if state.employee?.has("offers_brochures_view_own") == true || state.employee?.has("offers_brochures_view_all") == true {
            panel("Broszury") {
                ContactBrochureActions(context: BrochureRecipientContext(type: isOrganization ? "organization" : "contact", id: ref.id, name: title)).id(ref.id)
            }
        }
    }

    private func responsibilityPanel(_ card: ContactCard) -> some View {
        let me = card.access.me
        let saved = savedOwner
        let isOwner = !me.isEmpty && saved == me
        let canChoose = card.access.isAdmin || isOwner || saved.isEmpty
        let options = card.access.isAdmin || isOwner ? card.owners : card.owners.filter { $0.id == me }
        let missing = !ownerID.isEmpty && !options.contains(where: { $0.id == ownerID })
        let hint: String = card.access.isAdmin ? "Jako administrator możesz przypisać klienta dowolnej osobie."
            : isOwner ? "Jesteś opiekunem — możesz przekazać klienta innej osobie albo go zwolnić."
            : saved.isEmpty ? "Klient nie ma opiekuna — możesz przypisać go sobie. Innej osobie przypisuje administrator."
            : "Opiekunem jest \(card.ownerName.isEmpty ? "inna osoba" : card.ownerName). Zmienić przypisanie może tylko ta osoba albo administrator."
        let changed = ownerID != saved || lifecycle != savedLifecycle
        return panel("Odpowiedzialność za klienta") {
            Picker("Opiekun", selection: $ownerID) {
                Text("Brak opiekuna").tag("")
                if missing { Text(ownerID == saved ? (card.ownerName.isEmpty ? "Obecny opiekun" : card.ownerName) : "Obecny opiekun").tag(ownerID) }
                ForEach(options) { Text($0.name).tag($0.id) }
            }
            .disabled(!canChoose)
            Text(hint).font(.caption).foregroundStyle(.secondary)
            Picker("Etap relacji", selection: $lifecycle) {
                ForEach(ContactCardText.lifecycle) { Text($0.label).tag($0.value) }
                if !ContactCardText.lifecycle.contains(where: { $0.value == lifecycle }) { Text(lifecycle).tag(lifecycle) }
            }
            .disabled(!card.access.canManage)
            if !card.access.canManage { Text("Etap relacji zmienia osoba zarządzająca kontaktami.").font(.caption).foregroundStyle(.secondary) }
            HStack {
                Spacer()
                Button("Zapisz odpowiedzialność") { saveOwnership() }.buttonStyle(.borderedProminent).disabled(!changed)
            }
        }
    }

    private func saveOwnership() {
        let body: [String: JSONValue] = ["kind": .string(ref.kind.apiKind), "id": .string(ref.id), "ownerId": .string(ownerID), "lifecycle": .string(lifecycle)]
        Task {
            if await store.run("Zapisywanie…", "ownership", body, reload: ref) == nil { prepare() }
        }
    }

    @ViewBuilder private func duplicatesPanel(_ card: ContactCard) -> some View {
        let duplicates = store.duplicates(of: ref.id)
        if !duplicates.isEmpty {
            panel("Możliwy duplikat kontaktu") {
                Text(card.access.isAdmin ? "Nie łączymy danych automatycznie. Porównaj rekordy przed scaleniem." : "Nie łączymy danych automatycznie. Administrator może porównać i scalić rekordy.")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(duplicates) { duplicate in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(duplicate.entry.name).fontWeight(.medium)
                            Text(duplicate.reason).font(.caption).foregroundStyle(.orange)
                        }
                        Spacer()
                        Button("Otwórz") { store.open(duplicate.entry.id, kind: duplicate.entry.contactKind) }.controlSize(.small)
                        if card.access.isAdmin {
                            Button("Porównaj i scal…") { sheet = .merge(duplicate.entry) }.controlSize(.small)
                        }
                    }
                    .padding(8)
                    .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }

    private func segmentationPanel(_ card: ContactCard) -> some View {
        panel("Segmentacja i komunikacja") {
            if let marketing = card.marketing {
                let profile = marketing.profile
                let email = card.organization?.email ?? card.contact?.email ?? ""
                let eligible = !email.isEmpty && profile.marketingStatus == "subscribed" && profile.legalBasis != "none"
                    && profile.deliverability != "bounced" && profile.deliverability != "invalid"
                HStack {
                    pill(eligible ? "Mailing dozwolony" : "Mailing niedozwolony", eligible ? CrmTheme.rgb(0x4ade80) : .secondary)
                    Spacer()
                    if marketing.canEdit {
                        Button { sheet = .segmentation } label: { Label("Edytuj segmentację…", systemImage: "slider.horizontal.3") }.controlSize(.small)
                    }
                }
                let chosen = marketing.segments.filter { marketing.selected.contains($0.id) }
                field("Segmenty", chosen.map(\.name).joined(separator: ", "))
                fieldGrid {
                    field("Status komunikacji", ContactDictionaries.label(profile.marketingStatus, in: ContactCardText.marketingStatus))
                    field("Podstawa prawna", ContactDictionaries.label(profile.legalBasis, in: ContactCardText.legalBasis))
                    field("Dostarczalność e-maila", ContactDictionaries.label(profile.deliverability, in: ContactCardText.deliverability))
                    field("Częstotliwość", ContactDictionaries.label(profile.frequency, in: ContactCardText.frequency))
                    field("Zainteresowania", profile.interests.joined(separator: ", "))
                    field("Typy wydarzeń", profile.eventTypes.joined(separator: ", "))
                    field("Regiony", profile.regions.joined(separator: ", "))
                    field("Budżet", budget(profile))
                }
                if email.isEmpty { Text("Brak adresu e-mail — klient nie trafi na listę odbiorców.").font(.caption).foregroundStyle(.orange) }
            } else {
                Text("Segmentacja nie jest dostępna w Twoim zakresie uprawnień.").foregroundStyle(.secondary)
            }
        }
    }

    private func budget(_ profile: ContactMarketingProfile) -> String {
        let from = profile.budgetMin.map { "od \(ContactCardText.money($0))" }
        let to = profile.budgetMax.map { "do \(ContactCardText.money($0))" }
        return [from, to].compactMap { $0 }.joined(separator: " ")
    }

    private func domainsPanel(_ organization: ContactCardOrganization) -> some View {
        panel("Domeny organizacji") {
            Text("Uwzględnij również swoje wiadomości do i od osób spoza listy kontaktów, korzystających z tych domen.").font(.caption).foregroundStyle(.secondary)
            TextField("Domeny e-mail", text: $domains, prompt: Text("firma.pl lub https://www.firma.pl/")).textFieldStyle(.roundedBorder)
            Text("Możesz wkleić adres strony — zapiszemy samą domenę. Kolejne adresy oddziel przecinkiem. Dopasowanie domeny nie udostępnia poczty innych sprzedawców.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Zapisz domeny") {
                    let body: [String: JSONValue] = ["organizationId": .string(ref.id), "domains": .string(domains)]
                    Task { await store.run("Zapisywanie domen…", "domains", body, reload: ref) }
                }
                .disabled(domains == savedDomains)
            }
        }
    }

    @ViewBuilder private var inquiriesPanel: some View {
        let related = state.inquiries.inquiries.filter { $0.contactId == ref.id || $0.organizationId == ref.id }
        if state.employee?.canView(.inquiries) == true && !related.isEmpty {
            panel("Zapytania (\(related.count))") {
                ForEach(related.prefix(20)) { inquiry in
                    Button { state.showInquiry(inquiry.id) } label: {
                        HStack(spacing: 8) {
                            Circle().fill(inquiry.inquiryStage.color).frame(width: 7, height: 7)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(inquiry.titleLabel).lineLimit(1)
                                Text("\(inquiry.inquiryStage.label) · \(ContactFormat.date(inquiry.created))").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let value = inquiry.estimatedValue { Text(InquiryFormat.money(value)).font(.caption).monospacedDigit().foregroundStyle(.secondary) }
                        }
                        .padding(.vertical, 5).padding(.horizontal, 8)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Otwórz zapytanie w lejku")
                }
            }
        }
    }

    // MARK: Arkusze i potwierdzenia
    @ViewBuilder private func sheetContent(_ item: ContactCardSheet) -> some View {
        switch item {
        case .edit:
            ContactEditorHost(store: store, mode: .edit(ref))
        case .linkPerson:
            LinkPersonSheet(store: store, organizationID: ref.id, linked: Set((card?.persons ?? []).map(\.id)))
        case .linkOrganization:
            LinkOrganizationSheet(store: store, contactID: ref.id, linked: Set((card?.organizations ?? []).map(\.id)), position: card?.contact?.position ?? "")
        case .decisionMaker:
            DecisionMakerSheet(store: store, ref: ref, persons: card?.persons ?? [], assigned: Set((card?.decisionMakers ?? []).map(\.contactId)))
        case .segmentation:
            if let marketing = card?.marketing {
                SegmentationSheet(store: store, ref: ref, marketing: marketing, email: card?.organization?.email ?? card?.contact?.email ?? "")
            }
        case .merge(let source):
            MergeContactSheet(store: store, ref: ref, targetName: title, source: source)
        case .newInquiry(let client):
            NewInquirySheet(initialClient: client) { created in
                created.announce(state)
                Task {
                    await state.inquiries.sync(force: true)
                    state.showInquiry(created.id)
                }
            }
        }
    }

    private func perform(_ item: ContactCardConfirm) {
        switch item {
        case .unlink(let relationId, _, _):
            Task { await store.run("Usuwanie powiązania…", "unlink", ["relationId": .string(relationId)], reload: ref) }
        case .removeMaker(let maker):
            Task { await store.run("Usuwanie…", "decisionMaker", ["action": .string("remove"), "id": .string(maker.id)], reload: ref) }
        case .removeNote(let note):
            Task { await store.run("Usuwanie notatki…", "note", ["action": .string("delete"), "id": .string(note.id)], reload: ref) }
        }
    }

    // MARK: Branding ofert (`CrmOfferBrandingPanel`) i sale hotelu (`OrganizationHotelSpaces`)

    /// Hotel — zamiast bazy hotelu odnośnik do „Sale i przestrzenie”; odnośniki podglądu prowadzą do zakładek tej karty.
    private func brandingTab(_ card: ContactCard) -> some View {
        let openVenue: (() -> Void)? = card.organization?.businessType == "hotel" ? { tab = .venue } : nil
        return OfferBrandingPanel(partnerID: nil, organizationID: ref.id, onOpenVenue: openVenue,
                                  openOrganization: { _, target in tab = target == .contacts ? .persons : .details })
            .id(ref.id)
    }

    /// „Pokaż portal hotelowi” w menu: organizacja-klient albo osoba kontaktowa (jak w CRM).
    private var canShowDemo: Bool {
        if isOrganization { return card?.organization?.organizationType == "client" }
        return card?.contact.map { !$0.isIndividual } ?? false
    }

    /// Jak `canManageSalespeople` na karcie organizacji w CRM.
    private var canManageSalespeople: Bool {
        guard let employee = state.employee else { return false }
        return employee.has("contacts_manage") || employee.has("finances_manage")
    }

    @ViewBuilder private func hotelSpacesTab(_ card: ContactCard, _ org: ContactCardOrganization) -> some View {
        let canEditLocation = state.employee?.has("locations_manage") == true
        let canChangeLink = state.employee?.has("contacts_manage") == true
        panel("Sale i przestrzenie hotelu") {
            Text("Jedna wspólna baza: sale, wymiary, zasilanie, rzuty i zdjęcia zapisujemy w lokalizacji. Edycja tutaj zmienia te same dane co karta lokalizacji. Sprzedawcy korzystają z podglądu i wybierają przestrzeń do oferty. Zapisane wcześniej ustalenia ofert zachowują swoją wersję danych.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let location = card.location {
                HStack(alignment: .top) {
                    Image(systemName: "mappin.and.ellipse").foregroundStyle(theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(location.name).fontWeight(.medium).textSelection(.enabled)
                        if !location.address.isEmpty { Text(location.address).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    }
                    Spacer()
                    Button("Otwórz lokalizację") { state.showLocation(location.id) }.controlSize(.small)
                }
            } else if org.locationId.isEmpty {
                Label("Ten hotel wymaga powiązania z lokalizacją. Wybierz istniejący obiekt albo utwórz nowy — nie dodajemy drugiej listy sal w organizacji.", systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            } else if card.locationMissing == true {
                Label("Powiązana lokalizacja jest niedostępna. Sprawdź uprawnienia do lokalizacji.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
            }
            if canChangeLink {
                // Jak w CRM: powiązanie zmienia się w edycji organizacji (pole „Lokalizacja”).
                Button(org.locationId.isEmpty ? "Powiąż lokalizację hotelu" : "Zmień powiązaną lokalizację") { tab = .details; sheet = .edit }
                    .controlSize(.small)
            }
        }
        if !org.locationId.isEmpty {
            if !canEditLocation {
                Text("Podgląd danych. Do edycji sal i materiałów wymagane są uprawnienia do zarządzania lokalizacjami.").font(.callout).foregroundStyle(.secondary)
            }
            LocationSpacesPanel(store: state.locations, locationID: org.locationId, readOnly: !canEditLocation).id(org.locationId)
        }
    }

    // MARK: Elementy
    private func panel<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        panelBody(title, accessory: EmptyView(), content: content())
    }
    private func panel<Accessory: View, Content: View>(_ title: String, accessory: Accessory, @ViewBuilder content: () -> Content) -> some View {
        panelBody(title, accessory: accessory, content: content())
    }
    private func panelBody<Accessory: View, Content: View>(_ title: String, accessory: Accessory, content: Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title.uppercased()).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                accessory
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }
    private func fieldGrid<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 16, alignment: .topLeading)], alignment: .leading, spacing: 12) {
            content()
        }
    }
    private func field(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.isEmpty ? "—" : value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private func subheading(_ text: String, symbol: String) -> some View {
        Label(text, systemImage: symbol).font(.callout.weight(.semibold)).padding(.top, 4)
    }
    private func tile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold)).foregroundStyle(theme.accent).monospacedDigit()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
    }
}
