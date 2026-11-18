import SwiftUI
import AppKit

// MARK: Stan systemu i jakość danych — jak `/crm/settings/system-health` (administrator)
// Integracje z ostatnich 24 godzin (`get_crm_system_health`), jakość danych (`get_crm_data_quality`), bezpieczeństwo
// (`get_crm_security_health`), szczegółowe listy (`get_crm_health_details`) i automatyczne alerty
// (`event_operational_alert_settings`) — te same funkcje bazy i uprawnienia co strona CRM (token pracownika, RLS).
// Odnośniki ze szczegółów otwierają rekordy na Macu (jak powiadomienia), SQL można skopiować.

struct HealthIssue: Identifiable {
    let key: String
    let label: String
    let description: String
    let fix: String
    var actionHref: String?
    var actionLabel: String?
    var id: String { key }

    static let data: [HealthIssue] = [
        HealthIssue(key: "duplicate_contact_emails", label: "Powielone adresy e-mail kontaktów", description: "Kilka kart klienta używa tego samego adresu e-mail.", fix: "Porównaj historię rekordów, wybierz kartę główną i scal dane albo popraw błędny adres.", actionHref: "/crm/contacts", actionLabel: "Otwórz kontakty"),
        HealthIssue(key: "duplicate_contact_phones", label: "Powielone numery telefonów", description: "Ten sam numer telefonu występuje na kilku kartach.", fix: "Sprawdź, czy to duplikat tej samej osoby, numer wspólny firmy czy poprawne powiązanie rodzinne.", actionHref: "/crm/contacts", actionLabel: "Otwórz kontakty"),
        HealthIssue(key: "duplicate_organization_nips", label: "Powielone numery NIP", description: "Więcej niż jedna organizacja ma ten sam NIP.", fix: "Zachowaj organizację posiadającą pełną historię i przenieś do niej kontakty oraz aktywności.", actionHref: "/crm/contacts", actionLabel: "Otwórz organizacje"),
        HealthIssue(key: "upcoming_events_missing_contact", label: "Nadchodzące wydarzenia bez klienta", description: "Wydarzenie w ciągu 60 dni nie ma osoby kontaktowej ani organizacji.", fix: "Otwórz wydarzenie i przypisz klienta, aby dokumenty, wiadomości i rozliczenia miały właściciela.", actionHref: "/crm/events", actionLabel: "Otwórz eventy"),
        HealthIssue(key: "upcoming_events_missing_location", label: "Nadchodzące wydarzenia bez miejsca", description: "Wydarzenie w ciągu 60 dni nie ma uzupełnionej lokalizacji.", fix: "Dodaj miejsce realizacji — jest potrzebne dla logistyki, floty, pracowników i sprzętu.", actionHref: "/crm/events", actionLabel: "Otwórz eventy"),
        HealthIssue(key: "upcoming_events_missing_owner", label: "Nadchodzące wydarzenia bez opiekuna", description: "Wydarzenie nie ma autora lub właściciela odpowiedzialnego za proces.", fix: "Przypisz administratora albo właściwego opiekuna sprzedażowego.", actionHref: "/crm/events", actionLabel: "Otwórz eventy"),
        HealthIssue(key: "inactive_employees_on_future_events", label: "Nieaktywni pracownicy w przyszłych wydarzeniach", description: "Nieaktywny pracownik pozostaje przypisany do przyszłej realizacji.", fix: "Zastąp go aktywnym pracownikiem i sprawdź zadania, flotę oraz odpowiedzialności.", actionHref: "/crm/employees", actionLabel: "Otwórz pracowników"),
    ]
    static let security: [HealthIssue] = [
        HealthIssue(key: "tables_without_rls", label: "Tabele publiczne bez RLS", description: "Tabela w schemacie public nie ma włączonego Row Level Security.", fix: "Najpierw przygotuj polityki dostępu, potem włącz RLS. Samo włączenie bez polityk może odciąć aplikację od danych."),
        HealthIssue(key: "public_storage_buckets", label: "Publiczne buckety plików", description: "Pliki można pobrać bez zalogowania, jeśli ktoś zna ich adres.", fix: "Pozostaw publiczne tylko zasoby świadomie publikowane, np. logotypy. Dokumenty CRM przenieś do bucketów prywatnych.", actionHref: "/crm/settings/storage", actionLabel: "Otwórz magazyn plików"),
        HealthIssue(key: "active_employees_without_auth_mapping", label: "Pracownicy bez powiązanego konta", description: "Aktywny rekord pracownika nie jest jednoznacznie połączony z użytkownikiem logowania.", fix: "Otwórz pracownika, połącz konto albo oznacz rekord jako nieaktywny, jeżeli nie powinien mieć dostępu.", actionHref: "/crm/employees", actionLabel: "Otwórz pracowników"),
        HealthIssue(key: "security_definer_without_fixed_search_path", label: "Funkcje uprzywilejowane bez stałej ścieżki", description: "Funkcja SECURITY DEFINER nie ma jawnie ustawionego search_path.", fix: "Ustaw search_path dla każdej funkcji po sprawdzeniu, z jakich schematów korzysta. Gotowy SQL jest pokazany poniżej."),
    ]
}

