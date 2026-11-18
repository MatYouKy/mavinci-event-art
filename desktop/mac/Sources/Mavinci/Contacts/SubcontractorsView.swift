import SwiftUI
import AppKit

// MARK: Podwykonawcy — 1:1 ze stronami `/crm/subcontractors` (lista z wyszukiwaniem), `/crm/subcontractors/new`
// (`SubcontractorProfileForm`) i kartą `/crm/subcontractors/[id]`: nagłówek (status, ocena, stawka), forma rozliczenia,
// zakładki Zakres i usługi, Szczegóły (kontakt, dane finansowe, statystyki, notatki), Zadania, Umowy (ramowe
// i projektowe); „Edytuj” — dane i rozliczenie (także dane do umowy zlecenia). Serwer: `/bridge/native/v1/subcontractors`
// (`list`, `card`, `personnel`, `save` — `src/lib/native/subcontractors.ts`). Zakres i usługi — `SubcontractorServicesView.swift`;
// rejestr umów zlecenia — na razie w CRM.

enum SubcontractorTab: String, CaseIterable, Identifiable {
    case services, details, tasks, contracts
    var id: String { rawValue }
}

/// Otwarta karta podwykonawcy (w sekcji Kontakty, zamiast listy).
struct SubcontractorRoute: Equatable {
    var id: String
    var tab: SubcontractorTab = .details
}

struct SubcontractorListItem: Decodable, Identifiable {
    var id: String
    var name: String
    var contactPerson: String
    var phone: String
    var email: String
    var services: [String]
    var settlementType: String
    var settlementLabel: String
    var status: String
}

struct SubcontractorCardData: Decodable {
    struct Subcontractor: Decodable {
        var id: String
        var name: String
        var contactPerson: String
        var email: String
        var phone: String
        var nip: String
        var address: String
        var hourlyRate: Double
        var paymentTerms: String
        var bankAccount: String
        var status: String
        var statusLabel: String
        var rating: Double?
        var notes: String
        var settlementType: String
        var settlementLabel: String
        var organizationId: String
    }
    struct Task: Decodable, Identifiable {
        var id: String
        var eventId: String
        var eventName: String
        var name: String
        var description: String
        var startDate: String?
        var endDate: String?
        var estimatedHours: Double
        var actualHours: Double
        var hourlyRate: Double
        var fixedPrice: Double
        var paymentType: String
        var totalCost: Double
        var status: String
        var statusLabel: String
        var invoiceNumber: String
        var paymentStatus: String
        var paymentStatusLabel: String
        var paymentDate: String?
    }
    struct Contract: Decodable, Identifiable {
        var id: String
        var number: String
        var type: String
        var title: String
        var description: String
        var startDate: String?
        var endDate: String?
        var totalValue: Double
        var hasFile: Bool
        var status: String
        var statusLabel: String
        var eventId: String
        var eventName: String
    }
    struct Personnel: Decodable { var view: Bool; var manage: Bool; var error: String }
    var subcontractor: Subcontractor
    var tasks: [Task]
    var contracts: [Contract]
    var personnel: Personnel
}

enum SubcontractorText {
    /// Formy rozliczenia do wyboru (`settlementLabels` bez „Inna forma”).
    static let settlements: [(String, String)] = [
        ("invoice_vat", "Faktura VAT"), ("invoice_no_vat", "Faktura bez VAT"), ("cash", "Gotówka"), ("civil_contract", "Umowa zlecenie"),
    ]
    /// Kolory statusów jak `getStatusColor` na karcie CRM.
    static func statusColor(_ status: String) -> Color {
        switch status {
        case "active", "completed", "paid": return CrmTheme.rgb(0x4ade80)
        case "blacklisted", "cancelled", "overdue": return CrmTheme.rgb(0xf87171)
        case "planned": return CrmTheme.rgb(0x60a5fa)
        case "in_progress", "pending": return CrmTheme.rgb(0xfacc15)
        default: return CrmTheme.rgb(0x9ca3af)
        }
    }
    /// Liczba jak `toLocaleString('pl-PL')` (do trzech miejsc po przecinku, z odstępami tysięcy).
    static func number(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 3
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
    /// Liczba jak w JavaScript bez formatowania (np. „150”, „4,5”).
    static func plain(_ value: Double) -> String { InvoiceMath.plain(value) }
    /// „RRRR-MM-DD…” → „DD.MM.RRRR” (`toLocaleDateString('pl-PL')`).
    static func date(_ value: String?) -> String {
        guard let value, value.range(of: "^\\d{4}-\\d{2}-\\d{2}", options: .regularExpression) != nil else { return "-" }
        // Znacznik czasu — dzień w czasie polskim (jak w przeglądarce w Polsce); sama data — bez przeliczania.
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var stamp = iso.date(from: value)
        if stamp == nil { iso.formatOptions = [.withInternetDateTime]; stamp = iso.date(from: value) }
        if value.count > 10, let parsed = stamp {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "pl_PL")
            formatter.timeZone = MeetingDates.zone
            formatter.dateFormat = "dd.MM.yyyy"
            return formatter.string(from: parsed)
        }
        let parts = value.prefix(10).split(separator: "-")
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }
    /// Typ rozliczenia zadania (w CRM wyświetlany kodem — tu po polsku).
    static func paymentType(_ value: String) -> String {
        switch value {
        case "fixed": return "Stała cena"
        case "hourly": return "Godzinowe"
        default: return value.isEmpty ? "-" : value
        }
    }
}

