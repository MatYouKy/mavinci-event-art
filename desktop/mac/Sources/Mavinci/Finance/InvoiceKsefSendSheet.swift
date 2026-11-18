import SwiftUI

// MARK: Wysyłka faktury do KSeF — 1:1 z `KSeFSendModal`: trasa CRM `/bridge/ksef/invoices/send` (token pracownika) wysyła
// fakturę i strumieniem zdarzeń (`data: {…}`) raportuje kroki: walidacja, XML FA(3), autoryzacja, sesja, szyfrowanie
// i wysyłka, oczekiwanie na numer KSeF (próby), zapis wyniku. Wynik końcowy jest ostateczny — późniejsze zdarzenia go nie
// zmieniają. Okno da się zamknąć dopiero po wyniku (wysyłki nie można cofnąć).

@MainActor final class InvoiceKsefSendModel: ObservableObject {
    enum StepStatus: String { case pending, active, completed, error }
    struct Step: Identifiable {
        let id: String
        let label: String
        let description: String
        let symbol: String
        var status: StepStatus = .pending
    }

    static let config: [Step] = [
        Step(id: "validate", label: "Walidacja faktury", description: "Sprawdzanie danych faktury i organizacji", symbol: "doc.text"),
        Step(id: "xml", label: "Generowanie dokumentu XML", description: "Przygotowanie struktury FA(3) dla KSeF", symbol: "doc.text"),
        Step(id: "auth", label: "Autoryzacja sesji KSeF", description: "Weryfikacja uprawnień i pobieranie certyfikatów", symbol: "checkmark.shield"),
        Step(id: "session", label: "Otwieranie sesji szyfrowanej", description: "Nawiązywanie bezpiecznego połączenia z KSeF", symbol: "lock"),
        Step(id: "encrypt", label: "Szyfrowanie i wysyłka faktury", description: "Szyfrowanie dokumentu kluczem symetrycznym", symbol: "paperplane"),
        Step(id: "poll", label: "Oczekiwanie na potwierdzenie", description: "KSeF przetwarza fakturę i nadaje numer referencyjny", symbol: "dot.radiowaves.left.and.right"),
        Step(id: "save", label: "Zapisywanie wyniku", description: "Aktualizacja statusu faktury w systemie", symbol: "cylinder"),
    ]

    @Published var steps: [Step] = InvoiceKsefSendModel.config
    @Published var currentIndex = -1
    @Published var finished = false
    @Published var errorMessage: String?
    @Published var reference: String?
    @Published var pollAttempt = 0
    @Published var pollMax = 15
    let started = Date()
    @Published var finishedAt: Date?
    private var resultReceived = false
    private var requestStarted = false

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 600
        configuration.timeoutIntervalForResource = 1800
        configuration.httpShouldSetCookies = false
        return URLSession(configuration: configuration)
    }()

    var isError: Bool { errorMessage != nil }
    var isSuccess: Bool { finished && !isError }
    var completedCount: Int { steps.filter { $0.status == .completed }.count }

    /// Jedna wysyłka na okno (jak `requestStartedRef` w CRM) — ponowne pojawienie się widoku nie wysyła faktury drugi raz.
    func start(invoiceID: String, api: NativeAPI, onSuccess: @escaping (String) -> Void) async {
        guard !requestStarted else { return }
        requestStarted = true
        do {
            guard let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/ksef/invoices/send") else {
                throw AppError.configuration
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
            request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONEncoder().encode(["invoiceId": invoiceID])
            let (bytes, response) = try await Self.session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
            guard (200..<300).contains(http.statusCode) else {
                var data = Data()
                for try await byte in bytes {
                    data.append(byte)
                    if data.count > 4000 { break }
                }
                let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
                let text = object["error"]?.text.nonEmpty ?? String(decoding: data, as: UTF8.self)
                fail("Błąd endpointu KSeF: \(http.statusCode). \(String(text.prefix(500)))")
                return
            }
            let contentType = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            guard contentType.contains("text/event-stream") else {
                fail("Endpoint KSeF nie zwrócił streamu SSE. Content-Type: \(contentType).")
                return
            }
            for try await line in bytes.lines {
                if resultReceived { break }
                guard line.hasPrefix("data: ") else { continue }
                guard let event = try? JSONDecoder().decode([String: JSONValue].self, from: Data(line.dropFirst(6).utf8)) else { continue }
                process(event, onSuccess: onSuccess)
            }
            if !resultReceived { fail("Połączenie z endpointem KSeF zakończyło się bez wyniku.") }
        } catch {
            guard !resultReceived else { return }
            if let failure = error as? NativeFailure { fail(failure.message) }
            else if error is URLError { fail("Połączenie z serwerem CRM zostało przerwane. Sprawdź stan wysyłki na karcie faktury przed ponowną próbą.") }
            else { fail((error as? AppError)?.localizedDescription ?? "Nieznany błąd") }
        }
    }

    private func fail(_ message: String) {
        errorMessage = message
        finish()
    }

    private func finish() {
        finished = true
        if finishedAt == nil { finishedAt = Date() }
    }

    private func process(_ data: [String: JSONValue], onSuccess: (String) -> Void) {
        // Wynik końcowy jest ostateczny, nawet gdy strumień przyśle później inne zdarzenie.
        guard !resultReceived else { return }
        switch data["type"]?.text ?? "" {
        case "progress":
            guard let index = steps.firstIndex(where: { $0.id == data["step"]?.text }) else { return }
            currentIndex = index
            let status = StepStatus(rawValue: data["status"]?.text ?? "") ?? .active
            for position in steps.indices {
                if position < index { steps[position].status = .completed }
                else if position == index { steps[position].status = status }
            }
            if steps[index].id == "poll" {
                if let attempt = data["attempt"], attempt.number > 0 { pollAttempt = Int(attempt.number) }
                if let maximum = data["maxAttempts"], maximum.number > 0 { pollMax = Int(maximum.number) }
            }
            if status == .error {
                errorMessage = data["message"]?.text.nonEmpty ?? "Błąd wysyłki do KSeF"
                finish()
            }
        case "result":
            resultReceived = true
            if data["success"]?.flag == true {
                reference = data["ksef_reference_number"]?.text.nonEmpty
                for position in steps.indices { steps[position].status = .completed }
                currentIndex = steps.count - 1
                errorMessage = nil
                finish()
                onSuccess(reference ?? "")
            } else {
                let message = data["error"]?.text.nonEmpty ?? "Nieznany błąd KSeF"
                let details: String? = {
                    switch data["details"] {
                    case .array(let values)?: return values.map { $0.text }.filter { !$0.isEmpty }.joined(separator: ", ").nonEmpty
                    case .string(let value)?: return value.nonEmpty
                    default: return nil
                    }
                }()
                errorMessage = details.map { "\(message): \($0)" } ?? message
                let failedAt = max(currentIndex, 0)
                for position in steps.indices {
                    if position < failedAt { steps[position].status = .completed }
                    else if position == failedAt { steps[position].status = .error }
                }
                finish()
            }
        default:
            return
        }
    }
}

