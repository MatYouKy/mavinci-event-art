import SwiftUI

// MARK: „Wyślij agendę e-mailem” / „Wyślij Kartę Weselną e-mailem” (`SendEventDocumentEmailModal`): skrzynka osoby
// wysyłającej (pierwsza — własna), adresat z eventu (para młoda przy karcie weselnej, inaczej osoba kontaktowa albo
// organizacja), temat i treść do edycji, stopka i szablon firmy („Podgląd”), zapisany PDF dokumentu zawsze w załączniku,
// dodatkowe pliki eventu, wysyłka teraz albo zaplanowana. Wiadomość trafia do zakładki „Korespondencja” eventu.
// Serwer: `emailSetup` (zakładki „agenda” / „wedding”), `emailPreview` i `sendEventDocumentEmail`
// w `src/lib/native/eventDocumentEmail.ts` (wysyłka `op=documentEmail` w `/bridge/native/v1/events/card`).

enum EventDocumentEmailKind: String, Identifiable {
    case agenda
    case weddingCard = "wedding-card"
    var id: String { rawValue }
    /// Zakładka karty z odczytami i czynnościami okna (`op=tabQuery` / `op=tabAction`).
    var tab: String { self == .agenda ? "agenda" : "wedding" }
    var fallbackTitle: String { self == .agenda ? "Wyślij agendę e-mailem" : "Wyślij Kartę Weselną e-mailem" }
    var failureTitle: String { self == .agenda ? "Nie wysłano agendy" : "Nie wysłano Karty Weselnej" }
}

struct EventDocumentEmailSetup: Decodable {
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
    var title: String
    var accounts: [Account]
    var to: String
    var contact: String
    var subject: String
    var text: String
    var pdfReady: Bool
    var pdfName: String?
    var attachmentNote: String
    var staleNote: String?
    var files: [File]
    var filesError: String?
}

extension EventCardStore {
    /// Podgląd wiadomości ze stopką i szablonem skrzynki (bez zapisu).
    func documentEmailPreview(_ eventID: String, kind: EventDocumentEmailKind, accountId: String, subject: String, text: String) async throws -> String {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let html: String }
        let body: [String: JSONValue] = [
            "op": .string("tabAction"), "id": .string(eventID), "eventId": .string(eventID), "tab": .string(kind.tab),
            "action": .string("emailPreview"), "accountId": .string(accountId), "subject": .string(subject), "text": .string(text),
        ]
        return try JSONDecoder().decode(Reply.self, from: try await api.post("/events/card", body)).html
    }

    /// Wysyłka albo zaplanowanie; zwraca komunikat jak w CRM (z ostrzeżeniem serwera pocztowego, gdy jest).
    func sendDocumentEmail(_ eventID: String, kind: EventDocumentEmailKind, accountId: String, to: String, cc: String, bcc: String,
                           subject: String, text: String, fileIDs: [String], scheduledAt: Date?) async throws -> String {
        guard let api, let workspace, workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Wysyłka wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable { var scheduled: Bool; var scheduledAt: String?; var sentText: String; var scheduledText: String; var warning: String? }
        let body: [String: JSONValue] = [
            "op": .string("documentEmail"), "id": .string(eventID), "document": .string(kind.rawValue),
            "accountId": .string(accountId), "to": .string(to), "cc": .string(cc), "bcc": .string(bcc), "subject": .string(subject),
            "text": .string(text), "fileIds": .array(fileIDs.map { JSONValue.string($0) }),
            "scheduledAt": scheduledAt.map { JSONValue.string(MeetingDates.iso($0)) } ?? .null,
        ]
        let data = try await workspace.withPending(scheduledAt == nil ? "Wysyłanie wiadomości…" : "Planowanie wysyłki…") {
            try await api.post("/events/card", body, timeout: 120)
        }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        let notice = reply.scheduled ? "\(reply.scheduledText) \(OfferText.dayTime(reply.scheduledAt))" : reply.sentText
        if let warning = reply.warning, !warning.isEmpty { return "\(notice) — \(warning)" }
        return notice
    }
}