/// Pozycja szczegółowej listy (`get_crm_health_details`): tytuł, opis, odnośnik, SQL i rekordy.
struct HealthDetailItem: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let href: String
    let sql: String
    let records: [HealthDetailItem]
    init(_ value: JSONValue, index: Int) {
        let o = value.object
        id = o["id"]?.text.nonEmpty ?? "\(index)"
        title = o["title"]?.text ?? ""
        subtitle = o["subtitle"]?.text ?? ""
        href = o["href"]?.text ?? ""
        sql = o["sql"]?.text ?? ""
        records = (o["records"]?.array ?? []).enumerated().map { HealthDetailItem($0.element, index: $0.offset) }
    }
}

@MainActor final class SystemHealthModel: ObservableObject {
    struct Service: Identifiable { let key: String; let label: String; let failed: Int; let pending: Int; var id: String { key } }
    @Published var loading = false
    @Published var problem: String?
    @Published var unavailable = false
    @Published var services: [Service] = []
    @Published var quality: [String: Int] = [:]
    @Published var security: [String: Int] = [:]
    @Published var detailsAvailable = true
    @Published var qualityDetails: [String: [HealthDetailItem]] = [:]
    @Published var securityDetails: [String: [HealthDetailItem]] = [:]
    @Published var settings: [String: JSONValue]?
    @Published var alertsActive = false
    @Published var saving = false
    @Published var loaded = false

    var totalProblems: Int {
        services.reduce(0) { $0 + $1.failed + $1.pending } + quality.values.reduce(0, +) + security.values.reduce(0, +)
    }

    private static func number(_ value: JSONValue?) -> Int {
        guard let value else { return 0 }
        if case .number(let n) = value { return Int(n) }
        return Int(value.text) ?? 0
    }

    func load(_ workspace: Workspace) async {
        guard workspace.connection.provider == .supabase, let backend = workspace.nativeAPI()?.backend else {
            problem = "Stan systemu wymaga połączenia aplikacji z bazą CRM (Supabase)."
            return
        }
        loading = true; problem = nil
        defer { loading = false }
        func rpc(_ name: String) async throws -> JSONValue {
            try JSONDecoder().decode(JSONValue.self, from: try await backend.request("/rest/v1/rpc/\(name)", method: "POST", body: [:]))
        }
        do {
            async let system = rpc("get_crm_system_health")
            async let data = rpc("get_crm_data_quality")
            async let safety = rpc("get_crm_security_health")
            async let rows = backend.request("/rest/v1/event_operational_alert_settings", query: [
                URLQueryItem(name: "select", value: "*"), URLQueryItem(name: "order", value: "updated_at.desc"), URLQueryItem(name: "limit", value: "1"),
            ])
            let (systemValue, dataValue, safetyValue, rowsData) = try await (system, data, safety, rows)
            services = (systemValue.object["services"]?.array ?? []).map {
                let o = $0.object
                return Service(key: o["key"]?.text ?? UUID().uuidString, label: o["label"]?.text ?? "", failed: Self.number(o["failed"]), pending: Self.number(o["pending"]))
            }
            quality = dataValue.object.mapValues { Self.number($0) }
            security = safetyValue.object.mapValues { Self.number($0) }
            let alertRows = (try? JSONDecoder().decode([[String: JSONValue]].self, from: rowsData)) ?? []
            settings = alertRows.first
            alertsActive = settings?["is_active"]?.flag ?? false
            unavailable = false
        } catch AppError.forbidden {
            problem = "Ten obszar jest dostępny wyłącznie dla administratora."
            return
        } catch {
            // Funkcje kontroli operacyjnej (migracja 20260828130000) — brak w bazie albo inny błąd serwera.
            if (error as? AppError) == .server { unavailable = true } else { problem = friendlyError(error) }
            return
        }
        do {
            let details = try await rpc("get_crm_health_details").object
            qualityDetails = (details["data_quality"]?.object ?? [:]).mapValues { $0.array.enumerated().map { HealthDetailItem($0.element, index: $0.offset) } }
            securityDetails = (details["security"]?.object ?? [:]).mapValues { $0.array.enumerated().map { HealthDetailItem($0.element, index: $0.offset) } }
            detailsAvailable = true
        } catch {
            detailsAvailable = false
        }
        loaded = true
    }