@MainActor struct InvoiceKsefSendSheet: View {
    let invoiceID: String
    let invoiceNumber: String
    /// Po przyjęciu przez KSeF (numer referencyjny) — odświeżenie karty i ponowny PDF z kodem KSeF, jak w CRM.
    let onSuccess: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model = InvoiceKsefSendModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(model.steps) { step in stepRow(step) }
                }
                .padding(16)
            }
            if model.finished { footer }
        }
        .frame(minWidth: 480, idealWidth: 520, minHeight: 520, idealHeight: 600)
        .background(theme.page)
        .interactiveDismissDisabled(!model.finished)
        .task {
            guard let api = state.nativeAPI() else {
                model.errorMessage = "Brak połączenia z serwerem CRM."
                model.finished = true
                return
            }
            await model.start(invoiceID: invoiceID, api: api, onSuccess: onSuccess)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: model.isError ? "xmark.circle" : model.isSuccess ? "checkmark.circle" : "paperplane")
                    .font(.title2)
                    .foregroundStyle(model.isError ? Color.red : model.isSuccess ? Color.green : theme.accent)
                    .frame(width: 40, height: 40)
                    .background((model.isError ? Color.red : model.isSuccess ? Color.green : theme.accent).opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.isError ? "Wysyłka nieudana" : model.isSuccess ? "Wysłano do KSeF" : "Wysyłanie do KSeF").font(.headline)
                    Text("Faktura \(invoiceNumber)").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
            }
            if !model.finished {
                TimelineView(.periodic(from: model.started, by: 0.5)) { context in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(verbatim: "Krok \(max(min(model.currentIndex + 1, model.steps.count), 1)) z \(model.steps.count)")
                            Spacer()
                            Text(verbatim: Self.elapsed(context.date.timeIntervalSince(model.started)))
                        }
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                        ProgressView(value: Double(model.completedCount), total: Double(model.steps.count))
                    }
                }
            }
        }
        .padding(16)
    }

    private static func elapsed(_ interval: TimeInterval) -> String {
        let seconds = max(Int(interval), 0)
        return seconds >= 60 ? "\(seconds / 60)m \(seconds % 60)s" : "\(seconds)s"
    }

    private func stepRow(_ step: InvoiceKsefSendModel.Step) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Group {
                switch step.status {
                case .completed: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                case .active: ProgressView().controlSize(.small)
                case .error: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                case .pending: Image(systemName: step.symbol).foregroundStyle(.tertiary)
                }
            }
            .frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(step.label)
                        .foregroundStyle(step.status == .completed ? Color.green : step.status == .error ? Color.red : step.status == .active ? Color.primary : Color.secondary)
                    if step.id == "poll" && step.status == .active && model.pollAttempt > 0 {
                        Text(verbatim: "(\(model.pollAttempt)/\(model.pollMax))").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .font(.callout.weight(step.status == .active ? .medium : .regular))
                if step.status == .active || step.status == .error {
                    Text(description(step)).font(.caption).foregroundStyle(step.status == .error ? Color.red.opacity(0.8) : Color.secondary)
                }
                if step.id == "poll" && step.status == .active && model.pollAttempt > 0 {
                    ProgressView(value: Double(model.pollAttempt), total: Double(max(model.pollMax, model.pollAttempt)))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(step.status == .active ? theme.accent.opacity(0.1) : step.status == .error ? Color.red.opacity(0.1) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 8))
    }

    private func description(_ step: InvoiceKsefSendModel.Step) -> String {
        if step.id == "poll" && step.status == .active && model.pollAttempt > 0 {
            return "Sprawdzanie statusu - próba \(model.pollAttempt) z \(model.pollMax)"
        }
        if step.id == "save" && step.status == .active { return "Zapis do KSeF, aktualizacja faktury, historia zmian" }
        return step.description
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            if model.isSuccess, let reference = model.reference {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Numer referencyjny KSeF").font(.callout.weight(.medium)).foregroundStyle(.green)
                    Text(reference).font(.callout.monospaced()).textSelection(.enabled)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            if let message = model.errorMessage {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Szczegóły błędu").font(.callout.weight(.medium)).foregroundStyle(.red)
                    Text(message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            Button { dismiss() } label: {
                Text(model.isSuccess ? "Zamknij" : "Rozumiem").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(model.isSuccess ? Color.green : theme.accent)
            .keyboardShortcut(.defaultAction)
        }
        .padding([.horizontal, .bottom], 16)
    }
}