@MainActor struct EventDocumentEmailSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let kind: EventDocumentEmailKind
    let sent: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var setup: EventDocumentEmailSetup?
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
    /// Pole adresu z otwartą listą podpowiedzi (`RecipientField`) — wtedy ↩ i Esc obsługuje lista, nie przyciski okna.
    @State private var recipientField: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label(setup?.title ?? kind.fallbackTitle, systemImage: "envelope").font(.title2.bold())
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
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(recipientField == nil ? .cancelAction : nil).disabled(sending)
                Button { Task { await send() } } label: {
                    if sending { Text("Wysyłanie...") }
                    else { Label(scheduled ? "Zaplanuj wysyłkę" : "Wyślij", systemImage: "paperplane") }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(recipientField == nil ? .defaultAction : nil)
                .disabled(sending || setup == nil || setup?.accounts.isEmpty == true || setup?.pdfReady != true)
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
        .alert(Text(kind.failureTitle), isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .interactiveDismissDisabled(sending)
        .overlay {
            if sending { PendingOverlay(text: scheduled ? "Planowanie wysyłki…" : "Pobieram PDF i załączniki, wysyłam…") }
            else if previewLoading { PendingOverlay(text: "Przygotowywanie podglądu ze stopką…") }
        }
    }

    private func form(_ setup: EventDocumentEmailSetup) -> some View {
        Form {
            Section {
                if setup.accounts.isEmpty {
                    Text("Nie masz skonfigurowanych kont pocztowych").foregroundStyle(.secondary)
                } else {
                    Picker("Od:", selection: $accountId) { ForEach(setup.accounts) { Text($0.label).tag($0.id) } }
                }
                RecipientField("Do:", text: $to, prompt: "email@example.com", field: "to", openField: $recipientField, inForm: true)
                if !setup.contact.isEmpty { Text("Adresat: \(setup.contact)").font(.caption).foregroundStyle(.secondary) }
                RecipientField("DW:", text: $cc, prompt: "Opcjonalnie", field: "cc", openField: $recipientField, inForm: true)
                RecipientField("UDW:", text: $bcc, prompt: "Opcjonalnie", field: "bcc", openField: $recipientField, inForm: true)
                TextField("Temat:", text: $subject, prompt: Text("Temat wiadomości"))
            }
            Section("Wiadomość:") {
                TextEditor(text: $text).font(.body).frame(minHeight: 160)
                Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.").font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Label(setup.attachmentNote, systemImage: setup.pdfReady ? "doc.richtext" : "exclamationmark.triangle")
                    .foregroundStyle(setup.pdfReady ? Color.blue : Color.orange)
                if let name = setup.pdfName, setup.pdfReady { Text(name).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                if let stale = setup.staleNote { Label(stale, systemImage: "clock.badge.exclamationmark").font(.caption).foregroundStyle(.orange) }
                Toggle("Dołącz dodatkowe pliki z eventu", isOn: $includeFiles)
                    .onChange(of: includeFiles) { _, on in if !on { fileIDs = [] } }
                if includeFiles {
                    if let error = setup.filesError {
                        Text(error).foregroundStyle(.orange)
                    } else if setup.files.isEmpty {
                        Text("Brak dostępnych plików lub nie masz uprawnień do ich odczytu.").foregroundStyle(.secondary)
                    } else {
                        HStack {
                            Text("Pliki z zakładki „Pliki”, do których masz obecnie dostęp.").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button(fileIDs.count == setup.files.count ? "Odznacz wszystkie" : "Zaznacz wszystkie") {
                                fileIDs = fileIDs.count == setup.files.count ? [] : Set(setup.files.map(\.id))
                            }
                            .buttonStyle(.link)
                        }
                        ForEach(setup.files) { file in fileRow(file) }
                        if !fileIDs.isEmpty { Text("Wybrano: \(fileIDs.count)").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Text("Wysłana wiadomość pojawi się w zakładce „Korespondencja” eventu razem z odpowiedziami klienta.")
                    .font(.caption).foregroundStyle(.secondary)
            } header: { Text("Załączniki") }
            Section("Wysyłka") {
                Picker("Wysyłka", selection: $scheduled) { Text("Wyślij teraz").tag(false); Text("Zaplanuj wysyłkę").tag(true) }
                    .pickerStyle(.segmented).labelsHidden()
                if scheduled { DatePicker("Termin wysyłki", selection: $scheduledAt, in: Date()...) }
            }
        }
        .formStyle(.grouped)
        .disabled(sending)
    }

    private func fileRow(_ file: EventDocumentEmailSetup.File) -> some View {
        Toggle(isOn: Binding(get: { fileIDs.contains(file.id) }, set: { on in
            if on { fileIDs.insert(file.id) } else { fileIDs.remove(file.id) }
        })) {
            HStack(spacing: 8) {
                Text(file.name).lineLimit(1)
                Spacer()
                if let size = file.size, size > 0 {
                    Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .toggleStyle(.checkbox)
    }

    private func load() async {
        loadError = nil
        do {
            let next = try await store.tabQuery(eventID, kind.tab, "emailSetup", as: EventDocumentEmailSetup.self)
            // Pierwsza skrzynka to własna skrzynka osoby wysyłającej (kolejność z serwera, `compareSendingAccounts`).
            accountId = next.accounts.first?.id ?? ""
            to = next.to
            subject = next.subject
            text = next.text
            setup = next
        } catch {
            loadError = store.failureText(error, "Błąd podczas ładowania kont email")
        }
    }

    private func showPreview() async {
        previewLoading = true
        defer { previewLoading = false }
        do {
            previewHTML = try await store.documentEmailPreview(eventID, kind: kind, accountId: accountId, subject: subject, text: text)
        } catch {
            problem = store.failureText(error, "Nie udało się przygotować podglądu.")
        }
    }

    /// Sprawdzenia jak w CRM, potem wysyłka (PDF i pliki pobiera serwer).
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
            let notice = try await store.sendDocumentEmail(eventID, kind: kind, accountId: accountId, to: to.trimmingCharacters(in: .whitespacesAndNewlines),
                                                           cc: cc, bcc: bcc, subject: subject.trimmingCharacters(in: .whitespacesAndNewlines), text: text,
                                                           fileIDs: includeFiles ? Array(fileIDs) : [], scheduledAt: scheduled ? scheduledAt : nil)
            await sent()
            state.succeed(notice)
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas wysyłania email")
        }
    }
}
