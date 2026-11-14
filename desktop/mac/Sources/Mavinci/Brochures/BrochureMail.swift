import SwiftUI

// MARK: Broszury, część G3 — „Wyślij broszurę” (`SendBrochureEmailModal`, `BrochureRecipients`) i historia wysyłek
// (`BrochureDeliveryHistory`). Każdy odbiorca dostaje osobną wiadomość i własny PDF; przygotowanie i wysyłka przez
// `/bridge/brochures/deliveries` tokenem pracownika, jak w CRM. Serwer: `src/lib/native/brochureMail.ts`. Okno wysyłki i historia
// działają w edytorze broszury i w karcie klienta (część G5, `BrochureClientBrochures.swift`).

struct BrochureMailSetup: Decodable {
    struct Account: Decodable, Identifiable {
        var id: String
        var label: String
    }
    var brochureName: String
    var accounts: [Account]
    var subject: String
    var text: String
}

/// Odbiorca wysyłki (`Recipient`): adres, nazwa i powiązanie z kontaktem lub organizacją.
struct BrochureRecipient: Identifiable, Equatable {
    var email: String
    var name: String
    var contactId: String?
    var organizationId: String?
    var manualAddress = false
    var id: String { email }

    var json: JSONValue {
        var fields: [String: JSONValue] = ["email": .string(email), "name": .string(name)]
        if let contactId { fields["contactId"] = .string(contactId) }
        if let organizationId { fields["organizationId"] = .string(organizationId) }
        if manualAddress { fields["manualAddress"] = .bool(true) }
        return .object(fields)
    }

    static func valid(_ email: String) -> Bool {
        email.count <= 200 && email.range(of: #"^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$"#, options: .regularExpression) != nil
    }
}

/// Wiadomość z broszurą (`sales_brochure_deliveries`).
struct BrochureDelivery: Decodable, Identifiable, Equatable {
    struct Source: Decodable, Equatable {
        var version: Int
        var pdfPath: String
        var fileName: String
    }
    var id: String
    var batchId: String
    var generationId: String
    var brochureId: String
    var employeeId: String
    var emailAccountId: String
    var draftRevision: Int?
    var recipientEmail: String
    var recipientName: String?
    var subject: String
    var bodyHtml: String?
    var status: String
    var errorMessage: String?
    var createdAt: String
    var sentAt: String?
    var contactId: String?
    var organizationId: String?
    var source: Source?
    var authorName: String?
    /// Ręcznie przygotowane ponowienie niepewnej wysyłki (poprzednia próba zostaje w historii).
    var retryOfDeliveryId: String?

    static let labels = [
        "prepared": "Gotowa do wysłania", "sending": "Wysyłka rozpoczęta — oczekiwanie na potwierdzenie", "sent": "Wysłano",
        "failed": "Nie wysłano — można ponowić", "uncertain": "Wynik niepewny — sprawdź folder Wysłane",
    ]
    var label: String { Self.labels[status] ?? status }
    var color: Color { status == "sent" ? Color.green : status == "uncertain" ? Color.orange : Color.primary }
    var versionLabel: String {
        guard let source else { return "Broszura v—" }
        return "Broszura v" + String(source.version)
    }
    var date: String { BrochureDates.text(sentAt ?? createdAt) }
}

struct BrochureDeliveriesPage: Decodable {
    var canViewAll: Bool
    var canSend: Bool
    var currentEmployeeId: String
    var deliveries: [BrochureDelivery]
}

struct BrochureMembers: Decodable {
    struct Organization: Decodable {
        var id: String
        var name: String
        var email: String
    }
    struct Member: Decodable, Identifiable {
        var name: String
        var email: String
        var contactId: String?
        var organizationId: String?
        var id: String { contactId ?? "org-\(email)" }
    }
    var organization: Organization
    var members: [Member]
    var truncated: Bool
}

extension BrochuresStore {
    static var snakeDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    func mailSetup(_ id: String) async throws -> BrochureMailSetup {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(BrochureMailSetup.self, from: try await api.get("/brochures?op=mailSetup&id=\(id)"))
    }

    /// Treść wiadomości z szablonem i stopką: `bodyHtml` do wysyłki, `html` do podglądu.
    func mailCompose(_ id: String, accountId: String, subject: String, text: String, recipientName: String) async throws -> (bodyHtml: String, html: String) {
        struct Reply: Decodable { var bodyHtml: String; var html: String }
        guard let api else { throw AppError.configuration }
        let body: [String: JSONValue] = [
            "op": .string("mailCompose"), "id": .string(id), "accountId": .string(accountId), "subject": .string(subject),
            "text": .string(text), "recipientName": .string(recipientName),
        ]
        let reply = try JSONDecoder().decode(Reply.self, from: try await api.post("/brochures", body))
        return (reply.bodyHtml, reply.html)
    }