    /// Zapis jak „Zapisz ustawienia” w CRM: dni przypomnień bez zmian, alerty tylko dla autora wydarzenia.
    func save(_ workspace: Workspace) async {
        guard let settings, let id = settings["id"]?.text.nonEmpty, let backend = workspace.nativeAPI()?.backend else { return }
        saving = true
        defer { saving = false }
        var body: [String: JSONValue] = [
            "repeat_overdue_daily": settings["repeat_overdue_daily"] ?? .bool(false),
            "alert_owner": .bool(true), "alert_event_managers": .bool(false), "alert_admins": .bool(false),
            "is_active": .bool(alertsActive), "updated_at": .string(ISO8601DateFormatter().string(from: Date())),
        ]
        if let days = settings["reminder_days"] { body["reminder_days"] = days }
        if let days = settings["payment_reminder_days"] { body["payment_reminder_days"] = days }
        do {
            _ = try await backend.request("/rest/v1/event_operational_alert_settings", method: "PATCH",
                                          query: [URLQueryItem(name: "id", value: "eq.\(id)")], body: body)
            workspace.succeed("Ustawienia alertów zostały zapisane")
            await load(workspace)
        } catch {
            workspace.error = "Nie udało się zapisać ustawień alertów."
        }
    }
}

@MainActor struct SystemHealthView: View {
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = SystemHealthModel()