@MainActor private func subcontractorsAPI(_ state: Workspace) -> NativeAPI? { state.nativeAPI() }

private func subcontractorFailure(_ error: Error, _ fallback: String) -> String {
    if let failure = error as? NativeFailure { return failure.message }
    if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
    if let error = error as? AppError { return error.localizedDescription }
    return fallback
}

private struct SubcontractorBadge: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.caption).foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 4))
    }
}

// MARK: Lista

@MainActor struct SubcontractorsListView: View {
    @ObservedObject var store: ContactsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var rows: [SubcontractorListItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var query = ""
    @State private var creating = false

    private var visible: [SubcontractorListItem] {
        // Jak w CRM: tekst bez przycinania, wielkość liter bez znaczenia; nazwa, telefon, e-mail i nazwy usług.
        let needle = query.lowercased(with: Locale(identifier: "pl_PL"))
        return rows.filter { row in
            ([row.name, row.phone, row.email] + row.services).contains { $0.lowercased(with: Locale(identifier: "pl_PL")).contains(needle) || needle.isEmpty }
        }
    }

    var body: some View {
        Group {
            if loading && rows.isEmpty {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                            ForEach(visible) { row in tile(row) }
                        }
                        if visible.isEmpty && error == nil {
                            Text(rows.isEmpty ? "Brak podwykonawców." : "Brak wyników dla wpisanego tekstu.").foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity).padding(.vertical, 30)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .navigationTitle("Podwykonawcy")
        .navigationSubtitle("Kontakty")
        .searchable(text: $query, placement: .toolbar, prompt: "Nazwa, telefon, e-mail lub zakres usług")
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button { store.subcontractorsShown = false } label: { Label("Kontakty", systemImage: "chevron.left") }
                    .help("Wróć do listy kontaktów")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { creating = true } label: { Label("Dodaj podwykonawcę", systemImage: "plus") }
                Button { Task { await load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(loading)
            }
        }
        .task { await load() }
        .sheet(isPresented: $creating) {
            SubcontractorProfileSheet(initial: nil) { saved in
                store.showCreatedSubcontractor(saved, workspace: state)
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    private func tile(_ row: SubcontractorListItem) -> some View {
        Button { store.openedSubcontractor = SubcontractorRoute(id: row.id) } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(row.name).font(.headline).foregroundStyle(theme.accent).lineLimit(2)
                Text(row.services.isEmpty ? "Usługi do uzupełnienia" : row.services.joined(separator: " · ")).font(.callout).lineLimit(3)
                Text(row.phone.nonEmpty ?? row.email).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 6) {
                    Text(row.settlementLabel.nonEmpty ?? "Rozliczenie do ustalenia").font(.callout)
                    if row.status == "inactive" {
                        Text("Nieaktywny · do uzupełnienia").font(.callout).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
            .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        guard let api = subcontractorsAPI(state) else { return }
        loading = true
        defer { loading = false }
        struct Reply: Decodable { var subcontractors: [SubcontractorListItem] }
        do {
            rows = try JSONDecoder().decode(Reply.self, from: try await api.get("/subcontractors", query: ["op": "list"])).subcontractors
            error = nil
        } catch {
            self.error = subcontractorFailure(error, "Nie udało się pobrać podwykonawców.")
        }
    }
}

// MARK: Karta

@MainActor struct SubcontractorCardView: View {
    @ObservedObject var store: ContactsStore
    let route: SubcontractorRoute
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: SubcontractorCardData?
    @State private var loadError: String?
    @State private var tab: SubcontractorTab = .details
    @State private var editing = false

    var body: some View {
        Group {
            if let data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        header(data.subcontractor)
                        Picker("", selection: $tab) {
                            Text("Zakres i usługi").tag(SubcontractorTab.services)
                            Text("Szczegóły").tag(SubcontractorTab.details)
                            Text("Zadania (\(data.tasks.count))").tag(SubcontractorTab.tasks)
                            Text("Umowy (\(data.contracts.count))").tag(SubcontractorTab.contracts)
                        }
                        .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 620)
                        settlementLine(data.subcontractor)
                        switch tab {
                        case .services: services(data.subcontractor)
                        case .details: details(data)
                        case .tasks: tasks(data.tasks)
                        case .contracts: contracts(data)
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie można otworzyć podwykonawcy", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                    Button("Powrót do listy podwykonawców") { back() }
                }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(data?.subcontractor.name ?? "Podwykonawca")
        .navigationSubtitle("Karta podwykonawcy")
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button { back() } label: { Label("Powrót do listy podwykonawców", systemImage: "chevron.left") }
                    .help("Powrót do listy podwykonawców")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { Task { await load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
        }
        .task(id: route) {
            tab = route.tab
            await load()
        }
        .sheet(isPresented: $editing) {
            if let subcontractor = data?.subcontractor {
                SubcontractorProfileSheet(initial: subcontractor) { saved in
                    // Jak w CRM: po zapisie umowy zlecenia — zakładka Umowy.
                    if saved.settlementType == "civil_contract" { tab = .contracts }
                    Task { await load() }
                }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
    }

    private func back() {
        store.openedSubcontractor = nil
        store.subcontractorsShown = true
    }

    private func load() async {
        guard let api = subcontractorsAPI(state) else { return }
        do {
            data = try JSONDecoder().decode(SubcontractorCardData.self, from: try await api.get("/subcontractors", query: ["op": "card", "id": route.id]))
            loadError = nil
        } catch {
            loadError = subcontractorFailure(error, "Błąd podczas ładowania danych")
        }
    }

    private func header(_ sub: SubcontractorCardData.Subcontractor) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "person.2").font(.system(size: 26)).foregroundStyle(CrmTheme.rgb(0x60a5fa))
                .frame(width: 60, height: 60).background(CrmTheme.rgb(0x3b82f6).opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 6) {
                Text(sub.name).font(.title.bold()).textSelection(.enabled)
                HStack(spacing: 14) {
                    SubcontractorBadge(text: sub.statusLabel, color: SubcontractorText.statusColor(sub.status))
                    if let rating = sub.rating, rating != 0 {
                        Label { Text(verbatim: "\(SubcontractorText.plain(rating))/5") } icon: { Image(systemName: "star.fill").foregroundStyle(.yellow) }
                    }
                    Label { Text(verbatim: "\(SubcontractorText.plain(sub.hourlyRate)) zł/h") } icon: { Image(systemName: "banknote") }
                }
                .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if tab == .details {
                Button { editing = true } label: { Label("Edytuj", systemImage: "pencil") }.buttonStyle(.borderedProminent)
            }
        }
        .padding(16)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }

    private func settlementLine(_ sub: SubcontractorCardData.Subcontractor) -> some View {
        (Text("Forma rozliczenia: ") + Text(sub.settlementLabel.nonEmpty ?? "Do ustalenia").bold()
         + Text(sub.settlementType == "civil_contract" ? " · Dane do umowy, oświadczenia i wynagrodzenie w zakładce Umowy." : ""))
            .font(.callout)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Zakres i usługi (`SubcontractorServicesView.swift`)
    private func services(_ sub: SubcontractorCardData.Subcontractor) -> some View {
        SubcontractorServicesPanel(subcontractorID: sub.id)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.15)))
    }

    // MARK: Szczegóły
    private func details(_ data: SubcontractorCardData) -> some View {
        let sub = data.subcontractor
        let tasksCost = data.tasks.reduce(0) { $0 + $1.totalCost }
        let contractsValue = data.contracts.reduce(0) { $0 + $1.totalValue }
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                box("Informacje kontaktowe") {
                    field("Osoba kontaktowa", sub.contactPerson)
                    field("Email", sub.email, symbol: "envelope")
                    field("Telefon", sub.phone, symbol: "phone")
                    field("Adres", sub.address)
                }
                box("Dane finansowe") {
                    field("NIP", sub.nip)
                    field("Stawka godzinowa (zł)", "\(SubcontractorText.plain(sub.hourlyRate)) zł")
                    field("Warunki płatności", sub.paymentTerms, dash: false)
                    field("Numer konta", sub.bankAccount, monospaced: true)
                }
            }
            HStack(alignment: .top, spacing: 16) {
                box("Usługi i cennik") {
                    Text("Osobne usługi ze stawkami, kosztem przedłużenia, dojazdem i warunkami realizacji.").font(.callout).foregroundStyle(.secondary)
                    Button("Otwórz listę usług") { tab = .services }
                }
                box("Statystyki") {
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
                        GridRow {
                            stat("Zadania", "\(data.tasks.count)")
                            stat("Umowy", "\(data.contracts.count)")
                        }
                        GridRow {
                            stat("Koszt zadań", "\(SubcontractorText.number(tasksCost)) zł")
                            stat("Wartość umów", "\(SubcontractorText.number(contractsValue)) zł")
                        }
                    }
                }
            }
            box("Notatki") {
                Text(sub.notes.nonEmpty ?? "Brak notatek").foregroundStyle(.secondary).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func field(_ label: String, _ value: String, symbol: String? = nil, monospaced: Bool = false, dash: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                if let symbol { Image(systemName: symbol).foregroundStyle(theme.accent) }
                Text(value.nonEmpty ?? (dash ? "-" : "")).font(monospaced ? .callout.monospaced() : .body).textSelection(.enabled)
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title2.bold()).foregroundStyle(theme.accent).monospacedDigit()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    private func box<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.bold())
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.15)))
    }

