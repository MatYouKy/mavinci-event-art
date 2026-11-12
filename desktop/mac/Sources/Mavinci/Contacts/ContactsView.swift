import SwiftUI
import AppKit

// MARK: Kontakty — 1:1 ze stroną `/crm/contacts`: typy (organizacje, kontakty, osoby prywatne), „Tylko sprzedawcy”, wyszukiwanie,
// kafelki i lista, szczegóły w panelu bocznym (dane, powiązania, zapytania), edycja, usuwanie, e-mail i spotkanie z karty.

/// Czynności karty, listy i szczegółów.
struct ContactActions {
    let open: (ContactEntry) -> Void
    let edit: (ContactEntry) -> Void
    let remove: (ContactEntry) -> Void
    let call: (ContactEntry) -> Void
    let email: (ContactEntry) -> Void
    let meeting: (ContactEntry) -> Void
    let browser: (ContactEntry) -> Void
}

@MainActor struct ContactsView: View {
    @ObservedObject var store: ContactsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("contacts.mode") private var mode: ContactViewMode = .grid
    @State private var type: ContactTypeFilter = .all
    @State private var sellersOnly = false
    @State private var search = ""
    @State private var selectedID: String?
    @State private var inspectorShown = false
    @State private var editing: ContactEntry?
    @State private var deleting: ContactEntry?
    @State private var composing: ComposeDraft?
    @State private var meeting: MeetingEditorRequest?

