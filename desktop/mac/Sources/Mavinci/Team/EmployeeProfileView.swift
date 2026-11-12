import SwiftUI
import AppKit

// MARK: Karta pracownika — 1:1 z `/crm/employees/[id]`: tło, zdjęcie, odznaki (aktywny, poziom dostępu, rola), kontakt i zakładki
// widoczne według uprawnień: Przegląd (z edycją), Umowy i rozliczenia, Kwalifikacje, Konta Email, Uprawnienia, Dokumenty,
// Zadania (własny profil), Wydarzenia, Oś czasu (plan dzień / tydzień i nieobecności).

/// Zdjęcie z adresu (pamięć podręczna jak awatary) z kadrem CRM (przesunięcie w %, skala).
@MainActor struct CachedRemoteImage: View {
    let url: String
    let crop: AvatarCrop?
    @State private var image: NSImage?
    init(url: String, crop: AvatarCrop?) {
        self.url = url; self.crop = crop
        _image = State(initialValue: AvatarCache.shared.cached(url))
    }
    var body: some View {
        GeometryReader { geo in
            if let image {
                Image(nsImage: image).resizable()
                    .aspectRatio(contentMode: crop?.fit == "contain" ? .fit : .fill)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .scaleEffect(crop?.scale ?? 1)
                    .offset(x: CGFloat(crop?.x ?? 0) / 100 * geo.size.width, y: CGFloat(crop?.y ?? 0) / 100 * geo.size.height)
                    .clipped()
            }
        }
        .task(id: url) { image = await AvatarCache.shared.image(for: url) ?? image }
    }
}

