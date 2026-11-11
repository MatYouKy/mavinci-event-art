import SwiftUI

// MARK: Zakładka „Uprawnienia” — 1:1 z `EmployeePermissionsTab`: pakiet roli firmowej, szybkie akcje, marki i spółki, finanse według
// działalności, subskrypcje powiadomień i źródła webhooków, sekcje CRM (poziom dostępu, zakres danych, zakładki wydarzeń / kontaktów
// / organizacji, zespół sprzedaży, dodatkowe uprawnienia, sekcje Mavinci LIVE). Zapis z kontrolą równoczesnej zmiany.

struct PermissionDraft: Equatable {
    var permissions: [String]
    var eventTabs: [String]
    var contactTabs: [String]
    var organizationTabs: [String]
    var companyAccessMode: String
    var myCompanyIds: [String]
    var rolePermissionsInherited: Bool
    var financeCompanyAccess: [String: String]
    var salesTeamId: String
    var isSalesTeamManager: Bool
    var notifications: NotificationFlags
    var webhookSources: [String: Bool]

    init(_ data: EmployeePermissionsData) {
        permissions = data.permissions; eventTabs = data.eventTabs; contactTabs = data.contactTabs; organizationTabs = data.organizationTabs
        companyAccessMode = data.companyAccessMode; myCompanyIds = data.myCompanyIds; rolePermissionsInherited = data.rolePermissionsInherited
        financeCompanyAccess = data.financeCompanyAccess; salesTeamId = data.salesTeamId; isSalesTeamManager = data.isSalesTeamManager
        notifications = data.notifications
        webhookSources = Dictionary(uniqueKeysWithValues: data.webhookSources.map { ($0.id, $0.enabled) })
    }
    var json: [String: JSONValue] {
        [
            "permissions": .array(permissions.map { .string($0) }), "eventTabs": .array(eventTabs.map { .string($0) }),
            "contactTabs": .array(contactTabs.map { .string($0) }), "organizationTabs": .array(organizationTabs.map { .string($0) }),
            "companyAccessMode": .string(companyAccessMode), "myCompanyIds": .array(myCompanyIds.map { .string($0) }),
            "rolePermissionsInherited": .bool(rolePermissionsInherited),
            "financeCompanyAccess": .object(financeCompanyAccess.mapValues { .string($0) }),
            "salesTeamId": .string(salesTeamId), "isSalesTeamManager": .bool(isSalesTeamManager),
            "notifications": .object([
                "contactForm": .bool(notifications.contactForm), "webhook": .bool(notifications.webhook), "fleet": .bool(notifications.fleet),
                "inquiryAssignments": .bool(notifications.inquiryAssignments), "inquiryFollowups": .bool(notifications.inquiryFollowups),
                "inquiryEscalations": .bool(notifications.inquiryEscalations),
            ]),
            "webhookSources": .object(webhookSources.mapValues { .bool($0) }),
        ]
    }
}

