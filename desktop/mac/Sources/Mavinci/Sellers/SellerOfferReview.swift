import AppKit
import SwiftUI

// MARK: Ocena oferty z portalu sprzedawcy na Macu — w karcie oferty, zamiast odsyłania do CRM. Oś w 5 etapach (widok opiekuna),
// zgoda na cenę (pozycja własna albo cena poniżej stawki), PDF z wysłania, potwierdzenia terminu i zespołu, analiza sprzętu
// i decyzja: akceptacja, prośba o zmiany albo odmowa. Stan i warunki serwera — `/bridge/native/v1/sellers?op=offer`
// (`src/lib/native/sellerOffer.ts`), decyzja, PDF i analiza sprzętu — ta sama trasa co CRM (`/bridge/seller/offers/[id]`).
// Potwierdzenie realizacji po akceptacji — w karcie wydarzenia i w CRM.

struct SellerOfferReviewState: Decodable {
    struct Party: Decodable { let name: String; let organization: String }
    struct Client: Decodable { let name: String; let company: String; let email: String?; let phone: String? }
    struct Item: Decodable, Identifiable { let id: String; let name: String; let quantity: Double; let unit: String; let days: Double }
    struct Review: Decodable {
        let status: String; let statusLabel: String; let current: Bool; let requestNote: String; let responseNote: String
        let requestedAt: String?; let reviewedAt: String?; let documentId: String
    }
    struct Document: Decodable, Identifiable { let id: String; let filename: String; let createdAt: String; let current: Bool }
    struct Decision: Decodable {
        let canDecide: Bool; let mode: String?; let action: String; let documentId: String?; let contextKey: String?
        let pastDate: Bool; let dateError: String?; let blockers: [String]; let approvalBlockers: [String]
    }
    struct Realization: Decodable {
        let offerStatus: String; let stage: String; let eventId: String?; let eventStatus: String?
        let canViewEvent: Bool; let accepted: Bool; let confirmed: Bool; let cancelled: Bool
    }
    struct PriceItem: Decodable { let name: String; let custom: Bool; let quantity: String; let basePrice: String?; let clientPrice: String; let below: Bool }
    struct PriceRequest: Decodable { let status: String; let note: String; let requestedAt: String?; let responseNote: String; let decidedBy: String?; let current: Bool }
    struct Price: Decodable { let status: String; let statusLabel: String; let priceKey: String?; let canDecide: Bool; let items: [PriceItem]; let request: PriceRequest? }
    struct Links: Decodable { let crm: String; let event: String? }
    let offerId: String
    let title: String?
    let number: String?
    let canManage: Bool
    let seller: Party
    let client: Client
    let eventDate: String?
    let location: String
    let items: [Item]
    let summaryError: String?
    let journey: SellerCardState.Journey
    let review: Review?
    let reviewRaw: JSONValue?
    let documents: [Document]
    let decision: Decision
    let realization: Realization?
    let price: Price?
    let priceError: String?
    let links: Links
}

/// Wynik analizy sprzętu (`check_equipment`, `src/lib/seller/equipmentReview.ts`).
struct SellerEquipmentReview: Decodable {
    struct Period: Decodable { let start: String; let end: String; let whole_days: Bool; let includes_preparation: Bool }
    struct Row: Decodable { let id: String; let name: String; let required: Double; let total: Double; let reserved: Double; let available: Double; let shortage: Double; let sources: [String]; let repeated: Bool }
    struct Issue: Decodable { let product_id: String?; let name: String; let message: String }
    let key: String
    let context_key: String
    let checked_at: String
    let status: String
    let period: Period
    let rows: [Row]
    let issues: [Issue]
    var label: String {
        switch status {
        case "clear": return "Nie wykryto braków sprzętu"
        case "conflict": return "Wykryto niedobory sprzętu"
        default: return "Analiza wymaga uzupełnienia"
        }
    }
}