    func members(_ organizationId: String) async throws -> BrochureMembers {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(BrochureMembers.self, from: try await api.get("/brochures?op=members&organization=\(organizationId)"))
    }

    func deliveries(_ query: String) async throws -> BrochureDeliveriesPage {
        guard let api else { throw AppError.configuration }
        return try Self.snakeDecoder.decode(BrochureDeliveriesPage.self, from: try await api.get("/brochures?op=deliveries&\(query)"))
    }

    /// Zapisany PDF (załącznik, wersja broszury, próbny PDF z demo) do podglądu w oknie aplikacji.
    func savedPdf(bucket: String, path: String, fileName: String) async -> OfferPdfPreview? {
        struct Reply: Decodable { var url: String; var fileName: String }
        guard let api, let workspace else { return nil }
        do {
            return try await workspace.withPending("Otwieranie PDF…") { () async throws -> OfferPdfPreview in
                let body: [String: JSONValue] = ["op": .string("fileUrl"), "bucket": .string(bucket), "path": .string(path), "fileName": .string(fileName)]
                let reply = try JSONDecoder().decode(Reply.self, from: try await api.post("/brochures", body))
                guard let url = URL(string: reply.url) else { throw AppError.invalidResponse }
                return OfferPdfPreview(data: try await Self.download(url), name: reply.fileName)
            }
        } catch {
            workspace.error = failureText(error, "Nie udało się otworzyć PDF. Spróbuj ponownie.")
            return nil
        }
    }

    /// Przygotowanie lub wysyłka wiadomości (`/bridge/brochures/deliveries`) — odpowiedź to zapisany stan wiadomości.
    func deliveryRequest(_ body: [String: JSONValue]) async throws -> BrochureDelivery {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/brochures/deliveries") else {
            throw AppError.configuration
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 150
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AppError.unauthorized }
        struct Reply: Decodable { var delivery: BrochureDelivery?; var error: String? }
        let reply = try? Self.snakeDecoder.decode(Reply.self, from: data)
        if !(200..<300).contains(status) {
            let http = status == 403 ? "Brak dostępu do tej operacji."
                : status == 504 ? "Serwer nie zakończył operacji w wymaganym czasie. Sprawdź jej stan przed ponowieniem."
                : "Nie udało się obsłużyć wysyłki. (HTTP \(status))"
            throw NativeFailure(status: status, message: reply?.error?.isEmpty == false ? reply!.error! : http, fieldErrors: [:])
        }
        guard let delivery = reply?.delivery else {
            throw NativeFailure(status: status, message: "Nie udało się odczytać potwierdzenia operacji. Sprawdź historię przed ponowieniem.", fieldErrors: [:])
        }
        return delivery
    }
}

/// „Wyślij broszurę”: odbiorcy, treść z podglądem, przygotowanie osobnych PDF-ów i wiadomości, zatwierdzenie wysyłki.
/// Z edytora — dla tej broszury; z karty klienta — z wyborem broszury i klientem jako odbiorcą.
@MainActor struct BrochureMailSheet: View {
    @ObservedObject var store: BrochuresStore
    /// Wysyłane wiadomości i historia do odświeżenia (np. w edytorze broszury).
    var changed: () -> Void = {}
    /// Problemy ze sprawdzenia broszury — w edytorze oznaczane na stronach.
    var showIssues: (([BrochureIssue]) -> Void)? = nil
    let context: BrochureRecipientContext?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var brochureId: String
    private let fixedBrochure: Bool
    @State private var setup: BrochureMailSetup?
    @State private var accountId = ""
    @State private var subject = ""
    @State private var text = ""
    @State private var recipients: [BrochureRecipient] = []
    @State private var locked = false
    @State private var deliveries: [BrochureDelivery] = []
    @State private var busy: String?
    @State private var error: String?
    @State private var issues: [BrochureIssue] = []
    @State private var previewShown = false
    @State private var previewHtml = ""
    @State private var pdf: OfferPdfPreview?
    @State private var batch = UUID().uuidString.lowercased()
    @State private var generated: [String: String] = [:]
    @State private var prepared: [String: BrochureDelivery] = [:]

    init(store: BrochuresStore, brochureId: String?, context: BrochureRecipientContext? = nil, onChange: @escaping () -> Void = {},
         showIssues: (([BrochureIssue]) -> Void)? = nil) {
        self.store = store
        self.context = context
        self.changed = onChange
        self.showIssues = showIssues
        fixedBrochure = brochureId != nil
        _brochureId = State(initialValue: brochureId ?? "")
    }