    // MARK: Zadania
    private func tasks(_ tasks: [SubcontractorCardData.Task]) -> some View {
        box("Zadania") {
            if tasks.isEmpty {
                Text("Brak zadań").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 20)
            } else {
                ForEach(tasks) { task in taskRow(task) }
            }
        }
    }

    private func taskRow(_ task: SubcontractorCardData.Task) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.name).font(.headline)
                    if !task.eventId.isEmpty {
                        HStack(spacing: 4) {
                            Text("Wydarzenie:").foregroundStyle(.secondary)
                            Button { state.showEvent(task.eventId, cardTab: "subcontractors") } label: {
                                Label(task.eventName.nonEmpty ?? "Przejdź do wydarzenia", systemImage: "arrow.up.right")
                            }
                            .buttonStyle(.link).linkCursor()
                        }
                        .font(.callout)
                    }
                }
                Spacer()
                SubcontractorBadge(text: task.statusLabel, color: SubcontractorText.statusColor(task.status))
                SubcontractorBadge(text: task.paymentStatusLabel, color: SubcontractorText.statusColor(task.paymentStatus))
            }
            if !task.description.isEmpty { Text(task.description).font(.callout).foregroundStyle(.secondary) }
            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 4) {
                GridRow {
                    Text("Typ rozliczenia"); Text("Godziny"); Text("Stawka/Cena"); Text("Całkowity koszt")
                }
                .font(.caption).foregroundStyle(.secondary)
                GridRow {
                    Text(SubcontractorText.paymentType(task.paymentType))
                    Text(verbatim: "\(SubcontractorText.plain(task.actualHours)) / \(SubcontractorText.plain(task.estimatedHours))h")
                    Text(verbatim: task.paymentType == "fixed" ? "\(SubcontractorText.plain(task.fixedPrice)) zł" : "\(SubcontractorText.plain(task.hourlyRate)) zł/h")
                    Text(verbatim: "\(SubcontractorText.number(task.totalCost)) zł").fontWeight(.semibold).foregroundStyle(theme.accent)
                }
                .monospacedDigit()
            }
            if !task.invoiceNumber.isEmpty {
                Divider()
                Text(verbatim: "Faktura: \(task.invoiceNumber)\(task.paymentDate.map { " | Zapłacono: \(SubcontractorText.date($0))" } ?? "")")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Umowy
    private func contracts(_ data: SubcontractorCardData) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            box("Umowy zlecenia i rozliczenia") {
                if !data.personnel.view {
                    Text(data.personnel.error.nonEmpty ?? "Nie masz uprawnień do umów i wynagrodzeń tej osoby.").font(.callout).foregroundStyle(.secondary)
                } else {
                    Text("Rejestr umów cywilnoprawnych tej osoby (kreator, oświadczenia, wynagrodzenie, PDF) — na razie w CRM.")
                        .font(.callout).foregroundStyle(.secondary)
                    Button { state.openCRM("/crm/subcontractors/\(data.subcontractor.id)?tab=contracts") } label: {
                        Label("Otwórz umowy w CRM", systemImage: "safari")
                    }
                }
            }
            box("Umowy ramowe i projektowe") {
                if data.contracts.isEmpty {
                    Text("Brak umów").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 20)
                } else {
                    ForEach(data.contracts) { contract in contractRow(contract) }
                }
            }
        }
    }

    private func contractRow(_ contract: SubcontractorCardData.Contract) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Label(contract.title, systemImage: "doc.text").font(.headline)
                    Text(contract.number).font(.callout).foregroundStyle(.secondary)
                    if !contract.eventName.isEmpty { Text("Wydarzenie: \(contract.eventName)").font(.callout).foregroundStyle(.secondary) }
                }
                Spacer()
                SubcontractorBadge(text: contract.statusLabel, color: SubcontractorText.statusColor(contract.status))
            }
            if !contract.description.isEmpty { Text(contract.description).font(.callout).foregroundStyle(.secondary) }
            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 4) {
                GridRow {
                    Text("Typ"); Text("Wartość"); Text("Data rozpoczęcia"); Text("Data zakończenia")
                }
                .font(.caption).foregroundStyle(.secondary)
                GridRow {
                    Text(contract.type == "frame" ? "Ramowa" : "Projektowa")
                    Text(verbatim: "\(SubcontractorText.number(contract.totalValue)) zł").fontWeight(.semibold).foregroundStyle(theme.accent)
                    Text(SubcontractorText.date(contract.startDate))
                    Text(SubcontractorText.date(contract.endDate))
                }
                .monospacedDigit()
            }
            if contract.hasFile {
                Label("Umowa dostępna w plikach", systemImage: "doc.text").font(.callout).foregroundStyle(theme.accent)
            }
        }
        .padding(12)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Dane i rozliczenie (`SubcontractorProfileForm`)