@MainActor final class SellerOfferReviewStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var data: SellerOfferReviewState?
    @Published var error: String?
    @Published private(set) var loading = false
    @Published private(set) var pdf: Data?
    @Published private(set) var pdfDocumentID: String?
    @Published var pdfError: String?
    @Published private(set) var pdfLoading = false
    @Published private(set) var equipment: SellerEquipmentReview?
    @Published var equipmentError: String?
    @Published private(set) var equipmentLoading = false
    @Published private(set) var busy = false

    private var api: NativeAPI? { workspace?.nativeAPI() }

    private func text(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if let error = error as? URLError { return error.code == .timedOut ? "Operacja trwała zbyt długo. Odśwież status przed ponowieniem." : "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    func load(_ offerID: String) async {
        guard let api else { error = "Brak połączenia z serwerem CRM."; return }
        loading = true
        defer { loading = false }
        do {
            let next = try JSONDecoder().decode(SellerOfferReviewState.self, from: try await api.get("/sellers?op=offer&id=\(offerID)"))
            data = next
            error = nil
            if next.decision.canDecide {
                if let document = next.decision.documentId, pdfDocumentID != document { await loadPdf(offerID, documentID: document) }
                if let key = next.decision.contextKey, equipment?.context_key != key, !equipmentLoading { await checkEquipment(offerID) }
            }
        } catch {
            self.error = text(error, "Nie udało się wczytać oceny oferty.")
        }
    }

    /// POST na trasę oferty sprzedawcy w CRM (`/bridge/seller/offers/[id]`) tokenem pracownika — jak przeglądarka.
    private func bridge(_ offerID: String, _ body: [String: JSONValue], timeout: TimeInterval = 60) async throws -> Data {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/seller/offers/\(offerID)") else {
            throw AppError.configuration
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: JSONValue].self, from: data))?["error"]?.text ?? ""
            throw NativeFailure(status: status, message: message.isEmpty ? "Serwer nie wykonał operacji (\(status))." : message, fieldErrors: [:])
        }
        return data
    }

    func loadPdf(_ offerID: String, documentID: String) async {
        pdfLoading = true; pdfError = nil
        defer { pdfLoading = false }
        do {
            let file = try await bridge(offerID, ["action": .string("document"), "documentId": .string(documentID)], timeout: 210)
            guard file.starts(with: Data("%PDF".utf8)) else { throw NativeFailure(status: 0, message: "Serwer nie zwrócił pliku PDF.", fieldErrors: [:]) }
            pdf = file; pdfDocumentID = documentID
        } catch {
            pdf = nil; pdfDocumentID = nil
            pdfError = text(error, "Nie udało się wczytać PDF do oceny.")
        }
    }

    func checkEquipment(_ offerID: String) async {
        guard let key = data?.decision.contextKey else { return }
        equipmentLoading = true; equipmentError = nil
        defer { equipmentLoading = false }
        do {
            let result = try JSONDecoder().decode(SellerEquipmentReview.self,
                from: try await bridge(offerID, ["action": .string("check_equipment"), "expectedContextKey": .string(key)], timeout: 45))
            guard result.context_key == key else { throw NativeFailure(status: 0, message: "Dane oferty zmieniły się. Odśwież status oferty przed analizą.", fieldErrors: [:]) }
            equipment = result
        } catch {
            equipment = nil
            equipmentError = (error as? URLError)?.code == .timedOut ? "Sprawdzanie trwało zbyt długo. Ponów analizę; dostępność nie została potwierdzona."
                : text(error, "Analiza jest niedostępna. Ponów sprawdzenie.")
        }
    }

    /// Decyzja oceny — te same pola co CRM (`SellerOfferWorkflow.tsx`). `true` — decyzja zapisana.
    func decide(_ offerID: String, decision: String, checks: (date: Bool, capacity: Bool), response: String,
                confirmPastDate: Bool, exception: (confirmed: Bool, reason: String)) async -> Bool {
        guard let workspace, workspace.canWrite, let data, let document = data.decision.documentId else {
            workspace?.error = "Zapis wymaga połączenia z serwerem CRM."
            return false
        }
        busy = true
        defer { busy = false }
        let body: [String: JSONValue] = [
            "action": .string(data.decision.action),
            "documentId": .string(document),
            "decision": .string(decision),
            "checks": .object(["date": .bool(checks.date), "capacity": .bool(checks.capacity)]),
            "response": .string(response),
            "expectedReview": data.reviewRaw ?? .null,
            "expectedContextKey": data.decision.contextKey.map(JSONValue.string) ?? .null,
            "confirmPastDate": .bool(confirmPastDate),
            "equipmentKey": equipment.map { JSONValue.string($0.key) } ?? .null,
            "equipmentException": .object(["confirmed": .bool(exception.confirmed), "reason": .string(exception.reason)]),
        ]
        do {
            _ = try await workspace.withPending("Zapisywanie decyzji…") { try await bridge(offerID, body, timeout: 120) }
        } catch {
            workspace.error = text(error, "Nie udało się zapisać decyzji.")
            if decision == "approved" { await checkEquipment(offerID) }
            return false
        }
        workspace.succeed(decision == "approved"
            ? "Oferta zaakceptowana i powiązana z wydarzeniem w CRM. Możesz przygotować Timeline, zespół, agendę i logistykę. Realizacja nadal oczekuje na potwierdzenie."
            : "Decyzja i wiadomość dla sprzedawcy zostały zapisane.")
        await load(offerID)
        return true
    }

    /// Zgoda na cenę albo prośba o zmianę (`decide_seller_offer_price_approval`) dla cen widocznych na ekranie.
    func decidePrice(_ offerID: String, decision: String, note: String) async -> Bool {
        guard let api, let workspace, workspace.canWrite, let price = data?.price else {
            workspace?.error = "Zapis wymaga połączenia z serwerem CRM."
            return false
        }
        busy = true
        defer { busy = false }
        do {
            let reply = try await workspace.withPending("Zapisywanie zgody na cenę…") {
                try await api.post("/sellers", ["op": .string("priceDecide"), "id": .string(offerID), "decision": .string(decision),
                                                "note": .string(note), "expectedKey": price.priceKey.map(JSONValue.string) ?? .null])
            }
            let message = (try? JSONDecoder().decode([String: JSONValue].self, from: reply))?["message"]?.text ?? ""
            workspace.succeed(message.isEmpty ? "Zapisano decyzję o cenie." : message)
            await load(offerID)
            return true
        } catch {
            workspace.error = text(error, "Nie udało się zapisać decyzji o cenie.")
            await load(offerID)
            return false
        }
    }
}

