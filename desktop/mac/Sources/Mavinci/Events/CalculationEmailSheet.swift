import SwiftUI

// MARK: „Wyślij kalkulację przez email” (`SendCalculationEmailModal`): skrzynka pracownika, adresat (osoba kontaktowa
// wydarzenia), temat i treść ze stopką firmy („Podgląd”), aktualny PDF kalkulacji w załączniku, opcjonalnie dodatkowe pliki
// wydarzenia, wysyłka teraz albo zaplanowana. Serwer: `emailSetup`, `emailPreview` i `sendCalculationEmail`
// w `src/lib/native/eventCalculations.ts` (wysyłka `op=calculationEmail` w `/bridge/native/v1/events/card`).

struct CalculationEmailSetup: Decodable {
    struct Account: Decodable, Identifiable, Hashable {
        var id: String
        var label: String
    }
    struct File: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var size: Double?
        var createdAt: String?
    }
    var accounts: [Account]
    var to: String
    var contact: String
    var subject: String
    var text: String
    var pdfReady: Bool
    var files: [File]
}

/// Okno wysyłki dla kalkulacji z listy.
struct CalculationEmailRoute: Identifiable {
    let calculationID: String
    let name: String
    var id: String { calculationID }
}

extension EventCardStore {
    /// Podgląd wiadomości ze stopką i szablonem skrzynki (bez zapisu).
    func calculationEmailPreview(_ eventID: String, calculationID: String, accountId: String, subject: String, text: String) async throws -> String {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let html: String }
        let body: [String: JSONValue] = [
            "op": .string("tabAction"), "id": .string(eventID), "tab": .string("calculations"), "action": .string("emailPreview"),
            "calculationId": .string(calculationID), "accountId": .string(accountId), "subject": .string(subject), "text": .string(text),
        ]
        return try JSONDecoder().decode(Reply.self, from: try await api.post("/events/card", body)).html
    }

    /// Wysyłka albo zaplanowanie; zwraca komunikat jak w CRM.
    func sendCalculationEmail(_ eventID: String, calculationID: String, accountId: String, to: String, cc: String, bcc: String, subject: String,
                              text: String, fileIDs: [String], scheduledAt: Date?) async throws -> String {
        guard let api, let workspace, workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Wysyłka wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable { var scheduled: Bool; var scheduledAt: String? }
        let body: [String: JSONValue] = [
            "op": .string("calculationEmail"), "id": .string(eventID), "calculationId": .string(calculationID),
            "accountId": .string(accountId), "to": .string(to), "cc": .string(cc), "bcc": .string(bcc), "subject": .string(subject),
            "text": .string(text), "fileIds": .array(fileIDs.map { JSONValue.string($0) }),
            "scheduledAt": scheduledAt.map { JSONValue.string(MeetingDates.iso($0)) } ?? .null,
        ]
        let data = try await workspace.withPending(scheduledAt == nil ? "Wysyłanie kalkulacji…" : "Planowanie wysyłki…") {
            try await api.post("/events/card", body, timeout: 120)
        }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        return reply.scheduled ? "Kalkulacja zostanie wysłana \(OfferText.dayTime(reply.scheduledAt))" : "Kalkulacja wysłana przez email"
    }
}

