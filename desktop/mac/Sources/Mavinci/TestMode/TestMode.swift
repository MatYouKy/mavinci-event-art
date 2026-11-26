import AppKit
import SwiftUI

// MARK: Tryb testowy „widok jako” (`docs/test-mode.md`)
//
// Administrator sprawdza, co widzi wybrany pracownik i jakie ma funkcje — czy uprawnienia nie są za duże albo za małe.
// Ustawienia (⌘,) → „Tryb testowy” → „Wejdź jako”: serwer CRM (`/bridge/test-mode/start`) otwiera sesję testową, a aplikacja
// łączy się z bazą przez serwer CRM (`/bridge/test-mode/sb`) kluczem zastępczym tej osoby (`Workspace.enterTestMode`):
// odczyt jak u niej, zapis do bazy sprawdzany i wycofywany, pliki, funkcje serwera i operacje zapisujące natywnego API
// wyłączone (423 → `AppError.testMode`). Sesja administratora zostaje w pęku kluczy, jego kopie danych i Finder — bez zmian.
// Na górze każdego okna pasek „Tryb testowy · widok: …” z „Wyjdź z trybu” (`TestModeBanner`); wyjście
// (`Workspace.exitTestMode`) kończy sesję na serwerze, usuwa z dysku kopie danych oglądanej osoby i przywraca administratora.
// Sprzedawców zewnętrznych (portal `/seller`) sprawdza się w CRM w przeglądarce.

/// Trwający tryb testowy: kogo oglądamy i do kiedy (serwer kończy sesję po 8 godzinach).
struct TestModeInfo: Equatable {
    let id: String
    let label: String
    let expiresAt: Date
}

/// Odpowiedź `/bridge/test-mode/start` dla aplikacji natywnej.
struct TestModeStartReply: Decodable {
    let id: String
    let kind: String
    let label: String
    let landing: String
    /// Ścieżka serwera CRM, przez którą idą zapytania do bazy (`/bridge/test-mode/sb`).
    let proxy: String
    /// Koniec sesji testowej (sekundy).
    let expires_at: Double
    /// Sesja zastępcza (klucz zastępczy; odświeżanie przez `proxy`).
    let session: Session
}

/// Pracownik do obejrzenia (`test_mode_targets` — aktywni, z kontem, bez administratorów i bez siebie).
struct TestModeTarget: Decodable, Identifiable, Hashable {
    let id: String
    let name: String?
    let nickname: String?
    let avatar_url: String?
    let occupation: String?
    let department: String?
    let role: String?
    let access_level: String?
    let permissions: Int?
    /// Od migracji `20261202120000_test_mode_target_details.sql` (karta pracownika — `TestModePersonCard`).
    let email: String?
    let phone: String?
    let supervisor: String?
    let last_active_at: String?
    let permission_keys: [String]?
    let avatar_metadata: TestModeAvatarMetadata?

    var crop: AvatarCrop? { avatar_metadata?.crop }
    var displayName: String { name?.isEmpty == false ? name! : (nickname?.isEmpty == false ? nickname! : "Pracownik") }
    /// Dział jak w CRM (`teamAvailability.department`): pusty albo nieznany — Biuro.
    var departmentCode: String { ["management", "sales", "warehouse"].contains(department ?? "") ? department! : "office" }
    var details: String {
        var parts: [String] = []
        if let level = access_level, !level.isEmpty { parts.append(level) }
        if let count = permissions { parts.append(Self.permissionsText(count)) }
        if let occupation, !occupation.isEmpty { parts.append(occupation) }
        return parts.joined(separator: " · ")
    }
    /// „1 uprawnienie”, „3 uprawnienia”, „12 uprawnień”.
    static func permissionsText(_ count: Int) -> String {
        if count == 1 { return "1 uprawnienie" }
        let few = (2...4).contains(count % 10) && !(12...14).contains(count % 100)
        return few ? "\(count) uprawnienia" : "\(count) uprawnień"
    }
}