/// Adres z części (`profileAddress.ts`).
struct SubcontractorAddress: Equatable {
    var type = ""
    var name = ""
    var house = ""
    var apartment = ""
    var postalCode = ""
    var city = ""
    var country = "Polska"

    static let types: [(String, String)] = [
        ("", "Bez prefiksu"), ("street", "Ulica (ul.)"), ("avenue", "Aleja (al.)"), ("square", "Plac (pl.)"), ("village", "Wieś"), ("estate", "Osiedle (os.)"),
    ]

    /// `formatProfileAddress`.
    var formatted: String {
        let prefix: [String: String] = ["street": "ul.", "avenue": "al.", "square": "pl.", "village": "", "estate": "os."]
        let trim = { (value: String) in value.trimmingCharacters(in: .whitespacesAndNewlines) }
        let number = [trim(house), trim(apartment)].filter { !$0.isEmpty }.joined(separator: "/")
        let line = [trim(name).isEmpty ? "" : (prefix[type] ?? ""), trim(name), number].filter { !$0.isEmpty }.joined(separator: " ")
        let place = [trim(postalCode), trim(city)].filter { !$0.isEmpty }.joined(separator: " ")
        if line.isEmpty && place.isEmpty { return "" }
        return [line, place, trim(country)].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    var json: JSONValue {
        .object([
            "type": .string(type), "name": .string(name), "house": .string(house), "apartment": .string(apartment),
            "postal_code": .string(postalCode), "city": .string(city), "country": .string(country),
        ])
    }
}

/// Zapisany podwykonawca (odpowiedź `save`).
struct SubcontractorSaved {
    var id: String
    var settlementType: String
}

/// Reguły formularza (`subcontractorProfileSchema`); serwer sprawdza je ponownie tym samym schematem co CRM.
enum SubcontractorValidation {
    static func validNip(_ value: String) -> Bool {
        let digits = value.filter { $0 != " " && $0 != "-" && !$0.isWhitespace }
        guard digits.count == 10, digits.allSatisfy({ $0.isASCII && $0.isNumber }), Set(digits).count > 1 else { return false }
        let numbers = digits.compactMap(\.wholeNumberValue)
        let weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
        return zip(weights, numbers).reduce(0) { $0 + $1.0 * $1.1 } % 11 == numbers[9]
    }
    static func validPesel(_ value: String) -> Bool {
        let digits = value.filter { !$0.isWhitespace }
        guard digits.count == 11, digits.allSatisfy({ $0.isASCII && $0.isNumber }), Set(digits).count > 1 else { return false }
        let numbers = digits.compactMap(\.wholeNumberValue)
        let weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
        return (10 - zip(weights, numbers).reduce(0) { $0 + $1.0 * $1.1 } % 10) % 10 == numbers[10]
    }
    static func validIban(_ value: String) -> Bool {
        let raw = value.filter { !$0.isWhitespace }.uppercased()
        let iban = raw.count == 26 && raw.allSatisfy({ $0.isASCII && $0.isNumber }) ? "PL" + raw : raw
        guard iban.range(of: "^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$", options: .regularExpression) != nil,
              !(iban.hasPrefix("PL") && iban.count != 28) else { return false }
        var remainder = 0
        for char in iban.dropFirst(4) + iban.prefix(4) {
            let digits = char.isNumber ? String(char) : String(Int(char.asciiValue ?? 0) - 55)
            for digit in digits { remainder = (remainder * 10 + (digit.wholeNumberValue ?? 0)) % 97 }
        }
        return remainder == 1
    }
    /// E-mail jak `yup.string().email()` (wzorzec ze specyfikacji HTML).
    static func validEmail(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
                    options: .regularExpression) != nil
    }