    private var visible: [ContactEntry] {
        store.contacts.filter { entry in
            if sellersOnly && !entry.seller { return false }
            return type.matches(entry) && entry.matches(search)
        }
    }
    private func count(_ filter: ContactTypeFilter) -> Int {
        store.contacts.filter { filter.matches($0) && (!sellersOnly || $0.seller) }.count
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
            if !visible.isEmpty {
                Text("Wyświetlono \(ContactFormat.count(visible.count))").font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 6)
            }
        }
        .navigationTitle("Kontakty")
        .navigationSubtitle("Wszystkie kontakty")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj po nazwie, e-mailu lub telefonie")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if store.access?.canCreate == true {
                    Button { state.openCRM("/crm/contacts/new") } label: { Label("Nowy kontakt", systemImage: "plus") }
                        .help("Nowy kontakt (formularz CRM w przeglądarce — wyszukiwanie w GUS i CEIDG)")
                }
                Button { openSubcontractors() } label: { Label("Podwykonawcy", systemImage: "wrench.and.screwdriver") }
                    .help("Podwykonawcy")
                Button { inspectorShown.toggle() } label: { Label("Szczegóły", systemImage: "sidebar.trailing") }
                    .help("Pokaż lub ukryj szczegóły kontaktu")
            }
        }
        .inspector(isPresented: $inspectorShown) {
            ContactInspector(entry: store.entry(selectedID), store: store, inquiries: state.inquiries, actions: actions, select: select)
                .inspectorColumnWidth(min: 300, ideal: 360, max: 500)
                .background(theme.page)
        }
        .sheet(item: $editing) { entry in
            ContactEditorSheet(store: store, entry: entry)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $composing) { draft in
            ComposeSheet(store: state.messages, draft: draft)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $meeting) { request in
            MeetingEditorSheet(store: state.meetings, request: request)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog(deleting?.isOrganization == true ? "Usuń organizację" : "Usuń kontakt",
                            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let target = deleting {
                Button("Usuń", role: .destructive) {
                    Task { if await store.delete(target) { if selectedID == target.id { selectedID = nil } } }
                }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Czy na pewno chcesz usunąć \(deleting?.isOrganization == true ? "tę organizację" : "ten kontakt") „\(deleting?.name ?? "")”? Tej operacji nie można cofnąć.")
        }
        .task(id: state.employee?.id) {
            if store.contacts.isEmpty { await store.backgroundSync() }
            // Zmiany z przeglądarki i od innych osób co 60 s (tylko zmienione koszyki).
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
        .onAppear { reveal() }
        .onChange(of: store.focusID) { _, _ in reveal() }
        .onChange(of: store.lastSync) { _, _ in reveal() }
        .onChange(of: selectedID) { _, id in if id != nil { inspectorShown = true } }
    }

    // MARK: Zwarty nagłówek
    private var header: some View {
        HStack(spacing: 10) {
            Picker("Typ", selection: $type) {
                ForEach(ContactTypeFilter.allCases) { Text("\($0.label) \(count($0))").tag($0) }
            }.pickerStyle(.segmented).labelsHidden().fixedSize()
            Toggle(isOn: $sellersOnly) {
                Label("Tylko sprzedawcy \(store.contacts.filter(\.seller).count)", systemImage: "percent")
            }
            .toggleStyle(.button)
            .help("Kontakty z profilem sprzedawcy i organizacje, w których pracują")
            Spacer(minLength: 8)
            if store.syncing { ProgressView().controlSize(.small).help("Synchronizacja kontaktów") }
            Picker("Widok", selection: $mode) {
                ForEach(ContactViewMode.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
            }.pickerStyle(.segmented).labelsHidden().fixedSize()
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
    }

    @ViewBuilder private var content: some View {
        if store.contacts.isEmpty && !store.loaded {
            if let error = store.loadError {
                ContentUnavailableView {
                    Label("Kontakty", systemImage: "person.crop.rectangle.stack")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.sync(force: true) } }
                }
            } else {
                ProgressView("Ładowanie kontaktów…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if visible.isEmpty {
            ContentUnavailableView(search.isEmpty ? "Brak kontaktów" : "Nie znaleziono kontaktów", systemImage: "person.crop.rectangle.stack",
                                   description: Text(search.isEmpty ? "Zmień filtr typu lub wyłącz „Tylko sprzedawcy”." : "Zmień wyszukiwaną frazę."))
        } else if mode == .grid {
            grid
        } else {
            ContactListTable(contacts: visible, store: store, selectedID: $selectedID, actions: actions)
        }
    }

    private var grid: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220, maximum: 340), spacing: 12)], spacing: 12) {
                    ForEach(visible) { entry in
                        ContactCardView(entry: entry, selected: selectedID == entry.id, canManage: store.canManage, actions: actions).id(entry.id)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 6)
            }
            .onChange(of: selectedID) { _, id in
                if let id { withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) } }
            }
        }
    }

    private var actions: ContactActions {
        ContactActions(
            open: { selectedID = $0.id; inspectorShown = true },
            edit: { editing = $0 },
            remove: { deleting = $0 },
            call: { entry in openURL("tel", entry.callPhone) },
            email: { entry in compose(entry) },
            meeting: { entry in meeting = meetingRequest(entry) },
            browser: { state.openCRM("/crm/contacts/\($0.id)") }
        )
    }

    /// Powiązany kontakt lub organizacja: zaznacz na liście (mimo filtrów), a spoza listy — karta w CRM.
    private func select(_ id: String) {
        guard let entry = store.entry(id) else { state.openCRM("/crm/contacts/\(id)"); return }
        if !visible.contains(where: { $0.id == id }) { type = .all; sellersOnly = false; search = "" }
        selectedID = entry.id
    }

    /// Kontakt wskazany z innej sekcji: pokaż go mimo filtrów i otwórz szczegóły.
    private func reveal() {
        guard let id = store.focusID, store.entry(id) != nil else { return }
        store.focusID = nil
        select(id)
        inspectorShown = true
    }

    private func openSubcontractors() {
        if state.navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/subcontractors" }) { state.openHref("/crm/subcontractors") }
        else { state.openCRM("/crm/subcontractors") }
    }

    /// „Napisz e-mail” jak na karcie kontaktu w CRM: skrzynka firmowa, temat i powitanie; bez skrzynki — program pocztowy.
    private func compose(_ entry: ContactEntry) {
        guard !entry.email.isEmpty else { return }
        Task {
            if state.messages.info == nil { await state.messages.loadInfo() }
            var draft = state.messages.newDraft()
            guard !draft.accountId.isEmpty else { openURL("mailto", entry.email); return }
            draft.to = entry.email
            draft.subject = "Wiadomość od Mavinci dla \(entry.name)"
            draft.text = "Dzień dobry\(entry.greetingName.isEmpty ? "" : " \(entry.greetingName)"),\n\n"
            composing = draft
        }
    }

    /// Nowe spotkanie z kontaktem jako uczestnikiem (dla organizacji — z osobą główną, jeśli jest).
    private func meetingRequest(_ entry: ContactEntry) -> MeetingEditorRequest {
        if entry.isOrganization {
            let person = entry.links.first(where: \.primary) ?? entry.links.first
            return MeetingEditorRequest(contactId: person?.id, contactName: person?.name, title: "Spotkanie — \(entry.name)")
        }
        return MeetingEditorRequest(contactId: entry.id, contactName: entry.name, title: "Spotkanie — \(entry.name)")
    }

    private func openURL(_ scheme: String, _ value: String) {
        guard !value.isEmpty else { return }
        var parts = URLComponents(); parts.scheme = scheme; parts.path = scheme == "tel" ? value.replacingOccurrences(of: " ", with: "") : value
        if let url = parts.url { NSWorkspace.shared.open(url) }
    }
}