    /// Security Advisor projektu w panelu Supabase.
    private var advisorHref: String? {
        guard let host = URL(string: state.connection.url)?.host, let ref = host.split(separator: ".").first, host.hasSuffix("supabase.co") else { return nil }
        return "https://supabase.com/dashboard/project/\(ref)/advisors/security"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Stan systemu i jakość danych").font(.title2.weight(.light))
                    Text("Integracje, dane, bezpieczeństwo i alerty operacyjne w jednym miejscu").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { Task { await model.load(state) } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(model.loading)
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) { content }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minWidth: 860, idealWidth: 980, minHeight: 640, idealHeight: 780)
        .background(theme.page)
        .task { await model.load(state) }
    }

    @ViewBuilder private var content: some View {
        if let problem = model.problem {
            Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
        } else if model.unavailable {
            VStack(alignment: .leading, spacing: 6) {
                Text("Najpierw wykonaj migrację kontroli operacyjnej").font(.headline)
                Text("Plik: 20260828130000_complete_event_operational_controls.sql").font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        } else if !model.loaded {
            ProgressView().frame(maxWidth: .infinity, minHeight: 200)
        } else {
            summary
            integrations
            if !model.detailsAvailable {
                Text("Liczniki działają, ale szczegółowe listy wymagają migracji 20260828170000_add_system_health_drilldowns.sql.")
                    .font(.callout).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
            HStack(alignment: .top, spacing: 18) {
                section("Jakość danych", symbol: "cylinder.split.1x2") {
                    ForEach(HealthIssue.data) { issue in
                        HealthIssueRow(issue: issue, count: model.quality[issue.key] ?? 0, details: model.qualityDetails[issue.key] ?? [], danger: false)
                    }
                }
                section("Bezpieczeństwo", symbol: "checkmark.shield") {
                    ForEach(HealthIssue.security) { base in
                        let issue = securityIssue(base)
                        HealthIssueRow(issue: issue, count: model.security[issue.key] ?? 0, details: model.securityDetails[issue.key] ?? [], danger: true)
                    }
                }
            }
            if model.settings != nil { alerts }
        }
    }

    private func securityIssue(_ base: HealthIssue) -> HealthIssue {
        var issue = base
        if issue.actionHref == nil, let advisorHref { issue.actionHref = advisorHref; issue.actionLabel = "Otwórz Security Advisor" }
        return issue
    }

    private var summary: some View {
        let total = model.totalProblems
        return HStack(spacing: 14) {
            Image(systemName: total > 0 ? "exclamationmark.triangle.fill" : "checkmark.circle.fill").font(.system(size: 30))
                .foregroundStyle(total > 0 ? Color.orange : Color.green)
            VStack(alignment: .leading, spacing: 3) {
                Text(total > 0 ? "\(total) obszarów wymaga uwagi" : "System nie wykrył bieżących problemów").font(.headline)
                Text("Krytyczne awarie integracji generują osobne powiadomienie dla administratorów.").font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
        .background((total > 0 ? Color.orange : Color.green).opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private var integrations: some View {
        section("Integracje — ostatnie 24 godziny", symbol: "arrow.triangle.2.circlepath") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 10)], spacing: 10) {
                ForEach(model.services) { service in
                    let healthy = service.failed == 0 && service.pending == 0
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(service.label).font(.callout)
                            Spacer()
                            Circle().fill(healthy ? Color.green : service.failed > 0 ? Color.red : Color.orange).frame(width: 9, height: 9)
                        }
                        HStack(spacing: 4) {
                            Text("Błędy:").foregroundStyle(.secondary)
                            Text("\(service.failed)").foregroundStyle(service.failed > 0 ? Color.red : Color.green)
                            Text("· Zablokowane:").foregroundStyle(.secondary)
                            Text("\(service.pending)").foregroundStyle(service.pending > 0 ? Color.orange : Color.green)
                        }
                        .font(.caption)
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
                }
            }
        }
    }

    private var alerts: some View {
        section("Automatyczne alerty", symbol: "bell.badge") {
            Text("Przypomnienia o procesie otrzymuje wyłącznie autor wydarzenia. Zbiorcze podsumowanie wysyłane jest raz dziennie od 9:00; nowy krytyczny problem przed wydarzeniem może wywołać jedno dodatkowe powiadomienie. Zarządzaj odroczeniem przy następnym kroku wydarzenia.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Toggle("Automatyczne alerty aktywne", isOn: $model.alertsActive).toggleStyle(.checkbox)
            Button { Task { await model.save(state) } } label: { Label("Zapisz ustawienia", systemImage: "square.and.arrow.down") }
                .buttonStyle(.borderedProminent).disabled(model.saving || !state.canWrite)
        }
    }

    private func section<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol).font(.headline).foregroundStyle(theme.text)
            content()
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Wiersz problemu: licznik, a po rozwinięciu — co wykryto, jak poprawić, odnośnik i szczegółowa lista (rekordy, SQL).
@MainActor struct HealthIssueRow: View {
    let issue: HealthIssue
    let count: Int
    let details: [HealthDetailItem]
    let danger: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var open = false
    @State private var copied: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { if count > 0 { withAnimation(.easeOut(duration: 0.15)) { open.toggle() } } } label: {
                HStack(spacing: 10) {
                    Text(issue.label).font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(count)").font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 2)
                        .foregroundStyle(count > 0 ? (danger ? Color.red : Color.orange) : Color.green)
                        .background((count > 0 ? (danger ? Color.red : Color.orange) : Color.green).opacity(0.14), in: Capsule())
                    if count > 0 { Image(systemName: open ? "chevron.up" : "chevron.down").font(.caption).foregroundStyle(.tertiary) }
                }
                .padding(.horizontal, 10).padding(.vertical, 8).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open { expanded.padding([.horizontal, .bottom], 10) }
        }
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(open ? theme.accent.opacity(0.25) : Color.clear))
    }

    private var expanded: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Co wykryto").font(.caption.weight(.semibold))
                    Text(issue.description).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .topLeading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 4) {
                    Label("Jak poprawić", systemImage: "wrench.and.screwdriver").font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                    Text(issue.fix).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .topLeading).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            }
            if let href = issue.actionHref, let label = issue.actionLabel {
                Button { Task { await state.openLink(href) } } label: { Label(label, systemImage: "arrow.up.forward.app") }.controlSize(.small)
            }
            if details.isEmpty {
                Text("Szczegółowa lista nie jest jeszcze dostępna. Wykonaj migrację drill-down i odśwież ekran.")
                    .font(.caption).foregroundStyle(.tertiary).frame(maxWidth: .infinity).padding(.vertical, 12)
            }
            ForEach(details) { item in detail(item) }
        }
        .padding(.top, 4)
    }

    private func detail(_ item: HealthDetailItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    if !item.subtitle.isEmpty { Text(item.subtitle).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer()
                if !item.href.isEmpty { Button("Otwórz") { Task { await state.openLink(item.href) } }.controlSize(.small) }
            }
            if !item.records.isEmpty {
                VStack(spacing: 0) {
                    ForEach(item.records) { record in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(record.title).font(.caption).lineLimit(1)
                                if !record.subtitle.isEmpty { Text(record.subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                            }
                            Spacer()
                            if !record.href.isEmpty { Button("Sprawdź") { Task { await state.openLink(record.href) } }.buttonStyle(.link).font(.caption) }
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        Divider()
                    }
                }
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
            }
            if !item.sql.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Text(verbatim: item.sql).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button(copied == item.id ? "Skopiowano" : "Kopiuj SQL") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(item.sql, forType: .string)
                        copied = item.id
                    }
                    .controlSize(.small)
                }
                .padding(8).background(Color.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(10).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }
}