    @MainActor static func errors(_ model: SubcontractorProfileModel) -> [String: String] {
        var found: [String: String] = [:]
        let trim = { (value: String) in value.trimmingCharacters(in: .whitespacesAndNewlines) }
        let settlement = model.settlementType
        let mandate = settlement == "civil_contract"
        if trim(model.name).isEmpty { found["company_name"] = "Podaj nazwę lub imię i nazwisko." }
        if !SubcontractorText.settlements.contains(where: { $0.0 == settlement }) { found["default_settlement_type"] = "Wybierz formę rozliczenia." }
        if mandate, !trim(model.personnelIdentifier).isEmpty, !validPesel(model.personnelIdentifier) {
            found["personnel_identifier"] = "PESEL musi zawierać 11 cyfr i prawidłową sumę kontrolną."
        }
        let parts = model.addressParts
        let limits: [(String, String, Int, String)] = [
            ("name", parts.name, 200, "Nazwa może mieć maksymalnie 200 znaków."),
            ("house", parts.house, 30, "Numer domu może mieć maksymalnie 30 znaków."),
            ("apartment", parts.apartment, 30, "Numer mieszkania może mieć maksymalnie 30 znaków."),
            ("city", parts.city, 200, "Miejscowość może mieć maksymalnie 200 znaków."),
            ("country", parts.country, 100, "Kraj może mieć maksymalnie 100 znaków."),
        ]
        for (key, value, limit, message) in limits where value.count > limit { found["personnel_address_parts.\(key)"] = message }
        let country = trim(parts.country).lowercased()
        if !trim(parts.postalCode).isEmpty && ["polska", "pl", ""].contains(country)
            && trim(parts.postalCode).range(of: "^\\d{2}-\\d{3}$", options: .regularExpression) == nil {
            found["personnel_address_parts.postal_code"] = "Podaj kod pocztowy w formacie 00-000."
        }
        if model.personnelAddress.count > 1000 { found["personnel_address"] = "Adres może mieć maksymalnie 1000 znaków." }
        if mandate, !trim(model.personnelBankAccount).isEmpty, !validIban(model.personnelBankAccount) {
            found["personnel_bank_account"] = "Sprawdź format i sumę kontrolną numeru konta."
        }
        if !trim(model.email).isEmpty && !validEmail(trim(model.email)) { found["email"] = "Podaj poprawny adres e-mail." }
        if settlement.hasPrefix("invoice") {
            if trim(model.nip).isEmpty { found["nip"] = "Do rozliczenia fakturą podaj NIP." }
            else if !validNip(model.nip) { found["nip"] = "NIP ma nieprawidłowy format lub sumę kontrolną." }
        }
        if trim(model.phone).isEmpty && trim(model.email).isEmpty && found["phone"] == nil { found["phone"] = "Podaj telefon lub e-mail." }
        return found
    }
}