// MARK: Karta (kafelek)

@MainActor struct ContactCardView: View {
    let entry: ContactEntry
    let selected: Bool
    let canManage: Bool
    let actions: ContactActions
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(spacing: 6) {
                ContactAvatarView(entry: entry, size: 60)
                Text(entry.name).font(.callout.weight(.semibold)).multilineTextAlignment(.center).lineLimit(2)
                ContactBadges(entry: entry)
            }
            .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 4) {
                if !entry.email.isEmpty { Label(entry.email, systemImage: "envelope").lineLimit(1).truncationMode(.middle) }
                if !entry.listPhone.isEmpty { Label(entry.listPhone, systemImage: "phone").lineLimit(1) }
                if !entry.city.isEmpty { Label(entry.city, systemImage: "mappin.and.ellipse").lineLimit(1) }
                if let rating = entry.rating, rating > 0 { ContactStars(rating: rating) }
                if !entry.tags.isEmpty { Label(entry.tags.joined(separator: ", "), systemImage: "tag").lineLimit(1).font(.caption2) }
            }
            .font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            HStack {
                Text(ContactFormat.date(entry.created))
                Spacer()
                if entry.isOrganization {
                    Label("\(entry.relatedCount)", systemImage: "person.2").help("Osoby kontaktowe")
                } else if !entry.isIndividual && entry.relatedCount > 0 {
                    Label("\(entry.relatedCount)", systemImage: "building.2").help("Organizacje")
                }
            }
            .font(.caption2).foregroundStyle(.tertiary)
            .padding(.top, 4)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .top)
        .background(selected ? theme.accent.opacity(0.14) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .leading) { if selected { RoundedRectangle(cornerRadius: 2).fill(theme.accent).frame(width: 3).padding(.vertical, 8) } }
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { actions.open(entry) }
        .contextMenu { ContactMenuItems(entry: entry, canManage: canManage, actions: actions) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(entry.name), \(entry.contactKind.label)")
    }
}

/// Zdjęcie kontaktu albo ikona typu (jak na stronie).
@MainActor struct ContactAvatarView: View {
    let entry: ContactEntry
    let size: CGFloat
    @Environment(\.crmTheme) private var theme
    @State private var image: NSImage?

    init(entry: ContactEntry, size: CGFloat) {
        self.entry = entry; self.size = size
        _image = State(initialValue: AvatarCache.shared.cached(entry.avatarUrl))
    }

    var body: some View {
        ZStack {
            Circle().fill(theme.accent.opacity(0.10))
            if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fill).frame(width: size, height: size)
            } else {
                Image(systemName: entry.contactKind.symbol).font(.system(size: size * 0.42)).foregroundStyle(theme.accent)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .task(id: entry.avatarUrl) {
            guard let url = entry.avatarUrl, !url.isEmpty else { image = nil; return }
            image = await AvatarCache.shared.image(for: url) ?? image
        }
    }
}

