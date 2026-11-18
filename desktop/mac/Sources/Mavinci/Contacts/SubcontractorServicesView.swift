import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Zakres i usługi podwykonawcy — 1:1 z `SubcontractorServicesPanel` (typy usług: usługi, wynajem sprzętu, transport;
// katalogi pozycji, dodawanie z cennikiem, warunkami i zdjęciami, usuwanie) i kartą usługi `/crm/subcontractors/service/[id]`
// (dane, warunki realizacji, cennik z rozliczeniem gotówkowym, galeria — edycja i usuwanie). Pozycja wynajmu otwiera kartę
// w Magazynie → Rental. Serwer: `/bridge/native/v1/subcontractors` (`services`, `service`, `serviceType…`, `catalog…`,
// `serviceSave`, `serviceDelete`, `serviceImage…` — `src/lib/native/subcontractorServices.ts`).

struct SubcontractorServicesData: Decodable {
    struct Service: Decodable, Identifiable { var id: String; var type: String; var isActive: Bool; var notes: String }
    struct Item: Decodable, Identifiable {
        var id: String
        var type: String
        var name: String
        var description: String
        var category: String
        var thumbnailUrl: String?
        var isActive: Bool
        var unit: String
        var unitPrice: Double?
        var priceNet: Double?
        var rentalPricePerDay: Double?
        var settlementMethod: String
        var economicCost: Double?
        var includedHours: Double?
        var overtimeHourlyRate: Double?
        var travelRatePerKm: Double?
        var performanceRequirements: String
    }
    var services: [Service]
    var catalogs: [String: [Item]]
    var catalogErrors: [String: String]
}

enum SubcontractorServiceText {
    static let types: [(String, String, String)] = [
        ("transport", "Transport", "truck.box"), ("services", "Usługi", "wrench.and.screwdriver"), ("rental", "Wynajem sprzętu", "shippingbox"),
    ]
    static func label(_ type: String) -> String { types.first { $0.0 == type }?.1 ?? type }
    static func symbol(_ type: String) -> String { types.first { $0.0 == type }?.2 ?? "shippingbox" }
    static let methods: [(String, String)] = [
        ("invoice", "Faktura / rachunek kosztowy"), ("cash_documented", "Gotówka z dokumentem kosztowym"),
        ("cash_non_deductible", "Gotówka bez dokumentu kosztowego (poza KUP)"),
    ]
    static func info(_ type: String) -> String {
        switch type {
        case "services": return "Dodaj produkty/usługi jakie może świadczyć ten podwykonawca. Kliknij w pozycję, aby zobaczyć szczegóły."
        case "rental": return "Dodaj sprzęt, który możesz wynająć od tego podwykonawcy. Kliknij w pozycję, aby zobaczyć szczegóły."
        default: return "Dodaj pojazdy transportowe dostępne u tego podwykonawcy. (W przyszłości)"
        }
    }
    /// Kwota jak `toLocaleString('pl-PL', { minimumFractionDigits: 2 })` (do trzech miejsc).
    static func amount(_ value: Double, maxFraction: Int = 3) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = maxFraction
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    }
    /// `formatMoney` z karty usługi.
    static func money(_ value: Double?) -> String { value.map { "\(amount($0, maxFraction: 2)) zł" } ?? "-" }
    static func unit(_ value: String) -> String {
        switch value {
        case "godz": return "Za godzinę"
        case "realizacja": return "Za realizację"
        default: return value.isEmpty ? "Nie określono" : value
        }
    }
}

/// `calculateSubcontractorSettlementCost` — koszt ekonomiczny wypłaty finansowanej z zysku (CIT i podatek od dywidendy kolejno).
enum SubcontractorSettlement {
    struct Cost { var contractorAmount: Double; var economicCost: Double; var taxBurden: Double; var effectiveTaxRate: Double; var grossUpRate: Double }
    static func roundMoney(_ value: Double) -> Double { InvoiceMath.jsRound(((value.isFinite ? value : 0) + Double.ulpOfOne) * 100) / 100 }
    static func clamp(_ value: Double) -> Double { min(99.99, max(0, value.isFinite ? value : 0)) }
    static func calculate(amount: Double, method: String, cit: Double = 9, dividend: Double = 19) -> Cost {
        let value = max(0, amount.isFinite ? amount : 0)
        guard method == "cash_non_deductible" else {
            return Cost(contractorAmount: roundMoney(value), economicCost: roundMoney(value), taxBurden: 0, effectiveTaxRate: 0, grossUpRate: 0)
        }
        let retained = (1 - clamp(cit) / 100) * (1 - clamp(dividend) / 100)
        let economic = retained > 0 ? value / retained : value
        return Cost(contractorAmount: roundMoney(value), economicCost: roundMoney(economic), taxBurden: roundMoney(economic - value),
                    effectiveTaxRate: roundMoney((1 - retained) * 100), grossUpRate: value > 0 ? roundMoney((economic / value - 1) * 100) : 0)
    }
    /// `Number(x.toFixed(2))`.
    static func fixed(_ value: Double) -> Double { InvoiceMath.fixed2(value.isFinite ? value : 0) }
}

/// Zdjęcie usługi (`images` w katalogu).
struct SubcontractorServiceImage: Codable, Equatable, Identifiable {
    var url: String
    var title: String?
    var isPrimary: Bool?
    var id: String { url }
    var json: JSONValue {
        var object: [String: JSONValue] = ["url": .string(url)]
        if let title { object["title"] = .string(title) }
        if let isPrimary { object["isPrimary"] = .bool(isPrimary) }
        return .object(object)
    }
}

// MARK: Wspólne