@MainActor struct EmployeeProfileView: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    let initialTab: EmployeeTab?
    let actions: TeamActions
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var tab: EmployeeTab = .overview
    @State private var editing = false
    @State private var fields: [String: String] = [:]
    @State private var showOnWebsite = false
    @State private var orderIndex = 999
    @State private var errors: [String: String] = [:]
    @State private var saving = false
    @State private var addingAbsence = false
    @State private var reviewing: EmployeeAbsence?
    @State private var removingAbsence: EmployeeAbsence?
    @FocusState private var focused: String?

    private var member: TeamMember? { store.member(employeeID) }
    private var detail: EmployeeDetail? { store.details[employeeID] }
    private var access: TeamAccess? { store.access }
    private var isAdmin: Bool { access?.isAdmin ?? false }
    private var isOwn: Bool { store.me == employeeID }
    private var canEdit: Bool { access?.canManage ?? false }
    private var canEditHere: Bool { canEdit || isOwn }
    private var canViewProfile: Bool { isOwn || canEdit || isAdmin }
    /// Zakładki w kolejności i według uprawnień jak w CRM.
    private var tabs: [EmployeeTab] {
        var list: [EmployeeTab] = [.overview]
        if isOwn || access?.canViewPersonnel == true { list.append(.personnel) }
        if isAdmin { list += [.qualifications, .emails, .permissions] }
        if isOwn || isAdmin || canEdit { list.append(.documents) }
        if isOwn { list.append(.tasks) }
        if canViewProfile { list += [.events, .timeline] }
        return list
    }

    var body: some View {
        Group {
            if let member {
                if tab == .tasks {
                    VStack(spacing: 0) {
                        compactHeader(member)
                        tabBar.padding(.horizontal, 14)
                        TasksBoardView(store: state.myTasks).id("tasks-mine-profile")
                    }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            headerCard(member)
                            tabBar
                            tabContent(member)
                        }
                        .padding(16)
                    }
                }
            } else if !store.loaded || store.syncing {
                ProgressView("Ładowanie pracownika…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("Nie znaleziono pracownika", systemImage: "person.slash",
                                       description: Text("Pracownik nie jest już aktywny albo nie masz do niego dostępu."))
            }
        }
        .navigationTitle(member?.fullName ?? "Pracownik")
        .navigationSubtitle(member?.subtitle ?? "")
        .toolbar { toolbar }
        .overlay { if saving { PendingOverlay(text: "Zapisywanie zmian…") } }
        .sheet(isPresented: $addingAbsence) {
            AddAbsenceSheet(store: store, employeeID: employeeID)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $reviewing) { absence in
            AbsenceReviewSheet(store: store, employeeID: employeeID, absence: absence, canApprove: access?.canApproveAbsences ?? false)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń nieobecność", isPresented: Binding(get: { removingAbsence != nil }, set: { if !$0 { removingAbsence = nil } }), titleVisibility: .visible) {
            if let absence = removingAbsence {
                Button("Usuń", role: .destructive) { Task { await store.deleteAbsence(absence, employeeId: employeeID) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Czy na pewno chcesz usunąć tę nieobecność?") }
        .task(id: employeeID) {
            tab = initialTab ?? .overview
            if !tabs.contains(tab) { tab = .overview }
            await store.loadDetail(employeeID)
        }
        .onChange(of: store.lastSync) { _, _ in if !editing, let member { prepare(member) } }
    }

    // MARK: Pasek narzędzi
    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button { leave() } label: { Label("Pracownicy CRM", systemImage: "chevron.left") }
                .help("Wróć do listy pracowników")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if let member, canEditHere {
                if editing {
                    Button("Anuluj") { editing = false; errors = [:]; prepare(member) }.disabled(saving)
                    if isAdmin && !isOwn {
                        Button(role: .destructive) { actions.remove(member) } label: { Label("Usuń", systemImage: "trash") }.disabled(saving)
                    }
                    Button { Task { await save(member) } } label: { Label("Zapisz", systemImage: "checkmark") }
                        .buttonStyle(.borderedProminent).keyboardShortcut("s").disabled(saving)
                } else {
                    Button { prepare(member); editing = true; tab = .overview } label: { Label("Edytuj", systemImage: "pencil") }
                        .keyboardShortcut("e")
                }
            }
            if let member {
                Menu {
                    Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/employees/\(member.id)") }
                    if isAdmin { Button("Resetuj hasło", systemImage: "key") { actions.resetPassword(member) } }
                    Button("Odśwież", systemImage: "arrow.clockwise") { Task { await store.sync(force: true); await store.loadDetail(employeeID) } }
                } label: { Label("Więcej", systemImage: "ellipsis.circle") }
            }
        }
    }

    private func leave() {
        editing = false
        store.openedID = nil; store.openedTab = nil; store.openedDate = nil
    }

    // MARK: Nagłówek
    private func headerCard(_ m: TeamMember) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                LinearGradient(colors: [theme.accent.opacity(0.25), theme.accent.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing)
                if let url = m.backgroundUrl, !url.isEmpty { CachedRemoteImage(url: url, crop: m.background) }
            }
            .frame(height: 150)
            .clipped()
            HStack(alignment: .top, spacing: 16) {
                TeamAvatar(member: m, size: 108)
                    .padding(4).background(Circle().fill(theme.card))
                    .offset(y: -54).padding(.bottom, -54)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        TeamBadges(member: m, showAccess: false)
                        if !m.accessLevel.isEmpty { pill(TeamLabels.accessLevel(m.accessLevel), CrmTheme.rgb(0x60a5fa), symbol: "shield") }
                        if !m.role.isEmpty { pill(TeamLabels.role(m.role), CrmTheme.rgb(0xc084fc), symbol: nil) }
                    }
                    HStack(spacing: 18) {
                        contactLink(m.email, symbol: "envelope", scheme: "mailto")
                        if !m.phone.isEmpty { contactLink(m.phone, symbol: "phone", scheme: "tel") }
                        if !m.region.isEmpty { Label(m.region, systemImage: "mappin").foregroundStyle(.secondary) }
                    }
                    .font(.callout)
                }
                .padding(.top, 10)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.bottom, 16)
        }
        .background(theme.card.opacity(theme == .light ? 1 : 0.9))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func compactHeader(_ m: TeamMember) -> some View {
        HStack(spacing: 12) {
            TeamAvatar(member: m, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(m.fullName).font(.headline)
                Text(m.subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 6)
    }

    private func pill(_ text: String, _ color: Color, symbol: String?) -> some View {
        HStack(spacing: 3) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(text)
        }
        .font(.caption2.weight(.medium)).padding(.horizontal, 8).padding(.vertical, 3)
        .background(color.opacity(0.18), in: Capsule()).foregroundStyle(color)
    }

    private func contactLink(_ value: String, symbol: String, scheme: String) -> some View {
        Button {
            var parts = URLComponents(); parts.scheme = scheme; parts.path = value.replacingOccurrences(of: " ", with: scheme == "tel" ? "" : " ")
            if let url = parts.url { NSWorkspace.shared.open(url) }
        } label: { Label(value, systemImage: symbol) }
        .buttonStyle(.link).linkCursor().foregroundStyle(.secondary)
    }

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(tabs) { item in
                    Button { tab = item } label: {
                        Label(item.label, systemImage: item.symbol)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .foregroundStyle(tab == item ? theme.accent : Color.secondary)
                            .overlay(alignment: .bottom) { if tab == item { Rectangle().fill(theme.accent).frame(height: 2) } }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: Zakładki
    @ViewBuilder private func tabContent(_ m: TeamMember) -> some View {
        switch tab {
        case .overview: overview(m)
        case .events: eventsTab
        case .documents: documentsTab
        case .timeline: timelineTab(m)
        case .tasks: EmptyView()
        case .qualifications: EmployeeQualificationsView(store: store, employeeID: m.id, canEdit: canEdit)
        case .emails: EmployeeEmailAccountsView(store: store, employeeID: m.id)
        case .permissions: EmployeePermissionsView(store: store, employeeID: m.id)
        case .personnel: laterTab(m)
        }
    }

    private func laterTab(_ m: TeamMember) -> some View {
        let query = tab == .permissions ? "?tab=permissions" : ""
        return card(tab.label) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Ta zakładka trafi do aplikacji w kolejnym etapie. Do tego czasu otwórz ją na karcie pracownika w CRM.")
                    .foregroundStyle(.secondary)
                Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/employees/\(m.id)\(query)") }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private func card<Content: View>(_ title: String, symbol: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).foregroundStyle(theme.accent) }
                Text(title).font(.title3.weight(.light))
            }
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private func info(_ label: String, _ value: String) -> some View {
        if !value.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).textSelection(.enabled)
            }
        }
    }

    // MARK: Przegląd
    private func overview(_ m: TeamMember) -> some View {
        let columns = [GridItem(.flexible(), spacing: 14, alignment: .top), GridItem(.flexible(), spacing: 14, alignment: .top)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
            basicCard(m)
            addressCard(m)
            if !m.skills.isEmpty { skillsCard(m) }
            if isAdmin { websiteCard(m) }
            if !m.notes.isEmpty || editing { notesCard(m) }
            if let accounts = detail?.emailAccounts, !accounts.isEmpty { emailCard(accounts) }
            card("Wynagrodzenie i prowizje", symbol: "banknote") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Warunki wynagrodzenia, prowizje i rozliczenia trafią do aplikacji w kolejnym etapie.").font(.callout).foregroundStyle(.secondary)
                    Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/employees/\(m.id)") }.buttonStyle(.link).linkCursor()
                }
            }
        }
    }

    private func basicCard(_ m: TeamMember) -> some View {
        card("Informacje podstawowe") {
            VStack(alignment: .leading, spacing: 10) {
                if editing {
                    field("name", "Imię")
                    field("surname", "Nazwisko")
                    field("nickname", "Pseudonim")
                    field("email", "Email służbowy")
                    if isAdmin {
                        field("personal_email", "Email prywatny", prompt: "Opcjonalnie")
                        choice("notification_email_preference", "Powiadomienia email wysyłać na", TeamLabels.notificationOptions)
                    }
                    field("phone_number", "Telefon")
                    field("occupation", "Stanowisko")
                    if isAdmin { accessLevelPicker }
                } else {
                    info("Imię", m.name)
                    info("Nazwisko", m.surname)
                    info("Pseudonim", m.nickname)
                    info("Email służbowy", m.email)
                    if isAdmin { info("Email prywatny", m.personalEmail) }
                    info("Telefon", m.phone)
                    info("Telefon prywatny", m.phonePrivate)
                    info("Stanowisko", m.occupation)
                }
            }
        }
    }

    private var accessLevelPicker: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker("Rola firmowa i pakiet dostępu", selection: binding("access_level_id")) {
                Text("Brak roli firmowej").tag("")
                ForEach(detail?.accessLevels ?? []) { Text($0.name).tag($0.id) }
                let current = fields["access_level_id"] ?? ""
                if !current.isEmpty && !(detail?.accessLevels ?? []).contains(where: { $0.id == current }) { Text("Bieżąca rola").tag(current) }
            }
            Text("Zmiana roli automatycznie zastosuje jej uprawnienia i zakładki. Zakres marek ustawisz w zakładce Uprawnienia.")
                .font(.caption2).foregroundStyle(.secondary)
            if let issue = errors["access_level_id"] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }

    private func addressCard(_ m: TeamMember) -> some View {
        card("Adres") {
            VStack(alignment: .leading, spacing: 10) {
                if editing {
                    field("address_street", "Ulica")
                    HStack(alignment: .top, spacing: 10) {
                        field("address_postal_code", "Kod pocztowy")
                        field("address_city", "Miasto")
                    }
                    field("region", "Region")
                } else if m.street.isEmpty && m.city.isEmpty && m.region.isEmpty {
                    Text("Brak danych adresowych").font(.callout).foregroundStyle(.secondary)
                } else {
                    info("Ulica", m.street)
                    info("Miasto", [m.postalCode, m.city].filter { !$0.isEmpty }.joined(separator: " "))
                    info("Region", m.region)
                }
            }
        }
    }

    private func skillsCard(_ m: TeamMember) -> some View {
        card("Umiejętności") {
            WrapLayout(spacing: 6) {
                ForEach(Array(m.skills.enumerated()), id: \.offset) { _, skill in
                    Text(skill).font(.callout).padding(.horizontal, 10).padding(.vertical, 4)
                        .background(theme.accent.opacity(0.12), in: Capsule()).foregroundStyle(theme.accent)
                }
            }
        }
    }

    private func websiteCard(_ m: TeamMember) -> some View {
        card("Widoczność na stronie") {
            VStack(alignment: .leading, spacing: 10) {
                if editing {
                    Toggle("Wyświetl na stronie /zespół", isOn: $showOnWebsite)
                    VStack(alignment: .leading, spacing: 3) {
                        Stepper(value: $orderIndex, in: 0...9999) {
                            HStack { Text("Kolejność wyświetlania (0 = pierwszy)"); Spacer(); Text("\(orderIndex)").monospacedDigit() }
                        }
                        Text("Niższa liczba = wyżej na liście. Admini mają automatycznie 0.").font(.caption2).foregroundStyle(.secondary)
                        if let issue = errors["order_index"] { Text(issue).font(.caption).foregroundStyle(.red) }
                    }
                    if showOnWebsite {
                        field("website_bio", "Biografia (dla strony)", prompt: "Krótki opis do wyświetlenia na stronie...", vertical: true)
                        field("linkedin_url", "LinkedIn", prompt: "https://linkedin.com/in/...")
                        field("instagram_url", "Instagram", prompt: "https://instagram.com/...")
                        field("facebook_url", "Facebook", prompt: "https://facebook.com/...")
                    }
                } else {
                    info("Status", m.showOnWebsite ? "✓ Widoczny na stronie" : "✗ Ukryty")
                    info("Kolejność", "\(m.orderIndex)\(m.orderIndex == 0 ? " (pierwszy)" : "")")
                    if m.showOnWebsite {
                        info("Biografia", m.websiteBio)
                        info("LinkedIn", m.linkedin)
                        info("Instagram", m.instagram)
                        info("Facebook", m.facebook)
                    }
                }
            }
        }
    }

    private func notesCard(_ m: TeamMember) -> some View {
        card("Notatki") {
            if editing { field("notes", "Notatki", vertical: true) }
            else { Text(m.notes).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
        }
    }

    private func emailCard(_ accounts: [EmployeeEmailAccount]) -> some View {
        card("Konta Email", symbol: "envelope") {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(accounts) { account in
                    HStack(spacing: 6) {
                        Image(systemName: "envelope").foregroundStyle(theme.accent)
                        Text(account.email).textSelection(.enabled)
                        if account.primary {
                            Text("Główne").font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                                .background(theme.accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(theme.accent)
                        }
                    }
                }
            }
        }
    }

    // MARK: Pola edycji
    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { fields[key] ?? "" }, set: { fields[key] = $0; errors.removeValue(forKey: key) })
    }
    @ViewBuilder private func field(_ key: String, _ label: String, prompt: String? = nil, vertical: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            if vertical {
                TextField("", text: binding(key), prompt: prompt.map { Text($0) }, axis: .vertical).lineLimit(3...8)
                    .textFieldStyle(.roundedBorder).focused($focused, equals: key)
            } else {
                TextField("", text: binding(key), prompt: prompt.map { Text($0) }).textFieldStyle(.roundedBorder).focused($focused, equals: key)
            }
            if let issue = errors[key] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }
    private func choice(_ key: String, _ label: String, _ options: [InquiryOption]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Picker(label, selection: binding(key)) { ForEach(options) { Text($0.label).tag($0.value) } }
            if let issue = errors[key] { Text(issue).font(.caption).foregroundStyle(.red) }
        }
    }

    private func original(_ m: TeamMember) -> [String: String] {
        ["name": m.name, "surname": m.surname, "nickname": m.nickname, "email": m.email, "personal_email": m.personalEmail,
         "notification_email_preference": m.notificationPreference.isEmpty ? "work" : m.notificationPreference, "phone_number": m.phone,
         "occupation": m.occupation, "access_level_id": m.accessLevelId ?? "", "address_street": m.street,
         "address_postal_code": m.postalCode, "address_city": m.city, "region": m.region, "notes": m.notes,
         "website_bio": m.websiteBio, "linkedin_url": m.linkedin, "instagram_url": m.instagram, "facebook_url": m.facebook]
    }
    private func prepare(_ m: TeamMember) {
        fields = original(m); showOnWebsite = m.showOnWebsite; orderIndex = m.orderIndex
    }

    private func save(_ m: TeamMember) async {
        let adminKeys: Set<String> = ["personal_email", "notification_email_preference", "access_level_id", "website_bio", "linkedin_url", "instagram_url", "facebook_url"]
        let before = original(m)
        var data: [String: JSONValue] = [:]
        for (key, old) in before where isAdmin || !adminKeys.contains(key) {
            let value = (fields[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard value != old.trimmingCharacters(in: .whitespacesAndNewlines) else { continue }
            data[key] = value.isEmpty ? .null : .string(value)
        }
        if isAdmin && showOnWebsite != m.showOnWebsite { data["show_on_website"] = .bool(showOnWebsite) }
        if isAdmin && orderIndex != m.orderIndex { data["order_index"] = .number(Double(orderIndex)) }
        var found: [String: String] = [:]
        if (fields["name"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty { found["name"] = "Imię jest wymagane." }
        if (fields["surname"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty { found["surname"] = "Nazwisko jest wymagane." }
        if !found.isEmpty { errors = found; focused = found.keys.sorted().first; return }
        if data.isEmpty { editing = false; return }
        let edited = fields.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let website = showOnWebsite, order = orderIndex, admin = isAdmin
        saving = true
        defer { saving = false }
        do {
            try await store.update(m, data: data) { e in
                e.name = edited["name"] ?? e.name; e.surname = edited["surname"] ?? e.surname; e.nickname = edited["nickname"] ?? ""
                e.email = edited["email"] ?? e.email; e.phone = edited["phone_number"] ?? ""; e.occupation = edited["occupation"] ?? ""
                e.street = edited["address_street"] ?? ""; e.postalCode = edited["address_postal_code"] ?? ""; e.city = edited["address_city"] ?? ""
                e.region = edited["region"] ?? ""; e.notes = edited["notes"] ?? ""
                if admin {
                    e.personalEmail = edited["personal_email"] ?? ""; e.notificationPreference = edited["notification_email_preference"] ?? "work"
                    let level = edited["access_level_id"] ?? ""; e.accessLevelId = level.isEmpty ? nil : level
                    e.showOnWebsite = website; e.orderIndex = order; e.websiteBio = edited["website_bio"] ?? ""
                    e.linkedin = edited["linkedin_url"] ?? ""; e.instagram = edited["instagram_url"] ?? ""; e.facebook = edited["facebook_url"] ?? ""
                }
            }
            editing = false; errors = [:]
            state.succeed("Zmiany zapisane pomyślnie")
        } catch let failure as NativeFailure {
            errors = failure.fieldErrors
            state.error = failure.message
        } catch {
            state.error = store.failureText(error, "Błąd podczas zapisywania zmian")
        }
    }

    // MARK: Wydarzenia
    private var eventsTab: some View {
        card("Wydarzenia") {
            if let events = detail?.events {
                if events.isEmpty {
                    emptyState("Brak przypisanych wydarzeń", symbol: "calendar")
                } else {
                    VStack(spacing: 8) { ForEach(events) { assignment in eventRow(assignment) } }
                }
            } else {
                loadingState
            }
        }
    }

    private func eventRow(_ a: EmployeeEventAssignment) -> some View {
        Button { state.showEvent(a.eventId) } label: {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(a.eventName).fontWeight(.medium)
                    Text("Rola: \(a.role.isEmpty ? "Brak" : a.role)").font(.callout).foregroundStyle(theme.accent)
                    HStack(spacing: 12) {
                        if let date = a.date { Label(MeetingDates.format(date, "dd.MM.yyyy"), systemImage: "calendar") }
                        if let hours = a.hours, hours > 0 { Label("\(hours.formatted(.number.precision(.fractionLength(0...1))))h", systemImage: "clock") }
                        if !TeamLabels.assignmentStatus(a.status).isEmpty { Text(TeamLabels.assignmentStatus(a.status)) }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    if !a.responsibilities.isEmpty { Text(a.responsibilities).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(12)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func emptyState(_ text: String, symbol: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 36)).foregroundStyle(.tertiary)
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 30)
    }
    private var loadingState: some View {
        Group {
            if let error = store.detailError { Text(error).foregroundStyle(.secondary) }
            else { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30) }
        }
    }

    // MARK: Dokumenty
    private var documentsTab: some View {
        card("Dokumenty") {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Spacer()
                    Button { } label: { Label("Dodaj dokument", systemImage: "plus") }
                        .disabled(true).help("Funkcja dokumentów nie jest jeszcze dostępna (także w CRM)")
                }
                emptyState("Brak dokumentów", symbol: "doc")
            }
        }
    }

    // MARK: Oś czasu
    private func timelineTab(_ m: TeamMember) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            EmployeeScheduleGrid(store: store, employeeID: m.id, defaultWeek: isOwn,
                                 storageKey: isOwn ? "crm.employee-schedule.view.own" : "crm.employee-schedule.view.other",
                                 initialDate: store.openedDate)
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Nieobecności").font(.title3.weight(.light))
                    Text("Zarządzaj urlopami i nieobecnościami pracownika").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                if isOwn || canEdit {
                    Button { addingAbsence = true } label: { Label("Dodaj nieobecność", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
            }
            .padding(18)
            .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
            if let absences = detail?.absences {
                if absences.isEmpty {
                    emptyState("Brak zaplanowanych nieobecności", symbol: "calendar")
                        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                } else {
                    VStack(spacing: 10) { ForEach(absences) { absence in absenceRow(absence) } }
                }
            } else {
                loadingState
            }
        }
    }

    private func absenceRow(_ a: EmployeeAbsence) -> some View {
        let status = TeamLabels.absenceStatus(a.status)
        let canApprove = (access?.canApproveAbsences ?? false) && a.status == "pending"
        let canDelete = (isOwn && a.status == "pending") || (access?.canApproveAbsences ?? false)
        let from = a.startDate.map { MeetingDates.format($0, "d MMM yyyy") } ?? ""
        let to = a.endDate.map { MeetingDates.format($0, "d MMM yyyy") } ?? ""
        let duration = "(\(a.days) \(a.days == 1 ? "dzień" : "dni"))"
        return HStack(alignment: .top, spacing: 14) {
            RoundedRectangle(cornerRadius: 2).fill(TeamLabels.absenceColor(a.type)).frame(width: 4).frame(minHeight: 44)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(TeamLabels.absenceType(a.type)).font(.headline)
                    Text(status.label).font(.caption.weight(.medium)).padding(.horizontal, 8).padding(.vertical, 2)
                        .background(status.color.opacity(0.18), in: Capsule()).foregroundStyle(status.color)
                }
                HStack(spacing: 6) {
                    Image(systemName: "calendar")
                    Text("\(from) – \(to)")
                    Text(duration).foregroundStyle(.tertiary)
                }
                .font(.callout).foregroundStyle(.secondary)
                if a.allDay { Label("Cały dzień", systemImage: "clock").font(.callout).foregroundStyle(.secondary) }
                if !a.notes.isEmpty {
                    Text(a.notes).font(.callout).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                if canApprove { Button("Rozpatrz") { reviewing = a }.help("Rozpatrz wniosek") }
                else { Button { reviewing = a } label: { Image(systemName: "info.circle") }.buttonStyle(.borderless).help("Szczegóły nieobecności") }
                if canDelete {
                    Button(role: .destructive) { removingAbsence = a } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń")
                }
            }
        }
        .padding(16)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Elementy w wierszach z zawijaniem (umiejętności).
struct WrapLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 400
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += line + spacing; line = 0 }
            x += size.width + spacing; line = max(line, size.height)
        }
        return CGSize(width: width, height: y + line)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += line + spacing; line = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing; line = max(line, size.height)
        }
    }
}