/// Kadrowanie zdjęcia z `avatar_metadata.desktop` (jak `EmployeeAvatar` w CRM); nieczytelne dane — bez kadrowania.
struct TestModeAvatarMetadata: Decodable, Hashable {
    var crop: AvatarCrop?
    init(from decoder: Decoder) throws {
        struct Position: Decodable { let posX: Double?; let posY: Double?; let scale: Double? }
        struct Side: Decodable { let position: Position?; let objectFit: String? }
        struct Raw: Decodable { let desktop: Side? }
        if let side = (try? Raw(from: decoder))?.desktop, let position = side.position {
            crop = AvatarCrop(x: position.posX ?? 0, y: position.posY ?? 0, scale: position.scale ?? 1, fit: side.objectFit)
        } else {
            crop = nil
        }
    }
}

/// Nazwy uprawnień jak w CRM (`GET /bridge/native/v1/permission-labels` — `src/lib/permissionCatalog.ts`).
struct TestModePermissionCatalog: Decodable {
    struct Scope: Decodable, Hashable { let key: String; let label: String; let description: String }
    struct Group: Decodable { let key: String; let label: String; let scopes: [Scope] }
    let groups: [Group]
}

/// Uprawnienia pracownika w grupach jak w edytorze uprawnień CRM; nieznane (albo bez słownika) — „Inne”.
struct TestModePermissionGroup: Identifiable {
    let id: String
    let label: String
    let scopes: [TestModePermissionCatalog.Scope]

    static func groups(_ keys: [String], catalog: TestModePermissionCatalog?) -> [TestModePermissionGroup] {
        let owned = Set(keys)
        var known = Set<String>()
        var result: [TestModePermissionGroup] = []
        for group in catalog?.groups ?? [] {
            let scopes = group.scopes.filter { owned.contains($0.key) && !known.contains($0.key) }
            scopes.forEach { known.insert($0.key) }
            if !scopes.isEmpty { result.append(TestModePermissionGroup(id: group.key, label: group.label, scopes: scopes)) }
        }
        let other = keys.filter { !known.contains($0) }
        if !other.isEmpty {
            let scopes = other.map { key in
                TestModePermissionCatalog.Scope(key: key, label: key == "admin" ? "Pełny dostęp administratora" : (catalog == nil ? key : "Dodatkowe uprawnienie"), description: key)
            }
            result.append(TestModePermissionGroup(id: "other", label: "Inne", scopes: scopes))
        }
        return result
    }
}

/// Dział z pracownikami do obejrzenia (kolejność jak w CRM: Zarząd, Sprzedaż, Biuro, Magazyn).
struct TestModeGroup: Identifiable {
    let id: String
    let label: String
    let people: [TestModeTarget]
}

/// Sprzedawca zewnętrzny z portalem — na Macu tylko liczba (widok portalu sprawdza się w przeglądarce).
struct TestModeSellerTarget: Decodable, Identifiable {
    let id: String
    let name: String?
}

struct TestModeTargets: Decodable {
    let employees: [TestModeTarget]
    let sellers: [TestModeSellerTarget]
}

/// Wpis dziennika wejść (`test_mode_history`).
struct TestModeHistoryRow: Decodable, Identifiable {
    let id: String
    let admin: String?
    let kind: String
    let target: String
    let started_at: String
    let ended_at: String?
    let end_reason: String?
    let active: Bool

    var endText: String {
        if active { return "Trwa" }
        switch end_reason ?? "" {
        case "exit": return "Wyjście z trybu"
        case "expired": return "Wygasła"
        case "replaced": return "Zastąpiona nowym wejściem"
        case "rollback_unconfirmed": return "Przerwana (baza nie potwierdziła wycofania zapisu)"
        default: return "Zakończona"
        }
    }
}

// MARK: Serwer CRM