@MainActor private enum SubcontractorServicesAPI {
    static func get<T: Decodable>(_ state: Workspace, _ query: [String: String], as type: T.Type = T.self) async throws -> T {
        guard let api = state.nativeAPI() else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/subcontractors", query: query))
    }
    @discardableResult static func post(_ state: Workspace, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api = state.nativeAPI() else { throw AppError.configuration }
        let data = try await api.post("/subcontractors", body)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
    }
    static func failure(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }
    /// Zdjęcie (JPEG po zmniejszeniu, jak `compressImage` w CRM) do `service-catalog-images/<folder>/…`.
    static func upload(_ state: Workspace, folder: String, jpeg: Data, name: String) async throws -> String {
        guard let backend = state.eventAPI(), let base = state.connection.crm,
              var components = URLComponents(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/subcontractors")
        else { throw AppError.configuration }
        components.queryItems = [URLQueryItem(name: "folder", value: folder), URLQueryItem(name: "op", value: "serviceImage")]
        guard let url = components.url else { throw AppError.configuration }
        let boundary = "mavinci-\(UUID().uuidString)"
        let safeName = name.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        guard (200..<300).contains(http.statusCode), let address = object["url"]?.text.nonEmpty else {
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Błąd przesyłania \(name)", fieldErrors: [:])
        }
        return address
    }
    enum Picked { case jpeg(Data), rejected(String) }
    /// Plik ze zdjęciem z dysku: kontrola rozmiaru (10 MB jak w CRM) i JPEG do 1920 px.
    static func jpeg(from url: URL) -> Picked {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > 10 * 1024 * 1024 { return .rejected("\(url.lastPathComponent) przekracza 10MB") }
        guard let jpeg = ImageJPEG.from(url, maxSide: 1920) else { return .rejected("\(url.lastPathComponent) nie jest obrazem") }
        return .jpeg(jpeg)
    }
}

/// Pole liczby z pustym stanem („Do ustalenia”) — puste = brak wartości.
private struct OptionalNumberField: View {
    let title: String
    @Binding var value: Double?
    var prompt = "Do ustalenia"
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField(title, text: $text, prompt: Text(prompt))
            .focused($focused)
            .onAppear { text = value.map(InvoiceMath.plain) ?? "" }
            .onChange(of: text) { _, next in
                guard focused else { return }
                let input = next.trimmingCharacters(in: .whitespaces)
                if input.isEmpty { value = nil } else if let parsed = InvoiceMath.number(input), parsed.isFinite { value = parsed }
            }
            .onChange(of: value) { _, next in if !focused { text = next.map(InvoiceMath.plain) ?? "" } }
            .onChange(of: focused) { _, isFocused in if !isFocused { text = value.map(InvoiceMath.plain) ?? "" } }
    }
}

/// Warunki usługi (`ServiceTerms`): czas w cenie, przedłużenie, dojazd i warunki realizacji — podgląd albo edycja.
private struct ServiceTermsView: View {
    var includedHours: Binding<Double?>
    var overtimeRate: Binding<Double?>
    var travelRate: Binding<Double?>
    var requirements: Binding<String>
    let editable: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                GridRow {
                    Text("Czas w cenie (h)").font(.caption).foregroundStyle(.secondary)
                    Text("Przedłużenie (zł/h)").font(.caption).foregroundStyle(.secondary)
                    Text("Dojazd (zł/km)").font(.caption).foregroundStyle(.secondary)
                }
                GridRow {
                    cell(includedHours)
                    cell(overtimeRate)
                    cell(travelRate)
                }
            }
            Text("Stawki dodatkowe: netto przy fakturze; kwota wypłaty przy rozliczeniu gotówkowym. Dojazd za faktycznie rozliczane kilometry — zasady powrotu i minimum wpisz w warunkach.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text("Warunki realizacji i dojazdu").font(.caption).foregroundStyle(.secondary)
            if editable {
                TextField("", text: requirements, prompt: Text("Np. stanowisko DJ, nagłośnienie, zasilanie, czas przygotowania, dojazd w obie strony…"), axis: .vertical)
                    .lineLimit(3...6).textFieldStyle(.roundedBorder)
            } else {
                Text(requirements.wrappedValue.nonEmpty ?? "Nie określono").fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func cell(_ value: Binding<Double?>) -> some View {
        if editable {
            OptionalNumberField(title: "", value: value).textFieldStyle(.roundedBorder).frame(width: 120)
        } else {
            Text(value.wrappedValue.map(SubcontractorText.number) ?? "Do ustalenia").foregroundStyle(CrmTheme.rgb(0xd3bb73))
        }
    }
}

/// Miniatura zdjęcia (adres publiczny) z wypełnieniem.
private struct RemoteThumbnail: View {
    let url: String?
    var body: some View {
        if let url, let address = URL(string: url) {
            AsyncImage(url: address) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFill()
                case .failure: placeholder
                default: ProgressView().controlSize(.small)
                }
            }
        } else {
            placeholder
        }
    }
    private var placeholder: some View {
        Image(systemName: "shippingbox").font(.largeTitle).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.secondary.opacity(0.08))
    }
}

// MARK: Panel „Zakres i usługi”