/// Typ (Organizacja / Kontakt / Osoba prywatna) i oznaczenie sprzedawcy.
struct ContactBadges: View {
    let entry: ContactEntry
    var body: some View {
        HStack(spacing: 4) {
            if entry.seller {
                pill(entry.sellerLabel, entry.sellerColor, symbol: entry.isOrganization ? "building.2" : "percent").help(entry.sellerHelp)
            }
            pill(entry.contactKind.label, entry.contactKind.color, symbol: nil)
        }
    }
    private func pill(_ text: String, _ color: Color, symbol: String?) -> some View {
        HStack(spacing: 3) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(text)
        }
        .font(.caption2.weight(.medium)).lineLimit(1).padding(.horizontal, 7).padding(.vertical, 2)
        .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
}

struct ContactStars: View {
    let rating: Int
    var body: some View {
        HStack(spacing: 1) {
            ForEach(0..<5, id: \.self) { i in Image(systemName: i < rating ? "star.fill" : "star") }
        }
        .font(.system(size: 9)).foregroundStyle(CrmTheme.rgb(0xd3bb73))
        .accessibilityLabel("Ocena \(rating) na 5")
    }
}

@MainActor struct ContactMenuItems: View {
    let entry: ContactEntry
    let canManage: Bool
    let actions: ContactActions
    var body: some View {
        Button("Pokaż szczegóły", systemImage: "info.circle") { actions.open(entry) }
        Button("Pełna karta w CRM", systemImage: "safari") { actions.browser(entry) }
        Divider()
        Button("Zadzwoń", systemImage: "phone") { actions.call(entry) }.disabled(entry.callPhone.isEmpty)
        Button("Napisz e-mail", systemImage: "envelope") { actions.email(entry) }.disabled(entry.email.isEmpty)
        Button("Nowe spotkanie", systemImage: "calendar.badge.plus") { actions.meeting(entry) }
        if canManage {
            Divider()
            Button("Edytuj…", systemImage: "pencil") { actions.edit(entry) }
            Button("Usuń…", systemImage: "trash", role: .destructive) { actions.remove(entry) }
        }
    }
}

// MARK: Lista

@MainActor struct ContactListTable: View {
    let contacts: [ContactEntry]
    @ObservedObject var store: ContactsStore
    @Binding var selectedID: String?
    let actions: ContactActions
    var body: some View {
        Table(contacts, selection: $selectedID) {
            TableColumn("Nazwa") { (entry: ContactEntry) in
                HStack(spacing: 8) {
                    ContactAvatarView(entry: entry, size: 26)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(entry.name).fontWeight(.medium).lineLimit(1)
                        if entry.seller { Text(entry.sellerLabel).font(.caption2).foregroundStyle(entry.sellerColor).lineLimit(1).help(entry.sellerHelp) }
                    }
                }
            }.width(min: 200, ideal: 280)
            TableColumn("Typ") { (entry: ContactEntry) in
                Text(entry.contactKind.label).font(.caption.weight(.medium)).foregroundStyle(entry.contactKind.color)
            }.width(min: 90, ideal: 110)
            TableColumn("E-mail") { (entry: ContactEntry) in Text(entry.email).lineLimit(1).truncationMode(.middle) }.width(min: 140, ideal: 220)
            TableColumn("Telefon") { (entry: ContactEntry) in Text(entry.listPhone).monospacedDigit().lineLimit(1) }.width(min: 100, ideal: 130)
            TableColumn("Miasto") { (entry: ContactEntry) in Text(entry.city).lineLimit(1) }.width(min: 80, ideal: 120)
            TableColumn("Tagi") { (entry: ContactEntry) in
                Text(entry.tags.first.map { entry.tags.count > 1 ? "\($0) +\(entry.tags.count - 1)" : $0 } ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }.width(min: 60, ideal: 110)
            TableColumn("Ocena") { (entry: ContactEntry) in
                if let rating = entry.rating, rating > 0 { ContactStars(rating: rating) } else { Text("") }
            }.width(min: 60, ideal: 70)
            TableColumn("Dodano") { (entry: ContactEntry) in
                Text(ContactFormat.date(entry.created)).monospacedDigit().foregroundStyle(.secondary)
            }.width(min: 80, ideal: 90)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let entry = store.entry(id) { ContactMenuItems(entry: entry, canManage: store.canManage, actions: actions) }
        } primaryAction: { ids in
            if let id = ids.first, let entry = store.entry(id) { actions.open(entry) }
        }
    }
}