enum TestModeAPI {
    private static let http: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 60; c.timeoutIntervalForResource = 120; c.httpShouldSetCookies = false
        return URLSession(configuration: c)
    }()

    private static func request(_ crm: String, _ path: String, token: String, body: [String: JSONValue]) throws -> URLRequest {
        guard let url = URL(string: crm.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else { throw AppError.configuration }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        req.setValue("MavinciDesktop/0.1", forHTTPHeaderField: "User-Agent")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(body)
        return req
    }

    /// Wejście w widok pracownika kluczem administratora.
    static func start(crm: String, adminToken: String, employeeID: String) async throws -> TestModeStartReply {
        let req = try request(crm, "/bridge/test-mode/start", token: adminToken, body: ["kind": .string("employee"), "id": .string(employeeID)])
        let (data, response) = try await http.data(for: req)
        guard let status = (response as? HTTPURLResponse)?.statusCode else { throw AppError.invalidResponse }
        guard (200..<300).contains(status) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw NativeFailure(status: status, message: object?["error"] as? String ?? "Serwer CRM nie włączył trybu testowego (\(status)).", fieldErrors: [:])
        }
        return try JSONDecoder().decode(TestModeStartReply.self, from: data)
    }

    /// Zakończenie sesji testowej na serwerze (klucz zastępczy) — bez czekania na wynik dłużej niż kilka sekund; serwer i tak
    /// kończy sesję po 8 godzinach.
    static func exit(crm: String, token: String) async {
        guard var req = try? request(crm, "/bridge/test-mode/exit", token: token, body: [:]) else { return }
        req.timeoutInterval = 10
        _ = try? await http.data(for: req)
    }

    static func message(for error: Error) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Sprawdź internet i spróbuj ponownie." }
        return friendlyError(error)
    }
}

// MARK: Kopie danych oglądanej osoby

enum TestModeStorage {
    /// Przestrzeń nazw trwającego trybu testowego — gdy aplikacja zamknie się w trakcie, kopie znikają przy następnym starcie.
    private static let pendingKey = "testModeNamespace"

    static func remember(namespace: String) { UserDefaults.standard.set(namespace, forKey: pendingKey) }

    /// Kopie z trybu testowego, który nie zakończył się wyjściem (zamknięcie aplikacji) — usuwane i zapominane.
    static func purgeLeftover() {
        guard let namespace = UserDefaults.standard.string(forKey: pendingKey) else { return }
        purge(namespace: namespace)
        UserDefaults.standard.removeObject(forKey: pendingKey)
    }