@MainActor struct SubcontractorServicesPanel: View {
    let subcontractorID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: SubcontractorServicesData?
    @State private var loading = true
    @State private var activeTab: String?
    @State private var addingType = false
    @State private var addingItem = false
    @State private var openedService: String?
    @State private var removingType: SubcontractorServicesData.Service?
    @State private var deletingItem: SubcontractorServicesData.Item?
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Świadczone usługi").font(.title3.bold())
                    Text("Typy usług oferowanych przez podwykonawcę").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { addingType = true } label: { Label("Dodaj typ usługi", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .disabled(data.map { $0.services.count >= SubcontractorServiceText.types.count } ?? true)
            }
            if loading && data == nil {
                ProgressView().frame(maxWidth: .infinity).padding(30)
            } else if let data {
                if data.services.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "shippingbox").font(.largeTitle).foregroundStyle(.secondary)
                        Text("Nie dodano żadnych typów usług").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(30)
                    .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                } else {
                    tabs(data)
                    if let type = activeTab, let service = data.services.first(where: { $0.type == type }) {
                        catalog(data, service)
                    }
                }
            }
        }
        .disabled(working)
        .task(id: subcontractorID) { await load() }
        .sheet(isPresented: $addingType) {
            AddServiceTypeSheet(existing: Set(data?.services.map(\.type) ?? [])) { type, notes in
                Task { await addType(type, notes) }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $addingItem) {
            if let type = activeTab {
                CatalogItemSheet(subcontractorID: subcontractorID, type: type) { Task { await load() } }
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(item: Binding(get: { openedService.map { ServiceRef(id: $0) } }, set: { openedService = $0?.id })) { ref in
            ServiceCatalogSheet(serviceID: ref.id) { Task { await load() } }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog(removingType.map { "Czy na pewno chcesz usunąć typ usługi „\(SubcontractorServiceText.label($0.type))”?" } ?? "",
                            isPresented: Binding(get: { removingType != nil }, set: { if !$0 { removingType = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let service = removingType { Task { await removeType(service) } } }
            Button("Anuluj", role: .cancel) { removingType = nil }
        }
        .confirmationDialog(deletingItem.map { "Czy na pewno chcesz usunąć „\($0.name)”? Ta operacja jest nieodwracalna." } ?? "",
                            isPresented: Binding(get: { deletingItem != nil }, set: { if !$0 { deletingItem = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { if let item = deletingItem { Task { await deleteItem(item) } } }
            Button("Anuluj", role: .cancel) { deletingItem = nil }
        }
    }

    private struct ServiceRef: Identifiable { let id: String }

    private func tabs(_ data: SubcontractorServicesData) -> some View {
        HStack(spacing: 4) {
            ForEach(data.services) { service in
                Button { activeTab = service.type } label: {
                    HStack(spacing: 6) {
                        Image(systemName: SubcontractorServiceText.symbol(service.type))
                        Text(SubcontractorServiceText.label(service.type))
                        if !service.isActive {
                            Text("Nieaktywny").font(.caption2).foregroundStyle(.red)
                                .padding(.horizontal, 6).padding(.vertical, 1).background(Color.red.opacity(0.15), in: Capsule())
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .foregroundStyle(activeTab == service.type ? theme.accent : .secondary)
                    .overlay(alignment: .bottom) { if activeTab == service.type { Rectangle().fill(theme.accent).frame(height: 2) } }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }

    private func catalog(_ data: SubcontractorServicesData, _ service: SubcontractorServicesData.Service) -> some View {
        let items = data.catalogs[service.type] ?? []
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(SubcontractorServiceText.label(service.type)).font(.headline)
                Spacer()
                Button(service.isActive ? "Dezaktywuj" : "Aktywuj") { Task { await toggle(service) } }
                Button(role: .destructive) { removingType = service } label: { Image(systemName: "trash") }.help("Usuń typ usługi")
            }
            Text(SubcontractorServiceText.info(service.type)).font(.callout).foregroundStyle(CrmTheme.rgb(0x60a5fa))
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(CrmTheme.rgb(0x1e3a8a).opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            if let error = data.catalogErrors[service.type] { Text(error).foregroundStyle(.red) }
            Button { addingItem = true } label: { Label("Dodaj pozycję do katalogu", systemImage: "plus") }.buttonStyle(.borderedProminent)
            if items.isEmpty {
                Text("Brak pozycji w katalogu").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(24)
                    .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
                    ForEach(items) { item in itemTile(item) }
                }
            }
        }
    }

    private func itemTile(_ item: SubcontractorServicesData.Item) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteThumbnail(url: item.thumbnailUrl).frame(height: 140).frame(maxWidth: .infinity).clipped()
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(item.name).fontWeight(.medium).lineLimit(2)
                    if item.type != "transport" { Image(systemName: "arrow.up.right.square").font(.caption).foregroundStyle(.secondary) }
                }
                if !item.description.isEmpty { Text(item.description).font(.callout).foregroundStyle(.secondary).lineLimit(2) }
                if !item.category.isEmpty {
                    Text(item.category).font(.caption).foregroundStyle(theme.accent)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(theme.accent.opacity(0.1), in: Capsule())
                }
                if item.type == "services" {
                    ServiceTermsView(includedHours: .constant(item.includedHours), overtimeRate: .constant(item.overtimeHourlyRate),
                                     travelRate: .constant(item.travelRatePerKm), requirements: .constant(item.performanceRequirements), editable: false)
                }
                Divider()
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        if item.type == "services" && item.unitPrice == nil { Text("Cena do ustalenia").foregroundStyle(theme.accent) }
                        if let price = item.unitPrice, price > 0 {
                            Text(verbatim: "\(InvoiceMath.plain(price)) zł / \(item.unit)").foregroundStyle(.green)
                        }
                        if item.settlementMethod == "cash_non_deductible" {
                            Text(verbatim: "Gotówka poza KUP · koszt ekonomiczny \(SubcontractorServiceText.amount(economicCost(item), maxFraction: 2)) zł")
                                .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                        }
                    }
                    Spacer()
                    if let net = item.priceNet, net > 0, (item.unitPrice ?? 0) == 0 {
                        Text(verbatim: "\(InvoiceMath.plain(net)) zł netto").foregroundStyle(.green)
                    }
                    if let daily = item.rentalPricePerDay, daily > 0 {
                        Text(verbatim: "\(InvoiceMath.plain(daily)) zł / dzień").foregroundStyle(.green)
                    }
                    if !item.isActive { Text("Nieaktywny").font(.caption).foregroundStyle(.red) }
                }
                .font(.callout)
            }
            .padding(12)
        }
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .topTrailing) {
            Button(role: .destructive) { deletingItem = item } label: { Image(systemName: "trash").padding(6) }
                .buttonStyle(.borderless).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6)).padding(6)
                .help("Usuń pozycję")
        }
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { open(item) }
    }

    /// `item.economic_cost || item.unit_price || 0`.
    private func economicCost(_ item: SubcontractorServicesData.Item) -> Double {
        if let cost = item.economicCost, cost != 0 { return cost }
        return item.unitPrice ?? 0
    }

    /// Usługa — karta usługi; wynajem — karta w Magazynie → Rental (jak `/crm/subcontractors/rental/<id>`).
    private func open(_ item: SubcontractorServicesData.Item) {
        switch item.type {
        case "services": openedService = item.id
        case "rental":
            if state.navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/equipment/rental" }) {
                state.openHref("/crm/equipment/rental")
                state.warehouse.openedRentalID = item.id
            } else {
                state.openCRM("/crm/subcontractors/rental/\(item.id)")
            }
        default: break
        }
    }

    // MARK: Dane
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let next: SubcontractorServicesData = try await SubcontractorServicesAPI.get(state, ["op": "services", "id": subcontractorID])
            data = next
            // Jak w CRM: domyślnie „Usługi”, inaczej pierwszy typ; zachowaj wybrany, jeśli nadal jest.
            if activeTab == nil || !next.services.contains(where: { $0.type == activeTab }) {
                activeTab = next.services.contains(where: { $0.type == "services" }) ? "services" : next.services.first?.type
            }
        } catch {
            state.error = SubcontractorServicesAPI.failure(error, "Błąd podczas ładowania usług")
        }
    }

    private func act(_ body: [String: JSONValue], _ fallback: String) async -> Bool {
        guard state.canWrite else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        working = true
        defer { working = false }
        do {
            let reply = try await SubcontractorServicesAPI.post(state, body)
            if let message = reply["message"]?.text.nonEmpty { state.succeed(message) }
            return true
        } catch {
            state.error = SubcontractorServicesAPI.failure(error, fallback)
            return false
        }
    }

    private func addType(_ type: String, _ notes: String) async {
        if await act(["op": .string("serviceTypeAdd"), "id": .string(subcontractorID), "type": .string(type), "notes": .string(notes)], "Błąd podczas dodawania usługi") {
            activeTab = type
            await load()
        }
    }
    private func toggle(_ service: SubcontractorServicesData.Service) async {
        if await act(["op": .string("serviceTypeToggle"), "serviceId": .string(service.id), "active": .bool(!service.isActive)], "Błąd podczas zmiany statusu usługi") {
            await load()
        }
    }
    private func removeType(_ service: SubcontractorServicesData.Service) async {
        removingType = nil
        if await act(["op": .string("serviceTypeRemove"), "serviceId": .string(service.id)], "Błąd podczas usuwania usługi") {
            if activeTab == service.type { activeTab = nil }
            await load()
        }
    }
    private func deleteItem(_ item: SubcontractorServicesData.Item) async {
        deletingItem = nil
        if await act(["op": .string("catalogDelete"), "type": .string(item.type), "itemId": .string(item.id)], "Błąd podczas usuwania pozycji") {
            await load()
        }
    }
}