@MainActor struct SellerOfferReviewPanel: View {
    let offerID: String
    /// Po decyzji: odśwież kartę oferty i kokpit.
    let onChanged: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @StateObject private var store = SellerOfferReviewStore()
    @State private var dateChecked = false
    @State private var capacityChecked = false
    @State private var pastDateConfirmed = false
    @State private var exceptionConfirmed = false
    @State private var exceptionReason = ""
    @State private var response = ""
    @State private var priceNote = ""
    @State private var rejecting = false
    @State private var pdfSheet: OfferPdfPreview?
    @State private var helpShown = false
    @State private var scope = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            if let data = store.data {
                content(data)
            } else if let error = store.error {
                HStack {
                    Text(error).foregroundStyle(.red).font(.callout)
                    Spacer()
                    Button("Spróbuj ponownie") { Task { await store.load(offerID) } }
                }
            } else {
                ProgressView("Wczytywanie oceny oferty…").frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .padding(16)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
        .task(id: offerID) {
            store.workspace = state
            await store.load(offerID)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            // Jak CRM po powrocie do karty: świeży stan (ktoś mógł już ocenić ofertę albo sprzedawca zmienił ceny).
            guard !store.busy else { return }
            Task { await store.load(offerID) }
        }
        .onChange(of: decisionScope) { _, value in
            // Nowa wersja, nowe zgłoszenie albo zmiana terminu / zakresu — potwierdzenia od nowa (jak w CRM).
            guard value != scope else { return }
            scope = value
            dateChecked = false; capacityChecked = false; pastDateConfirmed = false; response = ""
            exceptionConfirmed = false; exceptionReason = ""
        }
        .onChange(of: store.equipment?.key) { _, _ in exceptionConfirmed = false; exceptionReason = "" }
        .sheet(item: $pdfSheet) { file in OfferPdfViewer(file: file) }
        .sheet(isPresented: $helpShown) { SellersHelpSheet(store: state.sellers, initialChapter: "ocena") }
        .confirmationDialog("Odrzucić ofertę?", isPresented: $rejecting, titleVisibility: .visible) {
            Button("Odrzuć ofertę", role: .destructive) { Task { await submit("rejected") } }
            Button("Wróć do oceny", role: .cancel) {}
        } message: {
            Text("Sprzedawca otrzyma odmowę wraz z wpisanym uzasadnieniem. Dokument i historia pozostaną zapisane.")
        }
    }