    private var activeBrochures: [BrochureListState.Brochure] { (store.state?.brochures ?? []).filter { $0.status != "archived" } }
    private var ready: Bool { !recipients.isEmpty && deliveries.count == recipients.count }
    private var pending: Int { deliveries.filter { ["prepared", "failed"].contains($0.status) }.count }
    private var allSent: Bool { ready && pending == 0 && deliveries.allSatisfy { $0.status == "sent" } }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Wyślij broszurę").font(.title3.weight(.semibold))
                if let setup { Text("· \(setup.brochureName)").foregroundStyle(.secondary).lineLimit(1) }
                Spacer()
            }
            .padding(16)
            Divider()
            if !fixedBrochure && brochureId.isEmpty {
                Form { brochurePicker }.formStyle(.grouped)
            } else if let setup {
                Form {
                    if !fixedBrochure { brochurePicker }
                    if let error {
                        Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
                    }
                    if !issues.isEmpty { issuesSection }
                    Section {
                        BrochureRecipientsEditor(store: store, recipients: $recipients, disabled: locked || busy != nil, context: context)
                    } header: {
                        Text("Wyślij do")
                    } footer: {
                        Text("Każdy adres otrzyma osobną wiadomość i własny PDF. Jeśli broszura zawiera demo, jego link będzie przypisany do odbiorcy. Powtórzone adresy pomijamy.")
                    }
                    Section {
                        Picker("Skrzynka nadawcy", selection: $accountId) {
                            ForEach(setup.accounts) { account in Text(account.label).tag(account.id) }
                        }
                        TextField("Temat", text: $subject)
                        TextField("", text: $text, axis: .vertical).lineLimit(6...14).labelsHidden()
                        Toggle("Podgląd wiadomości ze stopką", isOn: $previewShown)
                        if previewShown {
                            EmailWebView(html: previewHtml.isEmpty ? "<p style=\"font-family:-apple-system;color:#888\">Przygotowywanie podglądu…</p>" : previewHtml)
                                .frame(height: 320)
                        }
                    } header: {
                        Text("Wiadomość")
                    }
                    .disabled(locked || busy != nil)
                    if !deliveries.isEmpty { deliveriesSection }
                }
                .formStyle(.grouped)
                .task(id: previewKey) { await refreshPreview() }
            } else if let error {
                ContentUnavailableView { Label("Nie można wysłać broszury", systemImage: "paperplane") } description: { Text(error) }
            } else {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            footer
        }
        .frame(width: 720, height: 760)
        .interactiveDismissDisabled(busy != nil)
        .task {
            if !fixedBrochure && store.state == nil { await store.load() }
        }
        .task(id: brochureId) { await load() }
        .sheet(item: $pdf) { file in OfferPdfViewer(file: file) }
    }

    /// Wybór broszury (okno z karty klienta) — zablokowany po przygotowaniu wiadomości.
    private var brochurePicker: some View {
        Section {
            Picker("Broszura", selection: $brochureId) {
                Text("Wybierz broszurę").tag("")
                ForEach(activeBrochures) { brochure in Text(brochure.name).tag(brochure.id) }
            }
            .disabled(locked || busy != nil)
            if store.state == nil { Text("Wczytywanie broszur…").font(.caption).foregroundStyle(.secondary) }
        } footer: {
            Text("Każdy odbiorca dostanie osobny PDF tej broszury, przypisany do niego w kartotece klienta.")
        }
    }

    private var previewKey: String { "\(previewShown)|\(accountId)|\(subject)|\(text)|\(recipients.first?.name ?? "")" }
    private var prepareTitle: String { locked ? "Przygotuj brakujące załączniki" : "Przygotuj wiadomości i PDF-y" }

    private var footer: some View {
        HStack(spacing: 10) {
            if let busy {
                ProgressView().controlSize(.small)
                Text(busy).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            } else if allSent {
                Label("Wszystkie wiadomości zostały wysłane.", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.callout)
            } else if !recipients.isEmpty && !ready {
                Text("Utworzymy \(recipients.count) osobnych wiadomości z PDF. Treść i odbiorcy zostaną zablokowani dla przygotowanej wysyłki.")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy != nil)
            if !ready {
                Button(prepareTitle) { Task { await prepare() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(setup == nil || brochureId.isEmpty || busy != nil || recipients.isEmpty)
            } else if pending > 0 {
                Button { Task { await send() } } label: { Label("Wyślij osobne wiadomości (\(pending))", systemImage: "paperplane.fill") }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy != nil)
            }
        }
        .padding(14)
    }

    private var issuesSection: some View {
        Section {
            ForEach(issues) { issue in
                VStack(alignment: .leading, spacing: 2) {
                    Text(issue.label).font(.callout.weight(.medium))
                    Text(issue.message).font(.caption).foregroundStyle(.orange)
                }
            }
            if let showIssues {
                Button("Pokaż strony do poprawy w edytorze") {
                    showIssues(issues)
                    dismiss()
                }
            } else {
                Button("Otwórz broszurę w edytorze") {
                    let id = brochureId
                    dismiss()
                    store.workspace?.showBrochure(id)
                }
            }
        } header: {
            Text("Broszura wymaga poprawy przed wysyłką")
        }
    }

    private var deliveriesSection: some View {
        Section {
            ForEach(deliveries) { delivery in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(delivery.recipientEmail)
                        Text(delivery.label).font(.caption).foregroundStyle(delivery.status == "sent" ? Color.green : Color.secondary)
                        if let message = delivery.errorMessage, !message.isEmpty {
                            Text(message).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer()
                    Button("Sprawdź załącznik PDF") { Task { await openAttachment(delivery) } }
                        .buttonStyle(.borderless)
                        .disabled(busy != nil)
                }
            }
        } header: {
            Text("Przygotowane wiadomości")
        } footer: {
            Text("„Wysłano” oznacza potwierdzenie nadania przez serwer pocztowy. Przy niepewnym wyniku sprawdź folder Wysłane przed kolejną wysyłką.")
        }
    }

    // MARK: Działania

    private func load() async {
        guard !brochureId.isEmpty else { return }
        issues = []
        do {
            let loaded = try await store.mailSetup(brochureId)
            let first = setup == nil
            setup = loaded
            if first || !loaded.accounts.contains(where: { $0.id == accountId }) { accountId = loaded.accounts.first?.id ?? "" }
            if first {
                subject = loaded.subject
                text = loaded.text
            }
            error = loaded.accounts.isEmpty ? "Brak skrzynki, z której możesz wysyłać wiadomości. Dodaj skrzynkę w ustawieniach poczty CRM." : nil
        } catch {
            self.error = store.failureText(error, "Nie udało się pobrać broszury lub kont pocztowych.")
        }
    }

    private func refreshPreview() async {
        guard previewShown, !accountId.isEmpty, !subject.trimmingCharacters(in: .whitespaces).isEmpty, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        try? await Task.sleep(for: .milliseconds(400))
        guard !Task.isCancelled else { return }
        if let result = try? await store.mailCompose(brochureId, accountId: accountId, subject: subject, text: text, recipientName: recipients.first?.name ?? "") {
            if !Task.isCancelled { previewHtml = result.html }
        }
    }

    @discardableResult
    private func refresh() async throws -> [BrochureDelivery] {
        let rows = try await store.deliveries("batch=\(batch)").deliveries
        for row in rows { prepared[row.recipientEmail] = row }
        deliveries = rows
        return rows
    }

    private func prepare() async {
        guard busy == nil, setup != nil else { return }
        if recipients.isEmpty || accountId.isEmpty || subject.trimmingCharacters(in: .whitespaces).isEmpty
            || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            error = "Wybierz odbiorców, konto nadawcy oraz uzupełnij temat i treść."
            return
        }
        locked = true
        error = nil
        issues = []
        var stage = "Odczyt przygotowanych wiadomości"
        var current = ""
        busy = "Przygotowywanie wiadomości…"
        do {
            try await refresh()
            for (index, recipient) in recipients.enumerated() where prepared[recipient.email] == nil {
                current = recipient.email
                stage = "Przygotowanie treści wiadomości"
                busy = "Przygotowywanie wiadomości \(index + 1) z \(recipients.count) · \(recipient.email)"
                // Najpierw dokładna treść, potem spersonalizowany załącznik (jak w CRM).
                let composed = try await store.mailCompose(brochureId, accountId: accountId, subject: subject, text: text, recipientName: recipient.name)
                var generationId = generated[recipient.email]
                if generationId == nil {
                    stage = "Generowanie załącznika PDF"
                    busy = "Przygotowywanie PDF \(index + 1) z \(recipients.count) · \(recipient.email) — do 3 minut"
                    var client: JSONValue = .null
                    if recipient.contactId != nil || recipient.organizationId != nil {
                        var fields: [String: JSONValue] = [:]
                        if let contactId = recipient.contactId { fields["contactId"] = .string(contactId) }
                        if let organizationId = recipient.organizationId { fields["organizationId"] = .string(organizationId) }
                        client = .object(fields)
                    }
                    let result = try await store.generatePdf(["brochureId": .string(brochureId), "recipientEmail": .string(recipient.email), "recipient": client],
                                                             fallback: "Nie udało się wygenerować załącznika.")
                    guard let id = result.generationId else {
                        throw NativeFailure(status: 0, message: "Generator nie zwrócił identyfikatora PDF.", fieldErrors: [:])
                    }
                    generationId = id
                    generated[recipient.email] = id
                }
                stage = "Zapis przygotowanej wiadomości"
                busy = "Zapisywanie wiadomości \(index + 1) z \(recipients.count) · \(recipient.email)"
                let row = try await store.deliveryRequest([
                    "action": .string("prepare"), "generationId": .string(generationId ?? ""), "batchId": .string(batch), "recipient": recipient.json,
                    "emailAccountId": .string(accountId), "subject": .string(subject), "bodyHtml": .string(composed.bodyHtml),
                ])
                prepared[recipient.email] = row
                deliveries = recipients.compactMap { prepared[$0.email] }
            }
            // Odświeżenie partii dołącza do wiadomości zapisane załączniki (do sprawdzenia przed wysyłką).
            stage = "Odczyt przygotowanych wiadomości"
            current = ""
            try await refresh()
            changed()
        } catch {
            if let failure = error as? BrochureValidationFailure { issues = failure.issues }
            let who = current.isEmpty ? "" : " (" + current + ")"
            let reason = store.failureText(error, "Nie udało się przygotować wiadomości.")
            let message = stage + who + ": " + reason + " Żadna wiadomość nie została wysłana w tym kroku."
            self.error = message
            store.workspace?.error = message
            _ = try? await refresh()
        }
        if prepared.isEmpty && generated.isEmpty { locked = false }
        busy = nil
    }

    private func send() async {
        guard busy == nil else { return }
        busy = "Sprawdzanie przygotowanych wiadomości…"
        error = nil
        var failures: [String] = []
        let reviewed = Dictionary(uniqueKeysWithValues: deliveries.map { ($0.id, $0.draftRevision) })
        do {
            let rows = try await refresh()
            for row in rows where ["prepared", "failed"].contains(row.status) {
                busy = "Wysyłanie do \(row.recipientEmail)…"
                do {
                    var body: [String: JSONValue] = ["action": .string("send"), "deliveryId": .string(row.id)]
                    if let revision = reviewed[row.id] ?? row.draftRevision { body["expectedRevision"] = .number(Double(revision)) }
                    let sent = try await store.deliveryRequest(body)
                    prepared[sent.recipientEmail] = sent
                    deliveries = deliveries.map { $0.id == sent.id ? sent : $0 }
                } catch {
                    failures.append("\(row.recipientEmail): \(store.failureText(error, "Nie otrzymano potwierdzenia wysyłki. Sprawdź historię przed ponowieniem."))")
                }
            }
            let latest = try await refresh()
            changed()
            let completed = !recipients.isEmpty && recipients.allSatisfy { recipient in latest.contains { $0.recipientEmail == recipient.email && $0.status == "sent" } }
            busy = nil
            if completed {
                store.workspace?.succeed(recipients.count == 1 ? "Broszura została wysłana." : "Wszystkie wiadomości z broszurą zostały wysłane.")
                dismiss()
                return
            }
            error = failures.isEmpty
                ? "Nie wszystkie wiadomości mają potwierdzenie wysyłki. Sprawdź ich stan w historii oraz folder Wysłane przed ponowieniem."
                : failures.joined(separator: "\n")
        } catch {
            self.error = (failures + ["Nie udało się odczytać stanu wysyłki. \(store.failureText(error, "Spróbuj odświeżyć historię.")) Sprawdź historię i folder Wysłane przed ponowieniem."])
                .joined(separator: "\n")
        }
        busy = nil
        if let error { store.workspace?.error = error }
    }

    private func openAttachment(_ delivery: BrochureDelivery) async {
        guard let source = delivery.source else {
            error = "Brak zapisanego załącznika PDF."
            return
        }
        if let file = await store.savedPdf(bucket: "generated-brochures", path: source.pdfPath, fileName: source.fileName) { pdf = file }
    }
}