/// „Dodaj typ usługi” — typy jeszcze nie dodane i notatki.
private struct AddServiceTypeSheet: View {
    let existing: Set<String>
    let add: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var selected: String?
    @State private var notes = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Dodaj typ usługi").font(.title3.bold())
            ForEach(SubcontractorServiceText.types.filter { !existing.contains($0.0) }, id: \.0) { type in
                Button { selected = type.0 } label: {
                    HStack(spacing: 10) {
                        Image(systemName: type.2).font(.title3)
                        Text(type.1).fontWeight(.medium)
                        Spacer()
                    }
                    .padding(12)
                    .background(selected == type.0 ? theme.accent.opacity(0.12) : Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected == type.0 ? theme.accent : Color.secondary.opacity(0.25), lineWidth: 2))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if selected != nil {
                Text("Notatki (opcjonalne)").font(.callout).foregroundStyle(.secondary)
                TextField("", text: $notes, prompt: Text("Dodatkowe informacje..."), axis: .vertical).lineLimit(3...5).textFieldStyle(.roundedBorder)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Dodaj") {
                    if let selected { add(selected, notes) }
                    dismiss()
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(selected == nil)
            }
        }
        .padding(22)
        .frame(width: 420)
    }
}

// MARK: Nowa pozycja katalogu

@MainActor private final class CatalogItemModel: ObservableObject {
    @Published var name = ""
    @Published var description = ""
    @Published var price = 0.0
    @Published var unit = "realizacja"
    @Published var includedHours: Double?
    @Published var overtimeRate: Double?
    @Published var travelRate: Double?
    @Published var requirements = ""
    @Published var category = ""
    @Published var quantity = 1.0
    @Published var requiredSkills = ""
    @Published var vatRate = 23.0
    @Published var priceNet = 0.0
    @Published var priceGross = 0.0
    @Published var method = "invoice"
    @Published var citRate = 9.0
    @Published var dividendRate = 19.0
    @Published var images: [SubcontractorServiceImage] = []
    @Published var uploading = false
    @Published var saving = false
    /// Folder zdjęć nowej pozycji (jak `temp-<czas>` w CRM).
    let folder = "temp-\(Int(Date().timeIntervalSince1970 * 1000))"

    var settlement: SubcontractorSettlement.Cost { SubcontractorSettlement.calculate(amount: price, method: method, cit: citRate, dividend: dividendRate) }

    func setMethod(_ next: String) {
        method = next
        if next != "invoice" { vatRate = 0; priceNet = price; priceGross = price }
    }
    /// Zmiana stawki VAT przelicza brutto (i cenę jednostkową — w CRM zostawała poprzednia).
    func setVat(_ next: Double) {
        vatRate = next
        if priceNet > 0 {
            priceGross = SubcontractorSettlement.fixed(priceNet * (1 + next / 100))
            price = priceGross
        }
    }
    func setNet(_ next: Double) {
        priceNet = next
        priceGross = SubcontractorSettlement.fixed(next * (1 + vatRate / 100))
        price = priceGross
    }
    func setGross(_ next: Double) {
        priceGross = next
        priceNet = SubcontractorSettlement.fixed(next / (1 + vatRate / 100))
        price = next
    }
    func setCash(_ next: Double) {
        price = next; priceNet = next; priceGross = next
    }
}

private struct CatalogItemSheet: View {
    let subcontractorID: String
    let type: String
    let onAdded: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = CatalogItemModel()
    @State private var picking = false