    private var decisionScope: String {
        guard let data = store.data else { return "" }
        return [data.decision.documentId ?? "", data.decision.contextKey ?? "", data.review?.requestedAt ?? "", data.review?.status ?? ""].joined(separator: "|")
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.crop.circle.badge.checkmark").foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.data?.realization?.accepted == true || store.data?.realization?.confirmed == true ? "Oferta z portalu sprzedawcy — realizacja" : "Oferta z portalu sprzedawcy — ocena opiekuna")
                    .font(.callout.weight(.semibold))
                Text("Sprawdź zakres i PDF, potwierdź termin, zespół i sprzęt, potem zapisz decyzję. Potwierdzenie wydarzenia to następny krok.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if store.loading { ProgressView().controlSize(.small) }
            Button { helpShown = true } label: { Image(systemName: "questionmark.circle") }.help("Instrukcja opiekuna: zgoda na cenę i ocena oferty")
            Button { Task { await store.load(offerID) } } label: { Image(systemName: "arrow.clockwise") }.help("Odśwież status oceny")
            Button("Otwórz w CRM") { state.openCRM("/crm/offers/\(offerID)") }
        }
        .controlSize(.small).buttonStyle(.borderless)
    }

    @ViewBuilder private func content(_ data: SellerOfferReviewState) -> some View {
        journey(data)
        facts(data)
        if let error = data.priceError { Text(error).font(.caption).foregroundStyle(.orange) }
        if let price = data.price { priceSection(price) }
        if data.decision.canDecide {
            reviewSection(data)
        } else if let review = data.review {
            reviewOutcome(review, data: data)
        }
        if let realization = data.realization, realization.accepted || realization.confirmed || realization.cancelled {
            realizationSection(realization, data: data)
        }
    }

    // MARK: Oś i fakty