    /// Usuwa z dysku wszystko, co sekcje zapisały w przestrzeni nazw sesji testowej (kopie zbiorów, kart, poczty, miniatur),
    /// i ich klucze szyfrujące z pęku kluczy.
    static func purge(namespace: String) {
        guard namespace.count >= 32 else { return }
        let manager = FileManager.default
        let root = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Mavinci/Desktop/v1", isDirectory: true)
        let entries = (try? manager.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        for entry in entries {
            if entry.lastPathComponent.contains(namespace) { try? manager.removeItem(at: entry); continue }
            guard (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true else { continue }
            for child in (try? manager.contentsOfDirectory(at: entry, includingPropertiesForKeys: nil)) ?? [] where child.lastPathComponent.contains(namespace) {
                try? manager.removeItem(at: child)
            }
        }
        try? Vault.deleteKeys { $0.contains(namespace) }
    }
}

// MARK: Pasek „Wyjdź z trybu” (na górze, na środku każdego okna)

/// Kolory paska jak w CRM (`TestModeBar.tsx`): ciemny bursztyn, jasny tekst, przycisk w kolorze akcentu.
private enum TestModeColors {
    static let background = CrmTheme.rgb(0x2a1d05)
    static let accent = CrmTheme.rgb(0xfcd34d)
    static let text = CrmTheme.rgb(0xfef3c7)
    static let buttonText = CrmTheme.rgb(0x1c1405)
}

struct TestModeBanner: View {
    @EnvironmentObject private var state: Workspace

    var body: some View {
        if let info = state.testMode {
            HStack(spacing: 10) {
                Image(systemName: "testtube.2").foregroundStyle(TestModeColors.accent).accessibilityHidden(true)
                HStack(spacing: 4) {
                    Text("TRYB TESTOWY").kerning(0.6).foregroundStyle(TestModeColors.accent)
                    Text("· widok: \(info.label)").foregroundStyle(TestModeColors.text)
                    Text("· zmiany nie są zapisywane").foregroundStyle(TestModeColors.text.opacity(0.65))
                }
                .font(.callout).lineLimit(1).truncationMode(.middle)
                Button { Task { await state.exitTestMode() } } label: {
                    HStack(spacing: 5) {
                        if state.testSwitching { ProgressView().controlSize(.mini) } else { Image(systemName: "rectangle.portrait.and.arrow.right") }
                        Text("Wyjdź z trybu").fontWeight(.semibold)
                    }
                    .font(.caption)
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .background(TestModeColors.accent, in: Capsule())
                    .foregroundStyle(TestModeColors.buttonText)
                }
                .buttonStyle(.plain)
                .disabled(state.testSwitching)
                .help("Kończy tryb testowy i wraca do Twojego widoku")
            }
            .padding(.leading, 14).padding(.trailing, 5).padding(.vertical, 5)
            .background(TestModeColors.background.opacity(0.96), in: Capsule())
            .overlay(Capsule().strokeBorder(TestModeColors.accent.opacity(0.6), lineWidth: 1))
            .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Tryb testowy, widok: \(info.label)")
        }
    }
}

// MARK: Ustawienia → „Tryb testowy”

struct TestModeSettings: View {
    @EnvironmentObject private var state: Workspace
    @State private var targets: [TestModeTarget] = []
    @State private var sellerCount = 0
    @State private var history: [TestModeHistoryRow] = []
    @State private var loading = false
    @State private var loaded = false
    @State private var failure: String?
    @State private var startFailure: String?
    @State private var query = ""
    @State private var starting: String?
    /// Karta pracownika (popover po kliknięciu zdjęcia lub nazwiska).
    @State private var shownCard: String?
    @State private var catalog: TestModePermissionCatalog?
    @Environment(\.openWindow) private var openWindow

    private static let departments: [(code: String, label: String)] = [
        ("management", "Zarząd"), ("sales", "Sprzedaż"), ("office", "Biuro"), ("warehouse", "Magazyn"),
    ]

    private var groups: [TestModeGroup] {
        let words = Self.folded(query).split(separator: " ").map(String.init)
        let visible = targets.filter { target in
            let fields: [String] = [target.name, target.nickname, target.occupation, target.access_level].compactMap { $0 }
            let haystack = Self.folded(fields.joined(separator: " "))
            return words.allSatisfy { haystack.contains($0) }
        }
        return Self.departments.map { department in
            let people = visible.filter { $0.departmentCode == department.code }
                .sorted { $0.displayName.localizedCompare($1.displayName) == .orderedAscending }
            return TestModeGroup(id: department.code, label: department.label, people: people)
        }.filter { !$0.people.isEmpty }
    }

    var body: some View {
        Form {
            Section {
                Text("Sprawdź, co widzi wybrany pracownik i jakie ma funkcje — czy uprawnienia nie są za duże albo za małe. Zapis do bazy w trybie testowym jest sprawdzany i od razu wycofywany: ta osoba niczego nie zobaczy, a po wyjściu z trybu nic nie zostaje. Pliki, wysyłka wiadomości i operacje serwera są wyłączone. Tryb kończy się sam po 8 godzinach.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let info = state.testMode {
                Section("Trwa tryb testowy") {
                    LabeledContent("Widok", value: info.label)
                    LabeledContent("Koniec najpóźniej", value: info.expiresAt.formatted(date: .abbreviated, time: .shortened))
                    Button { Task { await state.exitTestMode() } } label: { Label("Wyjdź z trybu", systemImage: "rectangle.portrait.and.arrow.right") }
                        .disabled(state.testSwitching)
                }
            } else if state.employee?.isAdmin == true {
                if let startFailure {
                    Section { Label(startFailure, systemImage: "exclamationmark.triangle").foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                }
                Section("Pracownicy") {
                    TextField("Szukaj pracownika", text: $query).textFieldStyle(.roundedBorder)
                    if loading && !loaded {
                        HStack { ProgressView().controlSize(.small); Text("Wczytywanie…").foregroundStyle(.secondary) }
                    } else if let failure {
                        Text(failure).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                        Button("Spróbuj ponownie") { Task { await load() } }
                    } else if groups.isEmpty {
                        Text(targets.isEmpty ? "Brak pracowników do obejrzenia (bez administratorów i bez Ciebie)." : "Nikt nie pasuje do wyszukiwania.")
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(groups) { group in
                    Section(group.label) {
                        ForEach(group.people) { person in row(person) }
                    }
                }
                Section("Sprzedawcy zewnętrzni") {
                    Text(sellerCount == 0 ? "Widok portalu sprzedawcy sprawdzisz w CRM w przeglądarce." : "Widok portalu sprzedawcy (\(sellerCount)) sprawdzisz w CRM w przeglądarce.")
                        .foregroundStyle(.secondary)
                    Button { state.openCRM("/crm/settings?tab=test") } label: { Label("Otwórz w przeglądarce", systemImage: "arrow.up.right.square") }
                }
                if !history.isEmpty {
                    Section("Dziennik wejść") {
                        ForEach(history) { entry in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(entry.admin ?? "Administrator") → \(entry.target)").lineLimit(1)
                                Text("\(Self.when(entry.started_at)) · \(entry.endText)").font(.caption).foregroundStyle(entry.active ? .orange : .secondary)
                            }
                        }
                    }
                }
            } else {
                Section { Text("Tryb testowy jest dostępny tylko dla administratora.").foregroundStyle(.secondary) }
            }
        }
        .formStyle(.grouped)
        .task(id: state.employee?.id) { await load() }
    }

    private func row(_ person: TestModeTarget) -> some View {
        HStack(spacing: 10) {
            Button { shownCard = shownCard == person.id ? nil : person.id } label: {
                HStack(spacing: 10) {
                    EmployeeAvatarView(name: person.displayName, url: person.avatar_url, crop: person.crop, size: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(person.displayName).lineLimit(1)
                        if !person.details.isEmpty { Text(person.details).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Karta pracownika")
            .popover(isPresented: Binding(get: { shownCard == person.id }, set: { if !$0, shownCard == person.id { shownCard = nil } }), arrowEdge: .trailing) {
                TestModePersonCard(
                    person: person,
                    catalog: catalog,
                    department: Self.departments.first { $0.code == person.departmentCode }?.label ?? "Biuro",
                    entering: starting == person.id,
                    canEnter: starting == nil && state.testMode == nil && state.canWrite,
                    onOpen: { openEmployee(person) },
                    onEnter: { shownCard = nil; Task { await start(person) } }
                )
            }
            Spacer(minLength: 8)
            Button {
                Task { await start(person) }
            } label: {
                if starting == person.id { ProgressView().controlSize(.small) } else { Label("Wejdź jako", systemImage: "person.badge.key") }
            }
            .disabled(starting != nil || state.testMode != nil || !state.canWrite)
        }
    }

    /// Karta pracownika w nowej karcie głównego okna (ekran Zespołu); bez Zespołu w menu — CRM w przeglądarce.
    private func openEmployee(_ person: TestModeTarget) {
        shownCard = nil
        if state.navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/employees" }) {
            state.openInWindow(.employee(person.id), asTab: true, using: openWindow)
        } else {
            state.openCRM("/crm/employees/\(person.id)")
        }
    }

    private func start(_ person: TestModeTarget) async {
        starting = person.id
        startFailure = nil
        startFailure = await state.enterTestMode(employeeID: person.id)
        starting = nil
    }

    private func load() async {
        guard state.testMode == nil, state.employee?.isAdmin == true, let api = state.eventAPI(), !loading else { return }
        loading = true
        failure = nil
        defer { loading = false }
        do {
            let data = try await api.request("/rest/v1/rpc/test_mode_targets", body: [:])
            let reply = try JSONDecoder().decode(TestModeTargets.self, from: data)
            targets = reply.employees
            sellerCount = reply.sellers.count
            loaded = true
        } catch AppError.server {
            failure = "Nie udało się wczytać listy. Tryb testowy wymaga migracji 20261202100000_crm_test_mode.sql."
        } catch {
            failure = friendlyError(error)
        }
        if let data = try? await api.request("/rest/v1/rpc/test_mode_history", body: ["p_limit": .number(20)]),
           let rows = try? JSONDecoder().decode([TestModeHistoryRow].self, from: data) {
            history = rows
        }
        if catalog == nil, let native = state.nativeAPI(), let data = try? await native.get("/permission-labels") {
            catalog = try? JSONDecoder().decode(TestModePermissionCatalog.self, from: data)
        }
    }

    private static func folded(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
            .replacingOccurrences(of: "ł", with: "l").replacingOccurrences(of: "Ł", with: "l").lowercased()
    }

    /// Znacznik czasu z bazy (do 6 cyfr ułamka sekundy — `ChatDates.parse`).
    private static func when(_ raw: String) -> String {
        guard let date = ChatDates.parse(raw) else { return raw }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: Karta pracownika (popover na liście „Tryb testowy”)

/// Większe zdjęcie i dane pracownika jak `TestModePersonPopover` w CRM: dział, poziom dostępu, rola, przełożony, kontakt
/// służbowy, ostatnia aktywność, uprawnienia; „Otwórz kartę pracownika” (nowa karta okna) i „Wejdź jako”.
struct TestModePersonCard: View {
    let person: TestModeTarget
    let catalog: TestModePermissionCatalog?
    let department: String
    let entering: Bool
    let canEnter: Bool
    let onOpen: () -> Void
    let onEnter: () -> Void

    private var groups: [TestModePermissionGroup] { TestModePermissionGroup.groups(person.permission_keys ?? [], catalog: catalog) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 14) {
                EmployeeAvatarView(name: person.displayName, url: person.avatar_url, crop: person.crop, size: 96)
                VStack(alignment: .leading, spacing: 3) {
                    Text(person.displayName).font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    if let nickname = person.nickname, !nickname.isEmpty, nickname != person.displayName {
                        Text("„\(nickname)”").foregroundStyle(.secondary)
                    }
                    if let occupation = person.occupation, !occupation.isEmpty { Text(occupation).foregroundStyle(.tint) }
                }
            }
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                info("Dział", department)
                info("Poziom dostępu", person.access_level?.isEmpty == false ? person.access_level! : "—")
                info("Rola", person.role?.isEmpty == false ? TeamLabels.role(person.role!) : "—")
                info("Przełożony", person.supervisor ?? "—")
                GridRow {
                    Text("E-mail").foregroundStyle(.secondary)
                    if let email = person.email, let url = URL(string: "mailto:\(email)") { Link(email, destination: url) } else { Text("—") }
                }
                GridRow {
                    Text("Telefon").foregroundStyle(.secondary)
                    if let phone = person.phone, let url = URL(string: "tel:\(phone.filter { !$0.isWhitespace })") { Link(phone, destination: url) } else { Text("—") }
                }
                info("Ostatnio aktywny", lastActive)
            }
            .font(.callout)
            Divider()
            Text("Uprawnienia (\(person.permissions ?? 0))").font(.caption).textCase(.uppercase).foregroundStyle(.secondary)
            if groups.isEmpty {
                Text(person.permission_keys == nil ? "Lista uprawnień po migracji 20261202120000_test_mode_target_details.sql." : "Brak dodatkowych uprawnień — tylko to, co daje poziom dostępu.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(groups) { group in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(group.label).font(.caption).foregroundStyle(.tint)
                                WrapLayout(spacing: 4) {
                                    ForEach(group.scopes, id: \.self) { scope in
                                        Text(scope.label).font(.caption)
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 5))
                                            .help(scope.description)
                                    }
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 200)
            }
            Divider()
            HStack {
                Spacer()
                Button(action: onOpen) { Label("Otwórz kartę pracownika", systemImage: "arrow.up.forward.square") }
                Button(action: onEnter) {
                    if entering { ProgressView().controlSize(.small) } else { Label("Wejdź jako", systemImage: "person.badge.key") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canEnter)
            }
        }
        .padding(16)
        .frame(width: 400)
    }

    private var lastActive: String {
        guard let raw = person.last_active_at, let date = ChatDates.parse(raw) else { return "brak danych" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func info(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary)
            Text(value).lineLimit(2)
        }
    }
}