    private func number(_ get: @escaping () -> Double, _ set: @escaping (Double) -> Void) -> Binding<Double> {
        Binding(get: get, set: set)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Dodaj pozycję do katalogu: \(SubcontractorServiceText.label(type))").font(.title3.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            Form {
                Section {
                    TextField("Nazwa *", text: $model.name, prompt: Text("Nazwa usługi / sprzętu"))
                    TextField("Opis", text: $model.description, prompt: Text("Opcjonalny opis..."), axis: .vertical).lineLimit(3...6)
                }
                if type == "services" {
                    imagesSection
                    servicesSection
                } else if type == "rental" {
                    rentalSection
                }
            }
            .formStyle(.grouped)
            .disabled(model.saving)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.saving)
                Button { Task { await save() } } label: { Label("Dodaj", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(model.name.trimmingCharacters(in: .whitespaces).isEmpty || model.uploading || model.saving)
            }
            .padding(16)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 560, idealHeight: 760)
        .background(theme.page)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await upload(urls) } }
        }
    }

    private var imagesSection: some View {
        Section("Zdjęcia") {
            Button { picking = true } label: {
                Label(model.uploading ? "Przesyłanie..." : "Kliknij, aby dodać zdjęcia (maks. 10MB)", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .disabled(model.uploading)
            if !model.images.isEmpty {
                Text("Kliknij gwiazdkę, aby ustawić miniaturę (thumbnail)").font(.caption).foregroundStyle(.secondary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(model.images) { image in
                        RemoteThumbnail(url: image.url).frame(height: 90).clipShape(RoundedRectangle(cornerRadius: 6))
                            .overlay(alignment: .topLeading) {
                                if image.isPrimary == true { Image(systemName: "star.fill").foregroundStyle(theme.accent).padding(4) }
                            }
                            .overlay(alignment: .bottomTrailing) {
                                HStack(spacing: 4) {
                                    if image.isPrimary != true {
                                        Button { model.images = model.images.map { var copy = $0; copy.isPrimary = $0.url == image.url; return copy } } label: { Image(systemName: "star") }
                                            .help("Ustaw jako miniaturę")
                                    }
                                    Button(role: .destructive) { Task { await removeImage(image) } } label: { Image(systemName: "trash") }.help("Usuń")
                                }
                                .buttonStyle(.borderless).padding(4).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 5)).padding(4)
                            }
                    }
                }
            }
        }
    }

    private var servicesSection: some View {
        Group {
            Section {
                TextField("Kategoria", text: $model.category, prompt: Text("np. Catering, Animacje, Dekoracje"))
                Picker("Sposób rozliczenia", selection: Binding(get: { model.method }, set: { model.setMethod($0) })) {
                    ForEach(SubcontractorServiceText.methods, id: \.0) { Text($0.1).tag($0.0) }
                }
                if model.method == "invoice" {
                    vatPicker(zeroLabel: "0% (zwolniony)")
                    InvoiceNumberField(title: "Cena netto (PLN)", value: number({ model.priceNet }, { model.setNet($0) }))
                    InvoiceNumberField(title: "Cena brutto (PLN)", value: number({ model.priceGross }, { model.setGross($0) }))
                } else {
                    InvoiceNumberField(title: "Kwota dla podwykonawcy „do ręki” (PLN)", value: number({ model.price }, { model.setCash($0) }))
                    if model.method == "cash_non_deductible" { cashCalculation }
                }
                Picker("Sposób wyceny", selection: $model.unit) {
                    Text("Za realizację").tag("realizacja")
                    Text("Za godzinę").tag("godz")
                }
            }
            Section {
                ServiceTermsView(includedHours: $model.includedHours, overtimeRate: $model.overtimeRate, travelRate: $model.travelRate,
                                 requirements: $model.requirements, editable: true)
            }
        }
    }

    private var cashCalculation: some View {
        let cost = model.settlement
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                InvoiceNumberField(title: "CIT (%)", value: $model.citRate)
                InvoiceNumberField(title: "Podatek od dywidendy (%)", value: $model.dividendRate)
            }
            Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 6) {
                GridRow {
                    calcCell("Podwykonawca otrzyma", "\(SubcontractorServiceText.amount(cost.contractorAmount)) zł")
                    calcCell("Faktyczny koszt ekonomiczny", "\(SubcontractorServiceText.amount(cost.economicCost)) zł", highlight: true)
                }
                GridRow {
                    calcCell("Efektywne opodatkowanie", String(format: "%.2f", cost.effectiveTaxRate) + "%")
                    calcCell("Narzut do kwoty „do ręki”", String(format: "%.2f", cost.grossUpRate) + "% (\(SubcontractorServiceText.amount(cost.taxBurden)) zł)")
                }
            }
            Text(verbatim: "CIT i podatek od dywidendy są liczone kolejno, nie przez proste dodanie 9% + 19%. To kalkulacja ekonomiczna. Brak faktury nie zastępuje prawidłowej podstawy wypłaty ani dokumentu księgowego.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private func calcCell(_ label: String, _ value: String, highlight: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(verbatim: value).fontWeight(.semibold).foregroundStyle(highlight ? CrmTheme.rgb(0xfcd34d) : .primary)
        }
    }

    private func vatPicker(zeroLabel: String) -> some View {
        Picker(selection: Binding(get: { model.vatRate }, set: { model.setVat($0) })) {
            Text(verbatim: zeroLabel).tag(0.0)
            Text(verbatim: "5%").tag(5.0)
            Text(verbatim: "8%").tag(8.0)
            Text(verbatim: "23%").tag(23.0)
        } label: {
            Text(verbatim: "Stawka VAT (%)")
        }
    }

    private var rentalSection: some View {
        Section {
            TextField("Kategoria", text: $model.category, prompt: Text("np. Nagłośnienie, Oświetlenie"))
            vatPicker(zeroLabel: "0% (zwolniony)")
            InvoiceNumberField(title: "Cena dzienna netto (PLN)", value: number({ model.priceNet }, { model.setNet($0) }))
            InvoiceNumberField(title: "Cena dzienna brutto (PLN)", value: number({ model.priceGross }, { model.setGross($0) }))
            InvoiceNumberField(title: "Dostępna ilość", value: $model.quantity)
            TextField("Wymagane umiejętności", text: $model.requiredSkills, prompt: Text("np. Operator dźwięku, Technik oświetlenia (oddziel przecinkami)"))
        }
    }

    private func upload(_ urls: [URL]) async {
        model.uploading = true
        defer { model.uploading = false }
        for (index, url) in urls.enumerated() {
            switch SubcontractorServicesAPI.jpeg(from: url) {
            case .rejected(let message): state.error = message
            case .jpeg(let jpeg):
                do {
                    let address = try await SubcontractorServicesAPI.upload(state, folder: model.folder, jpeg: jpeg, name: url.deletingPathExtension().lastPathComponent + ".jpg")
                    let primary = model.images.isEmpty && index == 0
                    model.images.append(SubcontractorServiceImage(url: address, title: url.lastPathComponent, isPrimary: primary))
                } catch {
                    state.error = SubcontractorServicesAPI.failure(error, "Błąd przesyłania \(url.lastPathComponent)")
                }
            }
        }
    }

    private func removeImage(_ image: SubcontractorServiceImage) async {
        _ = try? await SubcontractorServicesAPI.post(state, ["op": .string("serviceImageRemove"), "url": .string(image.url)])
        model.images.removeAll { $0.url == image.url }
    }

    private func save() async {
        guard state.canWrite else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        model.saving = true
        defer { model.saving = false }
        let optional = { (value: Double?) -> JSONValue in value.map { .number($0) } ?? .null }
        let item: [String: JSONValue] = [
            "name": .string(model.name), "description": .string(model.description), "price": .number(model.price), "unit": .string(model.unit),
            "includedHours": optional(model.includedHours), "overtimeHourlyRate": optional(model.overtimeRate),
            "travelRatePerKm": optional(model.travelRate), "performanceRequirements": .string(model.requirements),
            "category": .string(model.category), "quantity": .number(model.quantity), "requiredSkills": .string(model.requiredSkills),
            "vatRate": .number(model.vatRate), "priceNet": .number(model.priceNet), "priceGross": .number(model.priceGross),
            "settlementMethod": .string(model.method), "citRate": .number(model.citRate), "dividendTaxRate": .number(model.dividendRate),
            "images": .array(model.images.map(\.json)),
        ]
        do {
            let reply = try await SubcontractorServicesAPI.post(state, ["op": .string("catalogAdd"), "id": .string(subcontractorID), "type": .string(type), "item": .object(item)])
            state.succeed(reply["message"]?.text.nonEmpty ?? "Dodano pozycję do katalogu")
            dismiss()
            onAdded()
        } catch {
            state.error = SubcontractorServicesAPI.failure(error, "Błąd podczas dodawania pozycji")
        }
    }
}

// MARK: Karta usługi