    private func journey(_ data: SellerOfferReviewState) -> some View {
        let tone = SellerTone.color(data.journey.tone, accent: theme.accent)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                ForEach(Array(SellerJourneyBar.labels.enumerated()), id: \.offset) { index, label in
                    Text("\(index + 1). \(label)").font(.caption2.weight(index == data.journey.index ? .semibold : .regular))
                        .foregroundStyle(index == data.journey.index ? tone : Color.secondary)
                    if index < SellerJourneyBar.labels.count - 1 { Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(.tertiary) }
                }
            }
            SellerJourneyBar(index: data.journey.index, tone: tone, ended: data.journey.ended)
            HStack(spacing: 8) {
                Text("\(data.journey.stageLabel) · \(data.journey.state)").font(.caption.weight(.medium)).foregroundStyle(tone)
                if data.journey.actor != "—" && !data.journey.ended { Text("Teraz działa: \(data.journey.actor)").font(.caption).foregroundStyle(.secondary) }
            }
            Text("Teraz: \(data.journey.now)").font(.callout).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background((data.journey.needsAction ? theme.accent : Color.primary).opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private func facts(_ data: SellerOfferReviewState) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top)], alignment: .leading, spacing: 10) {
            fact("Sprzedawca", [data.seller.name, data.seller.organization].filter { !$0.isEmpty }.joined(separator: " · "))
            fact("Klient", [data.client.company, data.client.name, data.client.email ?? "", data.client.phone ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
            fact("Termin i miejsce", [data.eventDate.map { Labels.date($0) } ?? "brak terminu", data.location].filter { !$0.isEmpty }.joined(separator: " · "))
            fact("Zakres", scopeText(data))
        }
    }

    private func scopeText(_ data: SellerOfferReviewState) -> String {
        guard !data.items.isEmpty else { return data.summaryError ?? "Brak pozycji" }
        var lines: [String] = []
        for item in data.items {
            let days = item.days > 1 ? " × " + number(item.days) + " dni" : ""
            lines.append(item.name + " — " + number(item.quantity) + " " + item.unit + days)
        }
        return lines.joined(separator: "\n")
    }

    /// „ · wczoraj” — dopisek z datą względną (pusty bez daty).
    private func when(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "" }
        return " · " + SellerDates.relative(value)
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.isEmpty ? "—" : value).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier: "pl_PL")))
    }

    // MARK: Zgoda na cenę

    private func priceSection(_ price: SellerOfferReviewState.Price) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Zgoda na cenę", systemImage: "tag").font(.headline)
                Spacer()
                Text(price.statusLabel).font(.caption.weight(.semibold))
                    .foregroundStyle(price.status == "required" ? Color.orange : price.status == "approved" ? Color.green : Color.secondary)
            }
            Text("Pozycja własna albo cena poniżej stawki. Do zgody hotel nie pobierze PDF dla klienta ani nie wyśle linku. Zgoda dotyczy tych pozycji i cen.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                GridRow {
                    Text("Pozycja").font(.caption).foregroundStyle(.secondary)
                    Text("Ilość").font(.caption).foregroundStyle(.secondary)
                    Text("Cennik MAVINCI").font(.caption).foregroundStyle(.secondary)
                    Text("Cena dla klienta").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(Array(price.items.enumerated()), id: \.offset) { _, item in
                    GridRow {
                        Text(item.name).lineLimit(2)
                        Text(item.quantity).font(.caption).monospacedDigit()
                        Text(item.basePrice ?? "—").font(.caption).monospacedDigit().foregroundStyle(item.custom ? Color.orange : Color.primary)
                        Text(item.clientPrice).font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(item.below ? Color.orange : Color.primary)
                    }
                }
            }
            if let request = price.request {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Prośba sprzedawcy" + when(request.requestedAt) + (request.current ? "" : " · dotyczy wcześniejszych cen"))
                        .font(.caption).foregroundStyle(.secondary)
                    if !request.note.isEmpty { Text("„\(request.note)”").font(.callout) }
                    if !request.responseNote.isEmpty {
                        Text("Odpowiedź" + (request.decidedBy.map { " (" + $0 + ")" } ?? "") + ": " + request.responseNote).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if price.canDecide {
                TextField("Uwagi dla sprzedawcy (przy prośbie o zmianę — wymagane)", text: $priceNote, axis: .vertical)
                    .lineLimit(2...5).textFieldStyle(.roundedBorder)
                HStack {
                    Button("Zatwierdź ceny") { Task { if await store.decidePrice(offerID, decision: "approved", note: priceNote) { priceNote = ""; onChanged() } } }
                        .buttonStyle(.borderedProminent)
                    Button("Poproś o zmianę ceny") {
                        guard priceNote.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 else {
                            state.error = "Napisz sprzedawcy, którą cenę lub pozycję trzeba zmienić."; return
                        }
                        Task { if await store.decidePrice(offerID, decision: "changes_requested", note: priceNote) { priceNote = ""; onChanged() } }
                    }
                }
                .disabled(store.busy || !state.canWrite)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(price.status == "required" ? 0.07 : 0.03), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Ocena

    private func reviewSection(_ data: SellerOfferReviewState) -> some View {
        let decision = data.decision
        let pdfLoaded = store.pdf != nil && store.pdfDocumentID == decision.documentId
        let response = self.response.trimmingCharacters(in: .whitespacesAndNewlines)
        let equipmentOK = store.equipment.map { $0.status == "clear" || (exceptionConfirmed && (10...2000).contains(exceptionReason.trimmingCharacters(in: .whitespacesAndNewlines).count)) } ?? false
        var blockers = decision.blockers
        if store.busy { blockers.append("Poczekaj na zakończenie bieżącej operacji.") }
        if decision.documentId != nil && !pdfLoaded { blockers.append(store.pdfLoading ? "Poczekaj na wczytanie podglądu PDF z aktualnego zapytania." : "Wczytaj PDF z aktualnego zapytania — inna wersja nie może zostać zaakceptowana.") }
        var approval = blockers + decision.approvalBlockers
        if !dateChecked { approval.append("Zaznacz „Sprawdzono termin”.") }
        if !capacityChecked { approval.append("Zaznacz „Sprawdzono dostępność zespołu”.") }
        if store.equipmentLoading { approval.append("Trwa sprawdzanie dostępności sprzętu.") }
        else if !equipmentOK {
            approval.append(store.equipment == nil ? "Ponów analizę sprzętu — nie ma aktualnego wyniku."
                : !exceptionConfirmed ? "Wyjaśnij braki sprzętu lub potwierdź osobną weryfikację w sekcji kontroli sprzętu."
                : "Uzupełnij uzasadnienie zapewnienia sprzętu (10–2000 znaków).")
        }
        if decision.pastDate && !pastDateConfirmed { approval.append("Potwierdź świadomą ocenę terminu z przeszłości albo poproś o poprawienie daty.") }
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(decision.mode == "pending" ? "Ocena oferty wysłanej przez sprzedawcę" : "Ocena oferty bez zgłoszenia sprzedawcy", systemImage: "doc.text.magnifyingglass").font(.headline)
                Spacer()
                if let review = data.review, review.current { Text(review.statusLabel).font(.caption).foregroundStyle(.secondary) }
            }
            if let review = data.review, review.current, !review.requestNote.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Wiadomość sprzedawcy" + when(review.requestedAt)).font(.caption).foregroundStyle(.secondary)
                    Text(review.requestNote).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            pdfBox(data)
            VStack(alignment: .leading, spacing: 6) {
                Toggle("Sprawdzono termin w kalendarzu", isOn: $dateChecked)
                Toggle("Sprawdzono dostępność zespołu", isOn: $capacityChecked)
                if decision.pastDate { Toggle("Termin jest w przeszłości — świadomie oceniam wydarzenie historyczne", isOn: $pastDateConfirmed) }
                if let error = decision.dateError { Text(error).font(.caption).foregroundStyle(.orange) }
            }
            .toggleStyle(.checkbox)
            equipmentBox
            VStack(alignment: .leading, spacing: 4) {
                Text("Wiadomość dla sprzedawcy (wymagana przy prośbie o zmiany i odmowie)").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $response).font(.body).frame(minHeight: 80)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
            }
            if !approval.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Do odblokowania akceptacji").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                    ForEach(Array(approval.enumerated()), id: \.offset) { _, item in Text("• \(item)").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                }
            }
            HStack {
                Button("Zaakceptuj ofertę") { Task { await submit("approved") } }
                    .buttonStyle(.borderedProminent).disabled(!approval.isEmpty || !state.canWrite)
                Button("Poproś o zmiany") { Task { await submit("changes_requested") } }
                    .disabled(!blockers.isEmpty || response.isEmpty || !state.canWrite)
                Button("Nie przyjmuj", role: .destructive) { rejecting = true }
                    .disabled(!blockers.isEmpty || response.isEmpty || !state.canWrite)
                Spacer()
                Text("Akceptacja tworzy wydarzenie w CRM do przygotowania. Nie rezerwuje sprzętu i nie potwierdza terminu.").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private func pdfBox(_ data: SellerOfferReviewState) -> some View {
        let document = data.documents.first { $0.id == data.decision.documentId }
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("PDF do oceny" + (document.map { " · " + $0.filename } ?? "")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                if let pdf = store.pdf, store.pdfDocumentID == data.decision.documentId {
                    Button("Powiększ") { pdfSheet = OfferPdfPreview(data: pdf, name: document?.filename ?? "Oferta.pdf") }.controlSize(.small)
                }
                if let id = data.decision.documentId {
                    Button("Wczytaj ponownie") { Task { await store.loadPdf(offerID, documentID: id) } }.controlSize(.small).disabled(store.pdfLoading)
                }
            }
            if data.decision.documentId == nil {
                Text("Potrzebny jest aktualny PDF przekazany do oceny. Poproś sprzedawcę o wygenerowanie PDF.").font(.callout).foregroundStyle(.orange)
            } else if let pdf = store.pdf, store.pdfDocumentID == data.decision.documentId {
                NativePDF(data: pdf).frame(height: 460).clipShape(RoundedRectangle(cornerRadius: 8))
            } else if store.pdfLoading {
                ProgressView("Wczytywanie PDF z aktualnego zapytania…").frame(maxWidth: .infinity, minHeight: 120)
            } else if let error = store.pdfError {
                Text(error).font(.callout).foregroundStyle(.red)
            }
        }
    }

    private var equipmentBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Automatyczna kontrola sprzętu").font(.caption.weight(.semibold))
                Spacer()
                Button { Task { await store.checkEquipment(offerID) } } label: { Label("Sprawdź ponownie", systemImage: "arrow.clockwise") }
                    .controlSize(.small).disabled(store.equipmentLoading)
            }
            if store.equipmentLoading { ProgressView("Sprawdzanie magazynu i rezerwacji…").controlSize(.small) }
            if let error = store.equipmentError { Text(error).font(.caption).foregroundStyle(.orange) }
            if let review = store.equipment {
                Text(review.label + " · \(review.rows.count) modeli.")
                    .font(.callout).foregroundStyle(review.status == "clear" ? Color.green : Color.orange)
                Text(periodText(review.period))
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                ForEach(Array(review.issues.enumerated()), id: \.offset) { _, issue in
                    Text("\(issue.name): \(issue.message)").font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                }
                let short = review.rows.filter { $0.shortage > 0 }
                if !short.isEmpty {
                    ForEach(Array(short.enumerated()), id: \.offset) { _, row in
                        Text("\(row.name): potrzeba \(number(row.required)), dostępne \(number(row.available)), brakuje \(number(row.shortage))")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
                if review.status != "clear" {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("System nie potwierdził pełnej dostępności. Uzupełnij powiązania lub uzgodnij zamienniki. Możesz dopuścić ofertę tylko po osobnej weryfikacji braków.")
                            .font(.caption).fixedSize(horizontal: false, vertical: true)
                        Toggle("Sprawdziłem niepełny zakres / niedobory poza systemem i potwierdzam sposób zapewnienia sprzętu.", isOn: $exceptionConfirmed)
                            .toggleStyle(.checkbox).font(.caption)
                        if exceptionConfirmed {
                            TextField("Wewnętrzne uzasadnienie (co najmniej 10 znaków) — nie trafia do sprzedawcy", text: $exceptionReason, axis: .vertical)
                                .lineLimit(2...4).textFieldStyle(.roundedBorder)
                        }
                    }
                    .padding(10).background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                Text("Ostatnie sprawdzenie: \(SellerDates.relative(review.checked_at)). Przed akceptacją sprawdzimy ponownie. To analiza, nie rezerwacja.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func periodText(_ period: SellerEquipmentReview.Period) -> String {
        var text = Labels.date(period.start) + " — " + Labels.date(period.end) + " · czas polski."
        if period.whole_days { text += " Brak godzin: sprawdzamy pełne dni." }
        text += " Sprzęt jest liczony na cały okres, także pomiędzy dniami wydarzenia."
        text += period.includes_preparation ? " Uwzględniamy zapisany montaż i demontaż." : " Montaż i demontaż trzeba jeszcze uwzględnić po ich ustaleniu."
        return text
    }

    private func submit(_ decision: String) async {
        let text = response.trimmingCharacters(in: .whitespacesAndNewlines)
        if decision != "approved" && text.isEmpty { state.error = "Napisz, co sprzedawca ma poprawić lub dlaczego odrzucasz ofertę."; return }
        let saved = await store.decide(offerID, decision: decision, checks: (dateChecked, capacityChecked), response: text,
                                       confirmPastDate: pastDateConfirmed, exception: (exceptionConfirmed, exceptionReason))
        if saved {
            response = ""
            onChanged()
            Task { await state.sellers.load() }
        }
    }

    // MARK: Wynik oceny i realizacja

    private func reviewOutcome(_ review: SellerOfferReviewState.Review, data: SellerOfferReviewState) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(review.statusLabel + (review.current ? "" : " · dotyczy wcześniejszej wersji") + when(review.reviewedAt))
                .font(.callout.weight(.medium))
            if !review.responseNote.isEmpty { Text(review.responseNote).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
            if !data.canManage { Text("Decyzję podejmuje opiekun sprzedawcy.").font(.caption).foregroundStyle(.secondary) }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func realizationSection(_ realization: SellerOfferReviewState.Realization, data: SellerOfferReviewState) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: realization.cancelled ? "xmark.circle" : realization.confirmed ? "checkmark.seal" : "calendar.badge.clock")
                .foregroundStyle(realization.cancelled ? Color.red : realization.confirmed ? Color.green : theme.accent)
            VStack(alignment: .leading, spacing: 3) {
                Text(realization.cancelled ? "Wydarzenie anulowane" : realization.confirmed ? "Termin potwierdzony — przygotowanie realizacji" : "Oferta przyjęta — termin czeka na potwierdzenie")
                    .font(.callout.weight(.medium))
                Text(realization.confirmed || realization.cancelled
                     ? "Timeline, zespół, agendę i logistykę prowadzisz w wydarzeniu."
                     : realization.eventId != nil && realization.canViewEvent
                     ? "Sprawdź dane i potwierdź realizację w zakładce „Ustalenia” wydarzenia. Hotel zobaczy wtedy „Potwierdzone” i swoje kroki przygotowania."
                     : "Sprawdź dane i potwierdź realizację w karcie oferty w CRM. Hotel zobaczy wtedy „Potwierdzone” i swoje kroki przygotowania.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            if let eventID = realization.eventId, realization.canViewEvent {
                Button("Otwórz wydarzenie") {
                    state.sellerFocus = SellerArrangementsFocus(eventID: eventID, offerID: offerID, conversationID: nil, step: nil)
                    state.showEvent(eventID, cardTab: "seller-arrangements")
                }
            }
            if !realization.confirmed && !realization.cancelled {
                // Potwierdzenie realizacji jest natywne w zakładce „Ustalenia” wydarzenia (wskazana ta oferta).
                if let eventID = realization.eventId, realization.canViewEvent {
                    Button("Potwierdź realizację") {
                        state.sellerFocus = SellerArrangementsFocus(eventID: eventID, offerID: offerID, conversationID: nil, step: nil)
                        state.showEvent(eventID, cardTab: "seller-arrangements")
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Button("Potwierdź w CRM") { state.openCRM(data.links.crm) }.buttonStyle(.borderedProminent)
                }
            }
        }
        .controlSize(.small)
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}