@MainActor final class SubcontractorProfileModel: ObservableObject {
    let initialID: String?
    weak var workspace: Workspace?

    @Published var settlementType: String
    @Published var name: String
    @Published var phone: String
    @Published var email: String
    @Published var nip: String
    @Published var address: String
    @Published var notes: String
    @Published var personnelIdentifier = ""
    @Published var personnelBankAccount = ""
    /// Tekst adresu do umowy: z części po ich zmianie, inaczej dotychczasowy (jak `personnel_address` w CRM).
    @Published var personnelAddress = ""
    @Published var addressParts = SubcontractorAddress()

    @Published var accessLoading = true
    @Published var canView = false
    @Published var canManage = false
    @Published var loadingPersonnel: Bool
    @Published var personnelLoadError: String?
    @Published var errors: [String: String] = [:]
    @Published var submitted = false
    @Published var busy = false

    init(initial: SubcontractorCardData.Subcontractor?) {
        initialID = initial?.id
        settlementType = initial?.settlementType ?? ""
        name = initial?.name ?? ""
        phone = initial?.phone ?? ""
        email = initial?.email ?? ""
        nip = initial?.nip ?? ""
        address = initial?.address ?? ""
        notes = initial?.notes ?? ""
        loadingPersonnel = initial != nil
    }

    var invoice: Bool { settlementType.hasPrefix("invoice") }
    var mandate: Bool { settlementType == "civil_contract" }
    private var api: NativeAPI? { workspace?.nativeAPI() }

    /// Uprawnienia i (przy edycji) dane do umowy zlecenia.
    func load() async {
        guard let api else { return }
        struct Reply: Decodable {
            struct Access: Decodable { var view: Bool; var manage: Bool; var error: String }
            struct Personnel: Decodable {
                struct Parts: Decodable {
                    var type: String?; var name: String?; var house: String?; var apartment: String?
                    var postal_code: String?; var city: String?; var country: String?
                }
                var identifier: String; var address: String; var bankAccount: String; var addressParts: Parts
            }
            var access: Access
            var personnel: Personnel?
            var error: String?
        }
        var query = ["op": "personnel"]
        if let initialID { query["id"] = initialID }
        do {
            let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/subcontractors", query: query))
            canView = reply.access.view
            canManage = reply.access.manage
            accessLoading = false
            if let error = reply.error { personnelLoadError = error }
            if let personnel = reply.personnel {
                personnelIdentifier = personnel.identifier
                personnelAddress = personnel.address
                personnelBankAccount = personnel.bankAccount
                let parts = personnel.addressParts
                addressParts = SubcontractorAddress(type: parts.type ?? "", name: parts.name ?? "", house: parts.house ?? "",
                                                    apartment: parts.apartment ?? "", postalCode: parts.postal_code ?? "",
                                                    city: parts.city ?? "", country: parts.country ?? "Polska")
            }
        } catch {
            accessLoading = false
            if initialID != nil { personnelLoadError = "Nie udało się pobrać danych do umowy. Odśwież formularz przed zapisem." }
        }
        loadingPersonnel = false
    }