struct ServiceCatalogData: Decodable {
    struct Service: Decodable {
        var id: String
        var name: String
        var description: String
        var category: String
        var unit: String
        var isActive: Bool
        var unitPrice: Double?
        var vatRate: Double?
        var priceNet: Double?
        var priceGross: Double?
        var settlementMethod: String
        var cashPayoutAmount: Double?
        var citRate: Double?
        var dividendTaxRate: Double?
        var includedHours: Double?
        var overtimeHourlyRate: Double?
        var travelRatePerKm: Double?
        var performanceRequirements: String
        var thumbnailUrl: String?
        var images: [SubcontractorServiceImage]
    }
    struct Subcontractor: Decodable {
        struct Organization: Decodable { var name: String; var email: String; var phone: String }
        var id: String; var name: String; var organization: Organization?
    }
    var service: Service
    var subcontractor: Subcontractor?
    var canEdit: Bool
}

private struct ServiceCatalogSheet: View {
    let serviceID: String
    let onChanged: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: ServiceCatalogData?
    @State private var loadError: String?
    /// Formularz edycji (kopia usługi) — `nil` poza edycją.
    @State private var form: ServiceCatalogData.Service?
    @State private var saving = false
    @State private var uploading: [String] = []
    @State private var picking = false
    @State private var confirmDelete = false
    @State private var preview: SubcontractorServiceImage?

    private var shown: ServiceCatalogData.Service? { form ?? data?.service }
    private func field<T>(_ keyPath: WritableKeyPath<ServiceCatalogData.Service, T>) -> Binding<T> {
        // Pola edycji są pokazywane tylko z formularzem; po jego zamknięciu odczyt (np. przy znikaniu widoku) bierze dane usługi.
        Binding(get: { (form ?? data!.service)[keyPath: keyPath] }, set: { form?[keyPath: keyPath] = $0 })
    }