/// „Wyślij do”: organizacja (jej adres i osoby), kontakt albo ręcznie wpisany adres; do 20 odbiorców bez powtórzeń.
@MainActor struct BrochureRecipientsEditor: View {
    let store: BrochuresStore
    @Binding var recipients: [BrochureRecipient]
    let disabled: Bool
    /// Klient z karty kontaktu: organizacja — jej adres i osoby do zaznaczenia; kontakt — od razu jako odbiorca.
    var context: BrochureRecipientContext? = nil
    @Environment(\.crmTheme) private var theme
    @State private var contextLoaded = false
    @State private var mode = "organization"
    @State private var query = ""
    @State private var results: [BrochureClientResult] = []
    @State private var members: BrochureMembers?
    @State private var manual = ""
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("", selection: $mode) {
                Text("Organizacja").tag("organization")
                Text("Kontakt").tag("contact")
                Text("Adres e-mail").tag("email")
            }
            .pickerStyle(.segmented).labelsHidden()
            .onChange(of: mode) { _, _ in
                query = ""
                results = []
                error = nil
            }
            if mode == "email" {
                HStack {
                    TextField("", text: $manual, prompt: Text("adres@hotel.pl")).textFieldStyle(.roundedBorder)
                        .onSubmit { addManual() }
                    Button("Dodaj") { addManual() }
                }
                if let link = manualLinkName {
                    Text("Ręcznie wpisany adres będzie powiązany w historii z: \(link).").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                TextField("", text: $query, prompt: Text(mode == "organization" ? "Nazwa organizacji lub e-mail (min. 2 znaki)" : "Imię, nazwisko lub e-mail (min. 2 znaki)"))
                    .textFieldStyle(.roundedBorder)
                if !results.isEmpty { resultList }
                if mode == "organization", let members { memberList(members) }
            }
            if loading { Text("Wczytywanie odbiorców…").font(.caption).foregroundStyle(.secondary) }
            if let error { Text(error).font(.caption).foregroundStyle(.orange) }
            if !recipients.isEmpty {
                ProductFlowLayout(spacing: 6) {
                    ForEach(recipients) { recipient in
                        HStack(spacing: 4) {
                            Text(recipient.name != recipient.email ? "\(recipient.name) · \(recipient.email)" : recipient.email).font(.caption)
                            Button { recipients.removeAll(where: { $0.email == recipient.email }) } label: { Image(systemName: "xmark.circle.fill") }
                                .buttonStyle(.borderless)
                                .help("Usuń odbiorcę \(recipient.email)")
                        }
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(theme.accent.opacity(0.15), in: Capsule())
                    }
                }
            }
        }
        .disabled(disabled)
        .task(id: "\(mode)|\(query)") { await search() }
        .task { await loadContext() }
    }

    private var manualLinkName: String? {
        if context?.type == "contact" { return context?.name }
        return members?.organization.name ?? context?.name
    }

    /// Odbiorca z karty klienta — raz, przy otwarciu okna (późniejsze zmiany listy nie są nadpisywane).
    private func loadContext() async {
        guard let context, !contextLoaded else { return }
        contextLoaded = true
        loading = true
        defer { loading = false }
        if context.type == "organization" {
            mode = "organization"
            do {
                members = try await store.members(context.id)
            } catch {
                self.error = "Nie udało się pobrać kontaktów organizacji."
            }
            return
        }
        mode = "contact"
        do {
            let recipient = try await store.contactRecipient(context.id)
            if recipient.email.isEmpty {
                mode = "email"
                error = "Kontakt nie ma prawidłowego e-maila. Możesz wpisać adres ręcznie."
            } else if recipients.isEmpty {
                recipients = [recipient]
            }
        } catch {
            self.error = "Nie udało się wczytać odbiorcy."
        }
    }

    private var resultList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(results) { row in
                    let usable = mode == "organization" || BrochureRecipient.valid(row.email.trimmingCharacters(in: .whitespaces).lowercased())
                    Button { choose(row) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.name)
                            Text(detail(row)).font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 5).padding(.horizontal, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!usable)
                    .opacity(usable ? 1 : 0.45)
                    Divider()
                }
            }
        }
        .frame(maxHeight: 180)
        .background(Color.black.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
    }

    private func detail(_ row: BrochureClientResult) -> String {
        let email = row.email.isEmpty ? "Brak e-maila" : row.email
        let names = row.organizations.map { $0.name }.joined(separator: ", ")
        return names.isEmpty ? email : "\(email) · \(names)"
    }

    private func memberList(_ group: BrochureMembers) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(group.organization.name).font(.callout.weight(.medium)).foregroundStyle(theme.accent)
            if group.members.isEmpty {
                Text("Brak adresu organizacji i powiązanych osób. Wpisz adres ręcznie.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(group.members) { member in
                Toggle(isOn: Binding(get: { recipients.contains(where: { $0.email == member.email }) }, set: { on in
                    if on {
                        add(BrochureRecipient(email: member.email, name: member.name, contactId: member.contactId, organizationId: member.organizationId))
                    } else {
                        recipients.removeAll(where: { $0.email == member.email })
                    }
                })) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(member.name)
                        Text(member.email.isEmpty ? "Brak e-maila — użyj opcji Adres e-mail" : member.email).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                .disabled(!BrochureRecipient.valid(member.email))
            }
            if group.truncated {
                Text("Pokazano pierwszych 500 powiązań. Pozostałe osoby znajdziesz w wyszukiwarce Kontakt.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(Color.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private func search() async {
        let term = query.trimmingCharacters(in: .whitespaces)
        guard mode != "email", term.count >= 2 else {
            results = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        loading = true
        do {
            let found = try await store.clients(mode: mode, query: term)
            if !Task.isCancelled { results = found }
        } catch {
            if !Task.isCancelled { self.error = "Nie udało się wyszukać odbiorców." }
        }
        if !Task.isCancelled { loading = false }
    }

    private func choose(_ row: BrochureClientResult) {
        if mode == "organization" {
            query = ""
            results = []
            Task {
                loading = true
                error = nil
                do {
                    members = try await store.members(row.id)
                } catch {
                    self.error = "Nie udało się pobrać kontaktów organizacji."
                }
                loading = false
            }
        } else {
            add(BrochureRecipient(email: row.email, name: row.name, contactId: row.id,
                                  organizationId: row.organizations.count == 1 ? row.organizations.first?.id : nil))
        }
    }

    private func addManual() {
        let email = manual.trimmingCharacters(in: .whitespaces)
        guard BrochureRecipient.valid(email.lowercased()) else {
            error = "Wpisz prawidłowy adres e-mail."
            return
        }
        let contactId = context?.type == "contact" ? context?.id : nil
        let organizationId = contactId == nil ? (members?.organization.id ?? (context?.type == "organization" ? context?.id : nil)) : nil
        add(BrochureRecipient(email: email, name: email, contactId: contactId, organizationId: organizationId, manualAddress: true))
        manual = ""
    }

    private func add(_ recipient: BrochureRecipient) {
        var normalized = recipient
        normalized.email = recipient.email.trimmingCharacters(in: .whitespaces).lowercased()
        guard BrochureRecipient.valid(normalized.email) else {
            error = "Wpisz prawidłowy adres e-mail."
            return
        }
        if recipients.contains(where: { $0.email == normalized.email }) { return }
        guard recipients.count < 20 else {
            error = "Jednorazowo wybierz maksymalnie 20 odbiorców."
            return
        }
        error = nil
        recipients.append(normalized)
    }
}

/// Historia wysyłek (broszury albo klienta): data i wersja, odbiorca, stan; wiadomość i załącznik; wysłanie przygotowanej wiadomości.
@MainActor struct BrochureDeliveriesPanel: View {
    @ObservedObject var store: BrochuresStore
    /// Zakres historii: `brochure=…`, `contact=…` albo `organization=…`.
    let scope: String
    /// Zmiana (np. po wysyłce) — ponowne wczytanie.
    let revision: Int
    var title = "Historia wysyłek"
    var changed: () -> Void = {}
    @State private var page: BrochureDeliveriesPage?
    @State private var all = false
    @State private var offset = 0
    @State private var loading = false
    @State private var error: String?
    @State private var details: BrochureDelivery?
    @State private var pdf: OfferPdfPreview?
    @State private var selection: String?

    private var emptyTitle: String { loading ? "Wczytywanie historii…" : "Brak przygotowanych wiadomości i wysyłek" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title).font(.title3.weight(.semibold))
                Spacer()
                if page?.canViewAll == true {
                    Picker("", selection: $all) {
                        Text("Moje").tag(false)
                        Text("Wszystkie").tag(true)
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                }
                Button { Task { await load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(loading)
            }
            Text("„Wysłano” oznacza potwierdzenie nadania przez serwer pocztowy. Przy niepewnym wyniku sprawdź folder Wysłane przed kolejną wysyłką.")
                .font(.caption).foregroundStyle(.secondary)
            if let error { Text(error).foregroundStyle(.orange) }
            if let rows = page?.deliveries {
                if rows.isEmpty {
                    ContentUnavailableView(emptyTitle, systemImage: "paperplane")
                } else {
                    Table(rows, selection: $selection) {
                        TableColumn("Data / wersja") { row in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(row.date)
                                Text(row.versionLabel).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        TableColumn("Odbiorca") { row in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(row.recipientEmail)
                                Text(row.recipientName ?? "").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        TableColumn("Pracownik") { row in Text(row.authorName ?? "Pracownik") }
                        TableColumn("Stan") { row in
                            Text(row.label).foregroundStyle(row.color)
                        }
                    }
                    .contextMenu(forSelectionType: BrochureDelivery.ID.self) { ids in
                        if let id = ids.first, let row = rows.first(where: { $0.id == id }) {
                            Button("Zobacz wiadomość") { details = row }
                            Button("Zobacz załącznik PDF") { Task { await openPdf(row) } }.disabled(row.source == nil)
                        }
                    } primaryAction: { ids in
                        if let id = ids.first { details = rows.first(where: { $0.id == id }) }
                    }
                    .frame(minHeight: 260)
                }
                HStack {
                    Button("Poprzednie") { offset = max(0, offset - 25) }.disabled(offset == 0 || loading)
                    Spacer()
                    Text("Kliknij dwukrotnie wiersz, aby zobaczyć wiadomość.").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Następne") { offset += 25 }.disabled(rows.count < 25 || loading)
                }
            } else if loading {
                ProgressView("Wczytywanie historii…").frame(maxWidth: .infinity)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: "\(all)|\(offset)|\(revision)|\(scope)") { await load() }
        .onChange(of: all) { _, _ in offset = 0 }
        .sheet(item: $details) { row in
            BrochureDeliverySheet(store: store, delivery: row, canSend: page?.canSend == true && row.employeeId == page?.currentEmployeeId) { updated in
                if let index = page?.deliveries.firstIndex(where: { $0.id == updated.id }) { page?.deliveries[index] = updated }
                changed()
                Task { await load() }
            }
        }
        .sheet(item: $pdf) { file in OfferPdfViewer(file: file) }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            page = try await store.deliveries("\(scope)&all=\(all)&offset=\(offset)")
            error = nil
        } catch {
            self.error = "Nie udało się wczytać historii wysyłek."
        }
    }

    private func openPdf(_ row: BrochureDelivery) async {
        guard let source = row.source else { return }
        if let file = await store.savedPdf(bucket: "generated-brochures", path: source.pdfPath, fileName: source.fileName) { pdf = file }
    }
}

/// Zapisana wiadomość z broszurą: adresat, temat, stan, treść; własną przygotowaną lub nieudaną można wysłać.
@MainActor struct BrochureDeliverySheet: View {
    let store: BrochuresStore
    let delivery: BrochureDelivery
    let canSend: Bool
    let updated: (BrochureDelivery) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var current: BrochureDelivery?
    @State private var sending = false
    @State private var error: String?
    @State private var pdf: OfferPdfPreview?

    private var row: BrochureDelivery { current ?? delivery }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Wiadomość z broszurą").font(.title3.weight(.semibold))
            LabeledContent("Do") { Text(row.recipientEmail).textSelection(.enabled) }
            LabeledContent("Temat") { Text(row.subject).textSelection(.enabled) }
            LabeledContent("Stan") { Text(row.label).foregroundStyle(row.color) }
            if let message = row.errorMessage, !message.isEmpty { Text(message).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            if let error { Text(error).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            EmailWebView(html: row.bodyHtml ?? "")
                .frame(minHeight: 320)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            HStack {
                Button("Zobacz załącznik PDF") { Task { await openPdf() } }.disabled(row.source == nil || sending)
                Spacer()
                if sending { ProgressView().controlSize(.small) }
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).disabled(sending)
                if canSend && ["prepared", "failed"].contains(row.status) {
                    Button { Task { await send() } } label: { Label(sending ? "Wysyłanie…" : "Wyślij tę wiadomość", systemImage: "paperplane.fill") }
                        .buttonStyle(.borderedProminent)
                        .disabled(sending)
                }
            }
        }
        .padding(20)
        .frame(width: 680, height: 640)
        .interactiveDismissDisabled(sending)
        .sheet(item: $pdf) { file in OfferPdfViewer(file: file) }
    }

    private func send() async {
        sending = true
        error = nil
        defer { sending = false }
        var body: [String: JSONValue] = ["action": .string("send"), "deliveryId": .string(row.id)]
        if let revision = row.draftRevision { body["expectedRevision"] = .number(Double(revision)) }
        do {
            let sent = try await store.deliveryRequest(body)
            current = sent
            updated(sent)
            if sent.status == "sent" { store.workspace?.succeed("Broszura została wysłana.") }
        } catch {
            self.error = store.failureText(error, "Nie udało się wysłać wiadomości.")
        }
    }

    private func openPdf() async {
        guard let source = row.source else { return }
        if let file = await store.savedPdf(bucket: "generated-brochures", path: source.pdfPath, fileName: source.fileName) { pdf = file }
    }
}