// MARK: Szczegóły (inspektor)

@MainActor struct ContactInspector: View {
    let entry: ContactEntry?
    @ObservedObject var store: ContactsStore
    @ObservedObject var inquiries: InquiriesStore
    let actions: ContactActions
    let select: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    var body: some View {
        if let entry {
            ScrollView { details(entry).padding(18).frame(maxWidth: .infinity, alignment: .leading) }
        } else {
            ContentUnavailableView("Wybierz kontakt", systemImage: "person.crop.rectangle.stack", description: Text("Kliknij kafelek lub wiersz listy."))
        }
    }

    private func details(_ entry: ContactEntry) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(entry)
            quickActions(entry)
            contactData(entry)
            kindData(entry)
            if !entry.links.isEmpty {
                group(entry.isOrganization ? "Osoby kontaktowe" : "Organizacje") {
                    ForEach(entry.links, id: \.relationId) { link in linkRow(link, organization: !entry.isOrganization) }
                }
            }
            relatedInquiries(entry)
            if !entry.tags.isEmpty { group("Tagi") { Text(entry.tags.joined(separator: ", ")).textSelection(.enabled) } }
            if !entry.notes.isEmpty { group("Notatki") { Text(entry.notes).textSelection(.enabled) } }
            field("Dodano", ContactFormat.date(entry.created))
            footer(entry)
        }
    }

    private func heading(_ entry: ContactEntry) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ContactAvatarView(entry: entry, size: 56)
            VStack(alignment: .leading, spacing: 5) {
                Text(entry.name).font(.title3.weight(.semibold)).textSelection(.enabled)
                if entry.isOrganization && !entry.legalName.isEmpty && entry.legalName != entry.name {
                    Text(entry.legalName).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
                ContactBadges(entry: entry)
                if let rating = entry.rating, rating > 0 { ContactStars(rating: rating) }
            }
        }
    }

    private func quickActions(_ entry: ContactEntry) -> some View {
        HStack(spacing: 6) {
            Button { actions.call(entry) } label: { Label("Zadzwoń", systemImage: "phone") }
                .buttonStyle(.borderedProminent).disabled(entry.callPhone.isEmpty)
            Button { actions.email(entry) } label: { Label("Napisz e-mail", systemImage: "envelope") }.disabled(entry.email.isEmpty)
            Button { actions.meeting(entry) } label: { Label("Spotkanie", systemImage: "calendar.badge.plus") }
                .help("Nowe spotkanie z tym kontaktem")
        }.controlSize(.small)
    }

    @ViewBuilder private func phones(_ entry: ContactEntry) -> some View {
        switch entry.contactKind {
        case .organization:
            field("Telefon", entry.phone)
        case .contact:
            field("Telefon komórkowy", entry.mobile)
            field("Telefon prywatny", entry.phone)
            field("Telefon firmowy", entry.businessPhone)
        case .individual:
            field("Telefon główny", entry.phone)
            field("Numer alternatywny", entry.mobile)
            field("Osoba alternatywna", entry.alternativeContact)
        }
    }

    private func contactData(_ entry: ContactEntry) -> some View {
        group("Dane kontaktowe") {
            field("E-mail", entry.email)
            phones(entry)
            if !entry.website.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Strona WWW").font(.caption).foregroundStyle(.secondary)
                    Button(entry.website) { openWebsite(entry.website) }.buttonStyle(.link).linkCursor()
                }
            }
            if !entry.fullAddress.isEmpty {
                HStack(alignment: .bottom) {
                    field("Adres", entry.fullAddress)
                    Spacer()
                    Button("Mapa", systemImage: "map") { openMap(entry) }.controlSize(.small).help("Pokaż adres na mapie")
                }
            }
        }
    }

    @ViewBuilder private func kindData(_ entry: ContactEntry) -> some View {
        switch entry.contactKind {
        case .organization:
            group("Dane firmy") {
                field("Pełna nazwa", entry.legalName != entry.name ? entry.legalName : "")
                field("NIP", entry.nip)
                field("REGON", entry.regon)
                field("KRS", entry.krs)
                field("Forma prawna", ContactDictionaries.label(entry.legalForm, in: ContactDictionaries.legalForms))
                field("Profil działalności", ContactDictionaries.label(entry.businessType, in: ContactDictionaries.businessTypes))
                field("Status", ContactDictionaries.label(entry.status, in: ContactDictionaries.organizationStatuses))
            }
        case .contact:
            if !entry.position.isEmpty || !entry.nip.isEmpty || !entry.companyName.isEmpty {
                group("Praca") {
                    field("Stanowisko", entry.position)
                    field("Firma", entry.companyName)
                    field("NIP", entry.nip)
                }
            }
        case .individual:
            if !entry.eventType.isEmpty || !entry.eventDetails.isEmpty {
                group("Uroczystość") {
                    field("Rodzaj uroczystości", ContactDictionaries.label(entry.eventType, in: ContactDictionaries.eventTypes))
                    field("Szczegóły uroczystości", entry.eventDetails)
                }
            }
        }
    }

    @ViewBuilder private func relatedInquiries(_ entry: ContactEntry) -> some View {
        let related = inquiries.inquiries.filter { $0.contactId == entry.id || $0.organizationId == entry.id }
        if state.employee?.canView(.inquiries) == true && !related.isEmpty {
            group("Zapytania (\(related.count))") {
                ForEach(related.prefix(12)) { inquiry in inquiryRow(inquiry) }
            }
        }
    }

    private func inquiryRow(_ inquiry: Inquiry) -> some View {
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

    @ViewBuilder private func footer(_ entry: ContactEntry) -> some View {
        Button("Pełna karta w CRM (Klient 360°, oferty, faktury, historia)", systemImage: "safari") { actions.browser(entry) }
            .buttonStyle(.link).linkCursor()
        if store.canManage {
            HStack {
                Button(role: .destructive) { actions.remove(entry) } label: { Label("Usuń…", systemImage: "trash") }
                Spacer()
                Button { actions.edit(entry) } label: { Label("Edytuj", systemImage: "pencil") }
                    .buttonStyle(.borderedProminent).keyboardShortcut("e")
            }
        }
    }

    private func linkRow(_ link: ContactLink, organization: Bool) -> some View {
        Button { select(link.id) } label: {
            HStack(spacing: 8) {
                Image(systemName: organization ? "building.2" : "person").foregroundStyle(theme.accent).frame(width: 18)
                VStack(alignment: .leading, spacing: 1) {
                    Text(link.name).lineLimit(1)
                    if !link.position.isEmpty { Text(link.position).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer()
                if link.primary { tag("Główny", theme.accent) }
                if link.decisionMaker { tag("Decydent", CrmTheme.rgb(0x60a5fa)) }
            }
            .padding(.vertical, 5).padding(.horizontal, 8)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(store.entry(link.id) == nil ? "Otwórz kartę w CRM" : "Pokaż szczegóły")
    }
    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 1)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            content()
        }
    }
    @ViewBuilder private func field(_ label: String, _ value: String) -> some View {
        if !value.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).textSelection(.enabled)
            }
        }
    }
    private func openWebsite(_ value: String) {
        let address = value.hasPrefix("http://") || value.hasPrefix("https://") ? value : "https://\(value)"
        if let url = URL(string: address) { NSWorkspace.shared.open(url) }
    }
    private func openMap(_ entry: ContactEntry) {
        if !entry.mapsUrl.isEmpty, let url = URL(string: entry.mapsUrl), url.scheme == "https" { NSWorkspace.shared.open(url); return }
        var parts = URLComponents(string: "https://maps.apple.com/")!
        parts.queryItems = [URLQueryItem(name: "q", value: entry.fullAddress)]
        if let url = parts.url { NSWorkspace.shared.open(url) }
    }
}