    var body: some View {
        VStack(spacing: 0) {
            if let data, let service = shown {
                header(data, service)
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        subcontractorBox(data)
                        basics(service)
                        pricing(service)
                        gallery(data, service)
                    }
                    .padding(20)
                }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie znaleziono usługi", systemImage: "wrench.and.screwdriver")
                } description: { Text(loadError) } actions: { Button("Powrót") { dismiss() } }
            } else {
                ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 720, idealWidth: 820, minHeight: 640, idealHeight: 820)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: "Zapisywanie…") } }
        .overlay { if let preview { previewOverlay(preview) } }
        .interactiveDismissDisabled(saving || form != nil)
        .task { await load() }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await upload(urls) } }
        }
        .confirmationDialog("Czy na pewno chcesz usunąć „\(data?.service.name ?? "")”? Ta operacja jest nieodwracalna.", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { Task { await remove() } }
            Button("Anuluj", role: .cancel) {}
        }
    }

    private func header(_ data: ServiceCatalogData, _ service: ServiceCatalogData.Service) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "wrench.and.screwdriver").font(.title2).foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Usługa podwykonawcy").font(.caption).foregroundStyle(.secondary)
                Text(service.name).font(.title2.bold())
            }
            Spacer()
            if data.canEdit {
                if form != nil {
                    Button { form = nil } label: { Label("Anuluj", systemImage: "xmark") }.disabled(saving)
                    Button { Task { await save() } } label: { Label("Zapisz", systemImage: "square.and.arrow.down") }
                        .buttonStyle(.borderedProminent).disabled(saving || !uploading.isEmpty)
                } else {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Usuń", systemImage: "trash") }
                    Button { form = data.service } label: { Label("Edytuj", systemImage: "pencil") }.buttonStyle(.borderedProminent)
                }
            }
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving || form != nil)
        }
        .padding(16)
    }

    private func box<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }

    private func subcontractorBox(_ data: ServiceCatalogData) -> some View {
        box("Podwykonawca") {
            LabeledContent("Firma:", value: data.subcontractor?.name.nonEmpty ?? "-")
            if let org = data.subcontractor?.organization {
                LabeledContent("Organizacja:", value: org.name)
                if !org.email.isEmpty { LabeledContent("Email:", value: org.email) }
                if !org.phone.isEmpty { LabeledContent("Telefon:", value: org.phone) }
            }
        }
    }

    @ViewBuilder private func basics(_ service: ServiceCatalogData.Service) -> some View {
        box("Podstawowe informacje") {
            if form != nil {
                TextField("Nazwa", text: field(\.name)).textFieldStyle(.roundedBorder)
                TextField("Opis", text: field(\.description), axis: .vertical).lineLimit(3...6).textFieldStyle(.roundedBorder)
                TextField("Kategoria", text: field(\.category), prompt: Text("np. Catering, Animacje, Dekoracje")).textFieldStyle(.roundedBorder)
                ServiceTermsView(includedHours: field(\.includedHours), overtimeRate: field(\.overtimeHourlyRate), travelRate: field(\.travelRatePerKm),
                                 requirements: field(\.performanceRequirements), editable: true)
                Picker("Sposób wyceny", selection: field(\.unit)) {
                    Text("Za realizację").tag("realizacja")
                    Text("Za godzinę").tag("godz")
                    if !["godz", "realizacja"].contains(service.unit) { Text(service.unit.nonEmpty ?? "Nie określono").tag(service.unit) }
                }
                Toggle("Aktywna", isOn: field(\.isActive)).toggleStyle(.checkbox)
            } else {
                LabeledContent("Nazwa", value: service.name)
                LabeledContent("Opis", value: service.description.nonEmpty ?? "-")
                LabeledContent("Kategoria") {
                    if service.category.isEmpty {
                        Text("-").foregroundStyle(.secondary)
                    } else {
                        Text(service.category).foregroundStyle(CrmTheme.rgb(0x60a5fa))
                            .padding(.horizontal, 10).padding(.vertical, 3).background(CrmTheme.rgb(0x3b82f6).opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
                    }
                }
                ServiceTermsView(includedHours: .constant(service.includedHours), overtimeRate: .constant(service.overtimeHourlyRate),
                                 travelRate: .constant(service.travelRatePerKm), requirements: .constant(service.performanceRequirements), editable: false)
                LabeledContent("Sposób wyceny", value: SubcontractorServiceText.unit(service.unit))
                LabeledContent("Status") { Text(service.isActive ? "Aktywna" : "Nieaktywna").foregroundStyle(service.isActive ? .green : .red) }
            }
        }
    }

    // MARK: Cennik (jak strona CRM)
    private func contractorAmount(_ service: ServiceCatalogData.Service) -> Double {
        service.settlementMethod == "invoice"
            ? ((service.priceNet ?? 0) != 0 ? service.priceNet! : (service.unitPrice ?? 0))
            : ((service.cashPayoutAmount ?? 0) != 0 ? service.cashPayoutAmount! : (service.unitPrice ?? 0))
    }

    private func setMethod(_ method: String) {
        guard var next = form else { return }
        let amount = [next.cashPayoutAmount, next.unitPrice, next.priceGross].compactMap { $0 }.first { $0 != 0 } ?? 0
        next.settlementMethod = method
        next.cashPayoutAmount = method == "invoice" ? nil : amount
        next.vatRate = method == "invoice" ? (next.vatRate ?? 23) : 0
        if method != "invoice" { next.priceNet = amount; next.priceGross = amount }
        next.unitPrice = amount
        form = next
    }
    /// Zmiana stawki VAT przelicza brutto (i cenę jednostkową — w CRM zostawała poprzednia).
    private func setVat(_ vat: Double) {
        guard var next = form else { return }
        next.vatRate = vat
        if let net = next.priceNet, net > 0 {
            next.priceGross = SubcontractorSettlement.fixed(net * (1 + vat / 100))
            next.unitPrice = next.priceGross
        }
        form = next
    }
    private func setNet(_ net: Double) {
        guard var next = form else { return }
        let gross = SubcontractorSettlement.fixed(net * (1 + (next.vatRate ?? 23) / 100))
        next.priceNet = net; next.priceGross = gross; next.unitPrice = gross
        form = next
    }
    private func setGross(_ gross: Double) {
        guard var next = form else { return }
        next.priceGross = gross
        next.priceNet = SubcontractorSettlement.fixed(gross / (1 + (next.vatRate ?? 23) / 100))
        next.unitPrice = gross
        form = next
    }
    private func setCash(_ amount: Double) {
        guard var next = form else { return }
        next.cashPayoutAmount = amount; next.unitPrice = amount; next.priceNet = amount; next.priceGross = amount; next.vatRate = 0
        form = next
    }

    private func pricing(_ service: ServiceCatalogData.Service) -> some View {
        let method = service.settlementMethod
        let amount = contractorAmount(service)
        let cost = SubcontractorSettlement.calculate(amount: amount, method: method, cit: service.citRate ?? 9, dividend: service.dividendTaxRate ?? 19)
        let editing = form != nil
        return box("Cennik") {
            if editing {
                Picker("Sposób rozliczenia", selection: Binding(get: { method }, set: { setMethod($0) })) {
                    ForEach(SubcontractorServiceText.methods, id: \.0) { Text($0.1).tag($0.0) }
                }
            } else {
                LabeledContent("Sposób rozliczenia", value: SubcontractorServiceText.methods.first { $0.0 == method }?.1 ?? "")
            }
            if method == "invoice" {
                if editing {
                    Picker("Stawka VAT", selection: Binding(get: { service.vatRate ?? 23 }, set: { setVat($0) })) {
                        Text(verbatim: "0% (zwolniony z VAT)").tag(0.0)
                        Text(verbatim: "5%").tag(5.0)
                        Text(verbatim: "8%").tag(8.0)
                        Text(verbatim: "23%").tag(23.0)
                    }
                    InvoiceNumberField(title: "Cena netto", value: Binding(get: { form?.priceNet ?? 0 }, set: { setNet($0) }))
                    InvoiceNumberField(title: "Cena brutto", value: Binding(get: { form?.priceGross ?? 0 }, set: { setGross($0) }))
                } else {
                    LabeledContent("Stawka VAT") {
                        Text(verbatim: service.vatRate == 0 ? "0% (zwolniony z VAT)" : "\(InvoiceMath.plain(service.vatRate ?? 23))%")
                    }
                    LabeledContent("Cena netto", value: SubcontractorServiceText.money(service.priceNet))
                    LabeledContent("Cena brutto", value: SubcontractorServiceText.money(service.priceGross))
                }
            } else {
                if editing {
                    InvoiceNumberField(title: "Kwota dla podwykonawcy „do ręki”", value: Binding(get: { amount }, set: { setCash($0) }))
                } else {
                    LabeledContent("Kwota dla podwykonawcy „do ręki”", value: SubcontractorServiceText.money(amount))
                }
                if method == "cash_non_deductible" {
                    if editing {
                        HStack {
                            InvoiceNumberField(title: "CIT (%)", value: Binding(get: { form?.citRate ?? 9 }, set: { form?.citRate = $0 }))
                            InvoiceNumberField(title: "Podatek od dywidendy (%)", value: Binding(get: { form?.dividendTaxRate ?? 19 }, set: { form?.dividendTaxRate = $0 }))
                        }
                    }
                    Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 6) {
                        GridRow {
                            Text("Do ręki").font(.caption).foregroundStyle(.secondary)
                            Text("Koszt ekonomiczny").font(.caption).foregroundStyle(.secondary)
                            Text("Efektywne podatki").font(.caption).foregroundStyle(.secondary)
                            Text("Narzut finansowania").font(.caption).foregroundStyle(.secondary)
                        }
                        GridRow {
                            Text(verbatim: SubcontractorServiceText.money(cost.contractorAmount)).fontWeight(.semibold)
                            Text(verbatim: SubcontractorServiceText.money(cost.economicCost)).fontWeight(.semibold).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                            Text(verbatim: String(format: "%.2f", cost.effectiveTaxRate) + "%").fontWeight(.semibold)
                            Text(verbatim: String(format: "%.2f", cost.grossUpRate) + "%").fontWeight(.semibold)
                        }
                    }
                    Text("Kalkulacja pokazuje zysk spółki przed CIT potrzebny do sfinansowania prywatnej wypłaty po podatku od dywidendy. Nie zastępuje dokumentu ani oceny księgowej podstawy wypłaty.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if !editing, let unitPrice = service.unitPrice, unitPrice > 0 {
                LabeledContent("Cena za jednostkę:", value: "\(SubcontractorServiceText.money(unitPrice)) / \(service.unit.nonEmpty ?? "szt")")
            }
        }
    }

    // MARK: Galeria
    private func gallery(_ data: ServiceCatalogData, _ service: ServiceCatalogData.Service) -> some View {
        let images = service.images
        let editing = form != nil
        return box("Galeria zdjęć") {
            if data.canEdit && editing {
                Button { picking = true } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "square.and.arrow.up").font(.title2)
                        Text("Przeciągnij zdjęcia tutaj lub kliknij, aby wybrać")
                        Text("Maksymalny rozmiar: 10MB (zdjęcia zostaną automatycznie skompresowane)").font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(20)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(style: StrokeStyle(lineWidth: 2, dash: [6, 4])).foregroundStyle(theme.accent.opacity(0.4)))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .dropDestination(for: URL.self) { urls, _ in
                    Task { await upload(urls) }
                    return !urls.isEmpty
                }
            }
            ForEach(uploading, id: \.self) { name in
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text(name).font(.callout) }
            }
            if images.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary)
                    Text("Brak zdjęć").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity).padding(20)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(images) { image in
                        RemoteThumbnail(url: image.url).frame(height: 130).clipShape(RoundedRectangle(cornerRadius: 8))
                            .contentShape(Rectangle())
                            .onTapGesture { preview = image }
                            .overlay(alignment: .topLeading) {
                                if image.isPrimary == true { Image(systemName: "star.fill").foregroundStyle(theme.accent).padding(6) }
                            }
                            .overlay(alignment: .bottomTrailing) {
                                if data.canEdit && editing {
                                    HStack(spacing: 4) {
                                        if image.isPrimary != true {
                                            Button { setPrimary(image) } label: { Image(systemName: "star") }.help("Ustaw jako główne")
                                        }
                                        Button(role: .destructive) { removeImage(image) } label: { Image(systemName: "trash") }.help("Usuń")
                                    }
                                    .buttonStyle(.borderless).padding(4).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 5)).padding(6)
                                }
                            }
                    }
                }
            }
        }
    }

    private func setImages(_ images: [SubcontractorServiceImage]) {
        guard var next = form else { return }
        next.images = images
        next.thumbnailUrl = images.first { $0.isPrimary == true }?.url ?? images.first?.url
        form = next
    }
    private func setPrimary(_ image: SubcontractorServiceImage) {
        guard let images = form?.images else { return }
        setImages(images.map { var copy = $0; copy.isPrimary = $0.url == image.url; return copy })
        state.succeed("Ustawiono jako główne zdjęcie")
    }
    /// Usunięcie z galerii; plik znika z koszyka dopiero po zapisie (anulowanie edycji go zachowuje).
    private func removeImage(_ image: SubcontractorServiceImage) {
        guard let images = form?.images else { return }
        setImages(images.filter { $0.url != image.url })
        state.succeed("Zdjęcie usunięte")
    }

    private func previewOverlay(_ image: SubcontractorServiceImage) -> some View {
        let images = shown?.images ?? []
        let index = images.firstIndex { $0.url == image.url } ?? 0
        return ZStack {
            Color.black.opacity(0.85).onTapGesture { preview = nil }
            AsyncImage(url: URL(string: image.url)) { phase in
                switch phase {
                case .success(let picture): picture.resizable().scaledToFit()
                case .failure: Image(systemName: "photo").font(.largeTitle).foregroundStyle(.white.opacity(0.6))
                default: ProgressView().tint(.white)
                }
            }
            .padding(60)
            HStack {
                if images.count > 1 {
                    Button { preview = images[index - 1] } label: { Image(systemName: "chevron.left").font(.largeTitle) }
                        .buttonStyle(.plain).foregroundStyle(.white).disabled(index == 0)
                }
                Spacer()
                if images.count > 1 {
                    Button { preview = images[index + 1] } label: { Image(systemName: "chevron.right").font(.largeTitle) }
                        .buttonStyle(.plain).foregroundStyle(.white).disabled(index == images.count - 1)
                }
            }
            .padding(20)
            VStack {
                HStack {
                    Spacer()
                    Button { preview = nil } label: { Image(systemName: "xmark").font(.title) }.buttonStyle(.plain).foregroundStyle(.white)
                }
                Spacer()
            }
            .padding(20)
        }
    }

    // MARK: Dane
    private func load() async {
        do {
            data = try await SubcontractorServicesAPI.get(state, ["op": "service", "id": serviceID], as: ServiceCatalogData.self)
            loadError = nil
        } catch {
            loadError = SubcontractorServicesAPI.failure(error, "Nie znaleziono usługi")
        }
    }

    /// Jak `uploadFiles` w CRM: JPEG do folderu usługi, pierwsze zdjęcie pustej galerii — główne; jeden komunikat po serii.
    private func upload(_ urls: [URL]) async {
        guard form != nil else { return }
        var added = 0
        for url in urls {
            switch SubcontractorServicesAPI.jpeg(from: url) {
            case .rejected(let message): state.error = message
            case .jpeg(let jpeg):
                let name = url.lastPathComponent
                uploading.append(name)
                do {
                    let address = try await SubcontractorServicesAPI.upload(state, folder: serviceID, jpeg: jpeg, name: url.deletingPathExtension().lastPathComponent + ".jpg")
                    let current = form?.images ?? []
                    setImages(current + [SubcontractorServiceImage(url: address, title: name, isPrimary: current.isEmpty)])
                    added += 1
                } catch {
                    state.error = SubcontractorServicesAPI.failure(error, "Błąd przesyłania \(name)")
                }
                if let index = uploading.firstIndex(of: name) { uploading.remove(at: index) }
            }
        }
        if added > 0 { state.succeed("Przesłano zdjęcia") }
    }

    private func save() async {
        guard let form else { return }
        guard state.canWrite else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        saving = true
        defer { saving = false }
        let optional = { (value: Double?) -> JSONValue in value.map { .number($0) } ?? .null }
        let body: [String: JSONValue] = [
            "name": .string(form.name), "description": .string(form.description), "category": .string(form.category), "unit": .string(form.unit),
            "includedHours": optional(form.includedHours), "overtimeHourlyRate": optional(form.overtimeHourlyRate),
            "travelRatePerKm": optional(form.travelRatePerKm), "performanceRequirements": .string(form.performanceRequirements),
            "unitPrice": optional(form.unitPrice), "vatRate": optional(form.vatRate), "priceNet": optional(form.priceNet),
            "priceGross": optional(form.priceGross), "settlementMethod": .string(form.settlementMethod),
            "cashPayoutAmount": optional(form.cashPayoutAmount), "citRate": optional(form.citRate), "dividendTaxRate": optional(form.dividendTaxRate),
            "isActive": .bool(form.isActive), "images": .array(form.images.map(\.json)), "thumbnailUrl": .string(form.thumbnailUrl ?? ""),
        ]
        do {
            let reply = try await SubcontractorServicesAPI.post(state, ["op": .string("serviceSave"), "id": .string(serviceID), "form": .object(body)])
            state.succeed(reply["message"]?.text.nonEmpty ?? "Zapisano zmiany")
            self.form = nil
            await load()
            onChanged()
        } catch {
            state.error = SubcontractorServicesAPI.failure(error, "Błąd podczas zapisywania")
        }
    }

    private func remove() async {
        guard state.canWrite else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        saving = true
        defer { saving = false }
        do {
            let reply = try await SubcontractorServicesAPI.post(state, ["op": .string("serviceDelete"), "id": .string(serviceID)])
            state.succeed(reply["message"]?.text.nonEmpty ?? "Usługa została usunięta")
            dismiss()
            onChanged()
        } catch {
            state.error = SubcontractorServicesAPI.failure(error, "Błąd podczas usuwania")
        }
    }
}