    /// Zmiana pola — po pierwszej próbie zapisu sprawdzenie na bieżąco (jak w CRM).
    func changed() {
        if submitted { errors = SubcontractorValidation.errors(self) }
    }
    func changeAddress(_ change: (inout SubcontractorAddress) -> Void) {
        change(&addressParts)
        personnelAddress = addressParts.formatted
        changed()
    }

    var saveDisabled: Bool { busy || (mandate && (accessLoading || loadingPersonnel || personnelLoadError != nil)) }

    func save() async -> SubcontractorSaved? {
        guard !busy, !(mandate && (loadingPersonnel || personnelLoadError != nil)) else { return nil }
        submitted = true
        errors = SubcontractorValidation.errors(self)
        guard errors.isEmpty else { return nil }
        if mandate && !canManage {
            errors = ["form": "Do przygotowania umowy zlecenia potrzebujesz uprawnień do umów i wynagrodzeń."]
            return nil
        }
        guard let workspace, let api else { return nil }
        guard workspace.canWrite else { errors = ["form": "Zapis wymaga połączenia z serwerem CRM."]; return nil }
        busy = true
        defer { busy = false }
        let form: [String: JSONValue] = [
            "name": .string(name), "email": .string(email), "phone": .string(phone), "nip": .string(nip), "address": .string(address),
            "settlementType": .string(settlementType), "notes": .string(notes),
            "personnelIdentifier": .string(personnelIdentifier), "personnelAddress": .string(personnelAddress),
            "personnelBankAccount": .string(personnelBankAccount), "personnelAddressParts": addressParts.json,
        ]
        var body: [String: JSONValue] = ["op": .string("save"), "form": .object(form)]
        if let initialID { body["id"] = .string(initialID) }
        do {
            let data = try await api.post("/subcontractors", body)
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            if reply["ok"]?.flag == true, let saved = reply["subcontractor"]?.object, let id = saved["id"]?.text.nonEmpty {
                workspace.succeed(initialID == nil ? "Podwykonawca został dodany" : "Dane zaktualizowane pomyślnie!")
                return SubcontractorSaved(id: id, settlementType: saved["settlementType"]?.text ?? settlementType)
            }
            var found: [String: String] = [:]
            for (key, value) in reply["errors"]?.object ?? [:] { found[key] = value.text }
            errors = found.isEmpty ? ["form": "Nie udało się zapisać podwykonawcy."] : found
            return nil
        } catch {
            errors = ["form": subcontractorFailure(error, "Nie udało się zapisać podwykonawcy.")]
            return nil
        }
    }
}

@MainActor struct SubcontractorProfileSheet: View {
    let initial: SubcontractorCardData.Subcontractor?
    let onSaved: (SubcontractorSaved) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model: SubcontractorProfileModel