@MainActor struct CalculationEmailSheet: View {
    let backend: CalculationBackend
    let calculationID: String
    let name: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var setup: CalculationEmailSetup?
    @State private var loadError: String?
    @State private var accountId = ""
    @State private var to = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var subject = ""
    @State private var text = ""
    @State private var scheduled = false
    @State private var scheduledAt = ComposeSheet.defaultSchedule
    @State private var includeFiles = false
    @State private var fileIDs: Set<String> = []
    @State private var previewHTML: String?
    @State private var previewLoading = false
    @State private var sending = false
    @State private var problem: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Wyślij kalkulację przez email", systemImage: "envelope").font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            if let setup {
                form(setup)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć wysyłki", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack {
                Button { Task { await showPreview() } } label: {
                    if previewLoading { ProgressView().controlSize(.small) } else { Label("Podgląd", systemImage: "eye") }
                }
                .disabled(previewLoading || accountId.isEmpty || setup == nil)
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction).disabled(sending)
                Button { Task { await send() } } label: {
                    if sending { Text(scheduled ? "Planowanie..." : "Wysyłanie...") }
                    else { Label(scheduled ? "Zaplanuj wysyłkę" : "Wyślij email", systemImage: "paperplane") }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(sending || accountId.isEmpty || setup?.pdfReady != true)
            }
            .padding(16).crmBar()
        }
        .frame(minWidth: 720, idealWidth: 780, minHeight: 640, idealHeight: 740)
        .task { await load() }
        .sheet(isPresented: Binding(get: { previewHTML != nil }, set: { if !$0 { previewHTML = nil } })) {
            VStack(spacing: 0) {
                HStack { Text("Podgląd wiadomości").font(.headline); Spacer(); Button("Zamknij") { previewHTML = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                EmailWebView(html: previewHTML ?? "")
            }
            .frame(width: 760, height: 720)
        }
        .alert("Nie wysłano kalkulacji", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .interactiveDismissDisabled(sending)
        .overlay {
            if sending { PendingOverlay(text: scheduled ? "Planowanie wysyłki…" : "Pobieram załączniki i wysyłam…") }
            else if previewLoading { PendingOverlay(text: "Przygotowywanie podglądu ze stopką…") }
        }
    }

    private func form(_ setup: CalculationEmailSetup) -> some View {
        Form {
            Section {
                if setup.accounts.isEmpty {
                    Text("Nie masz skonfigurowanych kont pocztowych").foregroundStyle(.secondary)
                } else {
                    Picker("Od:", selection: $accountId) { ForEach(setup.accounts) { Text($0.label).tag($0.id) } }
                }
                TextField("Do:", text: $to, prompt: Text("email@example.com"))
                if !setup.contact.isEmpty { Text("Osoba kontaktowa: \(setup.contact)").font(.caption).foregroundStyle(.secondary) }
                TextField("DW:", text: $cc, prompt: Text("Opcjonalnie"))
                TextField("UDW:", text: $bcc, prompt: Text("Opcjonalnie"))
                TextField("Temat:", text: $subject, prompt: Text("Temat wiadomości"))
            }
            Section("Wiadomość:") {
                TextEditor(text: $text).font(.body).frame(minHeight: 160)
                Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Załączniki") {
                Label(setup.pdfReady ? "Aktualny PDF kalkulacji „\(name)” zostanie dołączony do wiadomości."
                                     : "PDF kalkulacji nie został jeszcze wygenerowany. Najpierw kliknij „Generuj PDF”.",
                      systemImage: setup.pdfReady ? "doc.richtext" : "exclamationmark.triangle")
                    .foregroundStyle(setup.pdfReady ? Color.blue : Color.orange)
                if backend.hasEvent {
                    Toggle("Dołącz dodatkowe pliki z eventu", isOn: $includeFiles)
                }
                if includeFiles && backend.hasEvent {
                    Text("Zobaczysz tylko pliki, do których masz dostęp zgodnie z uprawnieniami. Wybierz pliki, które chcesz dołączyć do wiadomości.")
                        .font(.caption).foregroundStyle(.secondary)
                    if setup.files.isEmpty {
                        Text("Brak plików w wydarzeniu.").foregroundStyle(.secondary)
                    }
                    ForEach(setup.files) { file in
                        Toggle(isOn: Binding(get: { fileIDs.contains(file.id) }, set: { on in
                            if on { fileIDs.insert(file.id) } else { fileIDs.remove(file.id) }
                        })) {
                            HStack {
                                Text(file.name).lineLimit(1)
                                Spacer()
                                if let size = file.size { Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                        .toggleStyle(.checkbox)
                    }
                }
            }
            Section("Wysyłka") {
                Picker("Wysyłka", selection: $scheduled) { Text("Wyślij teraz").tag(false); Text("Zaplanuj wysyłkę").tag(true) }
                    .pickerStyle(.segmented).labelsHidden()
                if scheduled { DatePicker("Termin wysyłki", selection: $scheduledAt, in: Date()...) }
            }
        }
        .formStyle(.grouped)
        .disabled(sending)
    }

    private func load() async {
        loadError = nil
        do {
            let next = try await backend.query("emailSetup", ["calculationId": calculationID], as: CalculationEmailSetup.self)
            accountId = next.accounts.first?.id ?? ""
            to = next.to
            subject = next.subject
            text = next.text
            setup = next
        } catch {
            loadError = backend.failureText(error, "Błąd podczas ładowania kont email")
        }
    }

    private func showPreview() async {
        previewLoading = true
        defer { previewLoading = false }
        do {
            previewHTML = try await backend.previewEmail(draft(scheduledAt: nil))
        } catch {
            problem = backend.failureText(error, "Nie udało się przygotować podglądu.")
        }
    }

    /// Sprawdzenia jak `handleSend` w CRM, potem wysyłka (PDF i pliki pobiera serwer).
    private func send() async {
        if to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź adres email odbiorcy"; return }
        if subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź temat wiadomości"; return }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź treść wiadomości"; return }
        if setup?.accounts.isEmpty == true { problem = "Nie masz skonfigurowanych kont pocztowych"; return }
        if accountId.isEmpty { problem = "Wybierz konto pocztowe nadawcy"; return }
        if scheduled && scheduledAt.timeIntervalSinceNow < 30 { problem = "Termin wysyłki musi przypadać w przyszłości"; return }
        sending = true
        defer { sending = false }
        do {
            let notice = try await backend.sendEmail(draft(scheduledAt: scheduled ? scheduledAt : nil))
            state.succeed(notice)
            dismiss()
        } catch {
            problem = backend.failureText(error, "Błąd podczas wysyłania email")
        }
    }

    /// Wiadomość z formularza (podgląd bierze skrzynkę, temat i treść; wysyłka — całość).
    private func draft(scheduledAt: Date?) -> CalculationEmailDraft {
        CalculationEmailDraft(calculationID: calculationID, accountId: accountId, to: to.trimmingCharacters(in: .whitespacesAndNewlines),
                              cc: cc, bcc: bcc, subject: subject.trimmingCharacters(in: .whitespacesAndNewlines), text: text,
                              fileIDs: includeFiles ? Array(fileIDs) : [], scheduledAt: scheduledAt)
    }
}