@MainActor struct EmployeePermissionsView: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: EmployeePermissionsData?
    @State private var draft: PermissionDraft?
    @State private var original: PermissionDraft?
    @State private var updatedAt: String?
    @State private var error: String?
    @State private var expanded: Set<String> = []
    @State private var confirming = false
    @State private var saving = false

    private var targetIsAdmin: Bool { data?.targetIsAdmin ?? false }
    private var hasChanges: Bool { draft != nil && draft != original }

    var body: some View {
        Group {
            if let data, let draft { content(data, draft) }
            else if let error { TeamCard(title: "Uprawnienia pracownika") { Text(error).foregroundStyle(.secondary) } }
            else { ProgressView().frame(maxWidth: .infinity).padding(40) }
        }
        .task(id: employeeID) { await load() }
        .confirmationDialog("Zapisać zmiany?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Zapisz") { Task { await save() } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz zapisać zmiany w uprawnieniach tego pracownika?") }
    }

    private func load() async {
        do {
            let next = try await store.profile("permissions", employeeID, as: EmployeePermissionsData.self)
            data = next; updatedAt = next.updatedAt
            let fresh = PermissionDraft(next)
            draft = fresh; original = fresh; error = nil
        } catch { if data == nil { self.error = store.failureText(error, "Nie udało się pobrać uprawnień.") } }
    }

    private func save() async {
        guard var body = draft?.json else { return }
        if draft?.companyAccessMode == "selected" && (draft?.myCompanyIds.isEmpty ?? true) {
            state.error = "Wybierz przynajmniej jedną markę albo dostęp do wszystkich marek"; return
        }
        body["updatedAt"] = updatedAt.map { .string($0) } ?? .null
        saving = true
        defer { saving = false }
        await state.withPending("Zapisywanie uprawnień…") {
            do {
                let reply = try await store.profilePost("permissions", employeeID, ["data": .object(body)])
                if let next = reply["updatedAt"]?.text.nonEmpty { updatedAt = next }
                original = draft
                state.succeed("Uprawnienia zostały zapisane")
                if employeeID == store.me { await state.refresh() }
            } catch {
                state.error = store.failureText(error, "Błąd podczas zapisywania uprawnień")
            }
        }
    }

    // MARK: Zmiany
    private func edit(_ change: (inout PermissionDraft) -> Void) {
        guard var next = draft else { return }
        change(&next)
        draft = next
    }
    private func level(_ module: String, _ d: PermissionDraft) -> String {
        if targetIsAdmin { return "manage" }
        if d.permissions.contains("\(module)_manage") { return "manage" }
        if d.permissions.contains("\(module)_view") { return "view" }
        if module == "time_tracking" && d.permissions.contains("time_tracking_view_own") { return "own" }
        return "none"
    }
    private func setLevel(_ module: String, _ value: String) {
        guard !targetIsAdmin, let live = data?.catalog.liveSections else { return }
        edit { d in
            var next = d.permissions.filter { p in
                p != "\(module)_view" && p != "\(module)_manage" && !(module == "time_tracking" && p == "time_tracking_view_own")
                    && !(module == "mavinci_live" && value == "none" && live.contains(p))
            }
            switch value {
            case "own" where module == "time_tracking": next.append("time_tracking_view_own")
            case "view", "manage":
                next.append("\(module)_\(value)")
                if module == "mavinci_live" && !next.contains("mavinci_live_light_magic") { next.append("mavinci_live_light_magic") }
            default: break
            }
            d.permissions = next
            d.rolePermissionsInherited = false
        }
    }
    private func toggleExtra(_ key: String, _ d: PermissionDraft) {
        guard !targetIsAdmin else { return }
        if key == "mavinci_live_light_magic" && level("mavinci_live", d) != "none" {
            state.notice = "Light Magic jest wymaganym, podstawowym modułem Mavinci LIVE."; return
        }
        edit { d in
            if d.permissions.contains(key) { d.permissions.removeAll { $0 == key } } else { d.permissions.append(key) }
            d.rolePermissionsInherited = false
        }
    }
    private func toggle(_ list: WritableKeyPath<PermissionDraft, [String]>, _ value: String) {
        edit { d in
            if d[keyPath: list].contains(value) { d[keyPath: list].removeAll { $0 == value } } else { d[keyPath: list].append(value) }
            d.rolePermissionsInherited = false
        }
    }
    private func status(_ category: PermissionCategory, _ d: PermissionDraft) -> String {
        let value = level(category.key, d)
        if category.key == "mavinci_live" {
            if value == "none" { return "Brak" }
            let live = data?.catalog.liveSections ?? []
            let count = targetIsAdmin ? live.count : live.filter { $0 == "mavinci_live_light_magic" || d.permissions.contains($0) }.count
            return "\(value == "manage" ? "Zarządzanie" : "Dostęp") · \(count) sekcji"
        }
        if ["events", "offers", "contracts"].contains(category.key) {
            let action = value == "manage" ? "Zarządzanie" : value == "view" ? "Przeglądanie" : d.permissions.contains("\(category.key)_create") ? "Tworzenie" : "Brak dostępu"
            return "\(action) · \(d.permissions.contains("\(category.key)_own_only") ? "tylko własne" : "wszystkie dostępne")"
        }
        switch value {
        case "own": return "Przeglądanie — własny czas"
        case "view": return "Przeglądanie"
        case "manage":
            let extra = category.extra.filter { d.permissions.contains($0.key) }.count
            return extra > 0 ? "Zarządzanie + \(extra)" : "Zarządzanie"
        default: return "Brak"
        }
    }

    // MARK: Widok
    private func content(_ data: EmployeePermissionsData, _ d: PermissionDraft) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Uprawnienia pracownika", systemImage: "shield").font(.title3.weight(.light))
                Spacer()
                Button { Task { await load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(saving)
                Button { confirming = true } label: { Label(saving ? "Zapisywanie..." : "Zapisz zmiany", systemImage: "checkmark") }
                    .buttonStyle(.borderedProminent).disabled(!hasChanges || saving)
            }
            if targetIsAdmin {
                notice("Administrator ma nieograniczony dostęp do Mavinci LIVE. Rola admin automatycznie udostępnia wszystkie sekcje, wydarzenia, presety i funkcje zarządzania — niezależnie od zapisanych pól.", color: CrmTheme.rgb(0xc084fc))
            }
            if let package = data.rolePackage { rolePackage(package, d) }
            HStack(spacing: 8) {
                Text("Szybkie akcje").font(.callout).foregroundStyle(.secondary)
                Button("Zaznacz wszystko") { edit { $0.permissions = data.catalog.allScopes; $0.rolePermissionsInherited = false } }
                Button("Odznacz wszystko") { edit { $0.permissions = []; $0.rolePermissionsInherited = false } }
            }
            .controlSize(.small)
            companies(data, d)
            finance(data, d)
            notifications(data, d)
            VStack(spacing: 8) { ForEach(data.catalog.categories) { category in categoryRow(category, data, d) } }
            if hasChanges {
                notice("Masz niezapisane zmiany. Kliknij „Zapisz zmiany”, aby je zachować.", color: CrmTheme.rgb(0xfbbf24))
            }
        }
    }

    private func notice(_ text: String, color: Color) -> some View {
        Text(text).font(.callout).foregroundStyle(color)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
    }

    private func rolePackage(_ package: RolePackage, _ d: PermissionDraft) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("Rola firmowa: \(package.name)").fontWeight(.medium)
                Text(d.rolePermissionsInherited ? "Uprawnienia i zakładki są synchronizowane z pakietem tej roli." : "Ten pracownik ma indywidualne odstępstwa od pakietu roli.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if !d.rolePermissionsInherited {
                Button {
                    edit { d in
                        d.permissions = package.permissions; d.eventTabs = package.eventTabs; d.contactTabs = package.contactTabs
                        d.organizationTabs = package.organizationTabs; d.rolePermissionsInherited = true
                    }
                    state.notice = "Przywrócono pakiet roli „\(package.name)”"
                } label: { Label("Przywróć pakiet roli", systemImage: "arrow.uturn.backward") }
            }
        }
        .padding(14)
        .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    private func companies(_ data: EmployeePermissionsData, _ d: PermissionDraft) -> some View {
        TeamCard(title: "Marki i spółki", symbol: "building.2") {
            Text("To ograniczenie działa niezależnie od roli. Obejmuje wydarzenia, kalendarz, oferty, umowy i dane finansowe powiązane z marką.")
                .font(.callout).foregroundStyle(.secondary)
            Picker("Dostęp do marek", selection: Binding(get: { d.companyAccessMode }, set: { mode in
                edit { $0.companyAccessMode = mode; if mode == "all" { $0.myCompanyIds = [] } }
            })) {
                Text("Wszystkie marki — dostęp zgodny z rolą bez ograniczenia marki").tag("all")
                Text("Wybrane marki — pracownik zobaczy tylko zaznaczone marki").tag("selected")
            }
            .pickerStyle(.radioGroup).labelsHidden()
            if d.companyAccessMode == "selected" {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), alignment: .leading)], alignment: .leading, spacing: 6) {
                    ForEach(data.companies) { company in
                        Toggle(company.name, isOn: Binding(get: { d.myCompanyIds.contains(company.id) }, set: { on in
                            edit { draft in
                                if on { draft.myCompanyIds.append(company.id) }
                                else { draft.myCompanyIds.removeAll { $0 == company.id }; draft.financeCompanyAccess.removeValue(forKey: company.id) }
                            }
                        }))
                        .toggleStyle(.checkbox)
                    }
                }
            }
        }
    }

    private func finance(_ data: EmployeePermissionsData, _ d: PermissionDraft) -> some View {
        let available = data.companies.filter { $0.active && (d.companyAccessMode == "all" || d.myCompanyIds.contains($0.id)) }
        return TeamCard(title: "Finanse według działalności", symbol: "shield") {
            Text("Dla każdej działalności, do której pracownik ma dostęp, określ, co widzi w finansach. Bez wybranego poziomu nie widzi żadnych finansów tej działalności — także faktur, wyciągów i deklaracji. Fakturowanie zostaje przy administratorze, chyba że nadasz „Wystawianie faktur”. Zmienia wyłącznie administrator.")
                .font(.callout).foregroundStyle(.secondary)
            if targetIsAdmin {
                Text("Administrator ma pełny dostęp do finansów wszystkich działalności.").foregroundStyle(.secondary)
            } else if available.isEmpty {
                Text("Najpierw przypisz pracownikowi działalność w sekcji „Marki i spółki”.").foregroundStyle(.secondary)
            } else {
                ForEach(available) { company in
                    let value = d.financeCompanyAccess[company.id] ?? "none"
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(company.name).fontWeight(.medium)
                            Text(data.catalog.financeLevels.first { $0.value == value }?.description ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Picker("Finanse tej działalności", selection: Binding(get: { value }, set: { next in
                            edit { if next == "none" { $0.financeCompanyAccess.removeValue(forKey: company.id) } else { $0.financeCompanyAccess[company.id] = next } }
                        })) {
                            ForEach(data.catalog.financeLevels) { Text($0.label).tag($0.value) }
                        }
                        .labelsHidden().fixedSize()
                    }
                    .padding(10)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
                Text("Finanse tej działalności: poziom wyższy obejmuje niższe. Uprawnienie „Wartości finansowe wydarzeń” w sekcji poniżej dotyczy tylko budżetów i kosztów widocznych wydarzeń, nie banku ani faktur.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func flag(_ title: String, _ detail: String, _ path: WritableKeyPath<NotificationFlags, Bool>, _ d: PermissionDraft, symbol: String? = nil) -> some View {
        Toggle(isOn: Binding(get: { d.notifications[keyPath: path] }, set: { value in edit { $0.notifications[keyPath: path] = value } })) {
            HStack(spacing: 8) {
                if let symbol { Image(systemName: symbol).foregroundStyle(theme.accent) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .toggleStyle(.switch)
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func notifications(_ data: EmployeePermissionsData, _ d: PermissionDraft) -> some View {
        TeamCard(title: "Subskrypcje powiadomień", symbol: "bell") {
            Text("Te ustawienia sterują wyłącznie dostarczaniem powiadomień. Nie nadają ani nie odbierają dostępu do wiadomości i zdarzeń.")
                .font(.callout).foregroundStyle(.secondary)
            flag("Formularze kontaktowe", "Powiadomienia o nowych zapytaniach wysłanych z formularzy stron internetowych.", \.contactForm, d)
            flag("Follow-upy zapytań", "Przypomnienia o pierwszym kontakcie, kolejnej akcji i kontakcie po ofercie.", \.inquiryFollowups, d)
            flag("Eskalacje sprzedażowe", "Alerty managerskie, gdy zapytanie nadal nie zostało obsłużone po przypomnieniach.", \.inquiryEscalations, d)
            flag("Przypisanie zapytania", "Banner i notyfikacja, gdy menedżer przypisze temu pracownikowi zapytanie.", \.inquiryAssignments, d)
            flag("Zewnętrzne źródła", "Główny przełącznik powiadomień ze wszystkich webhooków.", \.webhook, d, symbol: "point.3.connected.trianglepath.dotted")
            flag("Terminy floty", "Przypomnienia o braku lub kończącej się polisie OC i przeglądzie technicznym.", \.fleet, d, symbol: "car")
            if !data.webhookSources.isEmpty {
                Text("Źródła webhooków").font(.callout.weight(.medium)).padding(.top, 4)
                ForEach(data.webhookSources) { source in
                    Toggle(isOn: Binding(get: { d.webhookSources[source.id] ?? data.notificationDefaults }, set: { value in edit { $0.webhookSources[source.id] = value } })) {
                        HStack {
                            Text(source.name)
                            Text(source.slug).font(.caption.monospaced()).foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.checkbox)
                    .disabled(!d.notifications.webhook)
                }
            }
            Text("Administrator zachowuje dostęp do wszystkich danych niezależnie od tych przełączników. Pracownik bez odpowiednich uprawnień nie otrzyma danych nawet po włączeniu subskrypcji.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: Sekcje CRM
    private func categoryRow(_ category: PermissionCategory, _ data: EmployeePermissionsData, _ d: PermissionDraft) -> some View {
        DisclosureGroup(isExpanded: Binding(get: { expanded.contains(category.key) }, set: { open in
            if open { expanded.insert(category.key) } else { expanded.remove(category.key) }
        })) {
            categoryDetail(category, data, d).padding(.top, 8)
        } label: {
            HStack {
                Text(category.label).fontWeight(.medium)
                Spacer()
                Text(status(category, d)).font(.callout).foregroundStyle(level(category.key, d) == "none" ? Color.secondary : theme.accent)
            }
            .contentShape(Rectangle())
            .onTapGesture { if expanded.contains(category.key) { expanded.remove(category.key) } else { expanded.insert(category.key) } }
        }
        .padding(12)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private func categoryDetail(_ category: PermissionCategory, _ data: EmployeePermissionsData, _ d: PermissionDraft) -> some View {
        let value = level(category.key, d)
        VStack(alignment: .leading, spacing: 12) {
            Picker("Poziom dostępu", selection: Binding(get: { value }, set: { setLevel(category.key, $0) })) {
                Text("Brak").tag("none")
                if category.key == "time_tracking" { Text("Przeglądanie i raportowanie własnego czasu").tag("own") }
                Text("Przeglądanie").tag("view")
                Text("Zarządzanie").tag("manage")
            }
            .disabled(targetIsAdmin)
            if data.catalog.recordScopeModules.contains(category.key) { recordScope(category.key, d) }
            if category.key == "mavinci_live" && value != "none" {
                Text("Dostęp działa dwustopniowo: tutaj wybierasz dostępne sekcje aplikacji, a na karcie wydarzenia określasz projekty, poziom obsługi i okres dostępu. Light Magic pozostaje zawsze dostępny jako moduł podstawowy.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if category.key == "events" && value != "none" {
                tabs("Dostępne zakładki w wydarzeniach", "Wybierz zakładki, które będą widoczne dla tego pracownika", data.catalog.eventTabs, \.eventTabs, d)
            }
            if category.key == "inquiries" && value != "none" { salesTeam(data, d) }
            if category.key == "clients" && value != "none" {
                tabs("Dostępne zakładki dla kontaktów indywidualnych", "Wybierz zakładki, które będą widoczne w profilu kontaktu", data.catalog.contactTabs, \.contactTabs, d)
                tabs("Dostępne zakładki dla organizacji (firm)", "Wybierz zakładki, które będą widoczne w profilu organizacji", data.catalog.organizationTabs, \.organizationTabs, d)
            }
            if !category.extra.isEmpty { extras(category, value, d) }
        }
    }

    private func recordScope(_ module: String, _ d: PermissionDraft) -> some View {
        let key = "\(module)_own_only"
        return VStack(alignment: .leading, spacing: 4) {
            Picker("Zakres danych", selection: Binding(get: { d.permissions.contains(key) ? "own" : "all" }, set: { scope in
                edit { draft in
                    draft.permissions.removeAll { $0 == key }
                    if scope == "own" { draft.permissions.append(key) }
                    draft.rolePermissionsInherited = false
                }
            })) {
                Text("Tylko własne").tag("own")
                Text("Wszystkie dostępne w firmie").tag("all")
            }
            .disabled(targetIsAdmin)
            if module == "events" {
                Text("Uprawnienie „Zarządzanie magazynem” daje dodatkowo dostęp do zaakceptowanych realizacji przypisanych marek.").font(.caption).foregroundStyle(.secondary)
            }
            Text("Własne: utworzone przez pracownika lub przypisane mu jako opiekun/sprzedawca. Zakres dotyczy także edycji i nie rozszerza dostępu do marek. Uprawnienia do działań ustawiasz osobno.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func tabs(_ title: String, _ detail: String, _ options: [ValueOption], _ path: WritableKeyPath<PermissionDraft, [String]>, _ d: PermissionDraft) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.callout.weight(.medium))
            Text(detail).font(.caption).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), alignment: .topLeading)], alignment: .leading, spacing: 6) {
                ForEach(options) { option in
                    Toggle(isOn: Binding(get: { d[keyPath: path].contains(option.value) }, set: { _ in toggle(path, option.value) })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(option.label)
                            Text(option.description).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.checkbox)
                }
            }
        }
    }

    private func salesTeam(_ data: EmployeePermissionsData, _ d: PermissionDraft) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Zespół sprzedaży").font(.callout.weight(.medium))
            Text("Zespół ogranicza zakres widoku i zarządzania menedżera. Nie włącza automatycznie powiadomień.").font(.caption).foregroundStyle(.secondary)
            Picker("Zespół", selection: Binding(get: { d.salesTeamId }, set: { team in edit { $0.salesTeamId = team; if team.isEmpty { $0.isSalesTeamManager = false } } })) {
                Text("Bez zespołu").tag("")
                ForEach(data.salesTeams) { Text($0.name).tag($0.id) }
            }
            .labelsHidden().fixedSize()
            Toggle(isOn: Binding(get: { d.isSalesTeamManager }, set: { value in edit { $0.isSalesTeamManager = value } })) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Menedżer tego zespołu")
                    Text("Wymaga również uprawnienia „Zarządzanie zespołem”.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .toggleStyle(.checkbox).disabled(d.salesTeamId.isEmpty)
        }
    }

    private func extras(_ category: PermissionCategory, _ value: String, _ d: PermissionDraft) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(category.key == "mavinci_live" ? "Dostępne sekcje aplikacji" : "Dodatkowe uprawnienia").font(.callout.weight(.medium))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), alignment: .topLeading)], alignment: .leading, spacing: 6) {
                ForEach(category.extra) { extra in
                    let live = category.key == "mavinci_live"
                    let checked = targetIsAdmin || d.permissions.contains(extra.key) || (live && extra.key == "mavinci_live_light_magic" && value != "none")
                    Toggle(isOn: Binding(get: { checked }, set: { _ in toggleExtra(extra.key, d) })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(extra.label)
                            Text(extra.description).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.checkbox)
                    .disabled(targetIsAdmin || (live && value == "none") || (live && extra.key == "mavinci_live_light_magic"))
                }
            }
        }
    }
}