    init(initial: SubcontractorCardData.Subcontractor?, onSaved: @escaping (SubcontractorSaved) -> Void) {
        self.initial = initial
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: SubcontractorProfileModel(initial: initial))
    }

    private func text(_ keyPath: ReferenceWritableKeyPath<SubcontractorProfileModel, String>) -> Binding<String> {
        Binding(get: { model[keyPath: keyPath] }, set: { value in
            model[keyPath: keyPath] = value
            model.changed()
        })
    }
    private func part(_ keyPath: WritableKeyPath<SubcontractorAddress, String>) -> Binding<String> {
        Binding(get: { model.addressParts[keyPath: keyPath] }, set: { value in model.changeAddress { $0[keyPath: keyPath] = value } })
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(initial == nil ? "Nowy podwykonawca" : "Dane i rozliczenie podwykonawcy").font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            Form {
                Section {
                    Picker("Forma rozliczenia *", selection: text(\.settlementType)) {
                        Text("Wybierz…").tag("")
                        ForEach(SubcontractorText.settlements, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    error("default_settlement_type")
                    TextField(model.invoice ? "Nazwa firmy *" : "Imię i nazwisko / nazwa *", text: text(\.name))
                    error("company_name")
                    TextField("Telefon", text: text(\.phone))
                    error("phone")
                    TextField("E-mail", text: text(\.email))
                    error("email")
                    if model.invoice {
                        TextField("NIP *", text: text(\.nip))
                        error("nip")
                        TextField("Adres firmy", text: text(\.address))
                        error("address")
                    }
                }
                if model.mandate { personnelSection }
                Section {
                    TextField("Notatki", text: text(\.notes), axis: .vertical).lineLimit(3...8)
                }
                if model.mandate {
                    Text("Krok 1: dane kontaktowe. Dalej otworzy się kreator umowy zlecenia z modułu Umowy i wynagrodzenia: dane strony, okres i zakres pracy, oświadczenia, wynagrodzenie oraz walidacja. Profil pozostaje nieaktywny do zatwierdzenia umowy.")
                        .font(.callout).foregroundStyle(theme.accent)
                }
                if let message = model.errors["form"] {
                    Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled)
                }
            }
            .formStyle(.grouped)
            .disabled(model.busy)
            HStack(spacing: 10) {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.busy)
                Button {
                    Task {
                        if let saved = await model.save() {
                            dismiss()
                            onSaved(saved)
                        }
                    }
                } label: {
                    Text(model.busy ? "Zapisywanie…" : model.mandate ? "Zapisz i przejdź do umowy zlecenia" : "Zapisz podwykonawcę")
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(model.saveDisabled)
            }
            .padding(16)
        }
        .frame(minWidth: 600, idealWidth: 680, minHeight: 540, idealHeight: 720)
        .background(theme.page)
        .interactiveDismissDisabled(model.busy)
        .task {
            model.workspace = state
            await model.load()
        }
    }

    @ViewBuilder private func error(_ key: String) -> some View {
        if let message = model.errors[key] { Text(message).font(.caption).foregroundStyle(.red) }
    }

    @ViewBuilder private var personnelSection: some View {
        Section("Dane do umowy zlecenia") {
            if model.loadingPersonnel {
                Text("Ładowanie danych do umowy…").foregroundStyle(.secondary)
            } else if !model.canView {
                Text("Dane dostępne dla osób z uprawnieniami do umów i wynagrodzeń.").foregroundStyle(.secondary)
            } else if let message = model.personnelLoadError {
                Text(message).foregroundStyle(.red)
            } else {
                Group {
                    TextField("PESEL", text: text(\.personnelIdentifier))
                    error("personnel_identifier")
                    TextField("Numer konta (NRB / IBAN)", text: text(\.personnelBankAccount))
                    error("personnel_bank_account")
                    Text("Adres zamieszkania").font(.headline).foregroundStyle(theme.accent)
                    if !model.personnelAddress.isEmpty && model.addressParts.formatted.isEmpty {
                        Text("Dotychczasowy adres: \(model.personnelAddress). Pozostanie zapisany, dopóki nie uzupełnisz poniższych pól.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    Picker("Typ adresu", selection: part(\.type)) {
                        ForEach(SubcontractorAddress.types, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }
                .disabled(!model.canManage)
                Group {
                    TextField("Nazwa ulicy / placu / wsi", text: part(\.name))
                    error("personnel_address_parts.name")
                    TextField("Numer domu", text: part(\.house))
                    error("personnel_address_parts.house")
                    TextField("Numer mieszkania", text: part(\.apartment))
                    error("personnel_address_parts.apartment")
                    TextField("Kod pocztowy", text: part(\.postalCode))
                    error("personnel_address_parts.postal_code")
                    TextField("Miejscowość", text: part(\.city))
                    error("personnel_address_parts.city")
                    TextField("Kraj", text: part(\.country))
                    error("personnel_address_parts.country")
                    error("personnel_address")
                }
                .disabled(!model.canManage)
            }
            Text("Dane podstawią się do nowej umowy. Możesz uzupełniać je etapami; zapisane umowy zachowują swoją treść.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

// MARK: Nawigacja

extension ContactsStore {
    /// Po dodaniu podwykonawcy — jak w CRM: karta na zakładce usług, a przy umowie zlecenia zakładka Umowy i kreator umowy
    /// (rejestr umów zlecenia jest jeszcze w CRM).
    func showCreatedSubcontractor(_ saved: SubcontractorSaved, workspace: Workspace) {
        opened = nil
        subcontractorsShown = true
        let mandate = saved.settlementType == "civil_contract"
        openedSubcontractor = SubcontractorRoute(id: saved.id, tab: mandate ? .contracts : .services)
        if mandate { workspace.openCRM("/crm/subcontractors/\(saved.id)?tab=contracts&new=1") }
    }
}

extension Workspace {
    /// Karta podwykonawcy (z wydarzenia, umowy, wynajmu) — w sekcji Kontakty, jak `/crm/subcontractors/<id>`.
    func showSubcontractor(_ id: String, tab: SubcontractorTab = .details) {
        guard UUID(uuidString: id) != nil else { return }
        guard employee?.canView(.contacts) == true else { openCRM("/crm/subcontractors/\(id)"); return }
        switchSection(.contacts)
        contacts.opened = nil
        contacts.subcontractorsShown = true
        contacts.openedSubcontractor = SubcontractorRoute(id: id, tab: tab)
    }
}
