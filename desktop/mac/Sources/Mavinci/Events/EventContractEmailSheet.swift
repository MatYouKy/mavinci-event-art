import SwiftUI

// MARK: „Wyślij draft umowy przez email” / „Wyślij umowę przez email” (`SendContractEmailModal`): skrzynka pracownika,
// adresat jak w umowie (osoba kontaktowa albo organizacja), temat i treść zależne od tego, czy umowa jest szkicem, stopka
// i szablon firmy („Podgląd”), PDF umowy zawsze w załączniku, dodatkowe pliki wydarzenia z oznaczeniem zaakceptowanej oferty
// i kalkulacji, wysyłka teraz albo zaplanowana. Wysłana od razu umowa (nie szkic) dostaje status „Wysłana”.
// Serwer: `emailSetup`, `emailPreview` i `sendContractEmail` w `src/lib/native/eventContractEmail.ts`
// (wysyłka `op=contractEmail` w `/bridge/native/v1/events/card`).

struct ContractEmailSetup: Decodable {
    struct Account: Decodable, Identifiable, Hashable {
        var id: String
        var label: String
    }
    struct File: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var size: Double?
        var createdAt: String?
        /// „Zaakceptowana oferta” / „Zaakceptowana kalkulacja”.
        var approval: String?
    }
    var draft: Bool
    var accounts: [Account]
    var to: String
    var contact: String
    var subject: String
    var text: String
    var pdfReady: Bool
    var files: [File]
    var filesError: String?
}

extension EventCardStore {
    /// Podgląd wiadomości ze stopką i szablonem skrzynki (bez zapisu).
    func contractEmailPreview(_ eventID: String, contractID: String, accountId: String, subject: String, text: String) async throws -> String {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let html: String }
        let body: [String: JSONValue] = [
            "op": .string("tabAction"), "id": .string(eventID), "tab": .string("contract"), "action": .string("emailPreview"),
            "contractId": .string(contractID), "accountId": .string(accountId), "subject": .string(subject), "text": .string(text),
        ]
        return try JSONDecoder().decode(Reply.self, from: try await api.post("/events/card", body)).html
    }

    /// Wysyłka albo zaplanowanie; zwraca komunikat jak w CRM.
    func sendContractEmail(_ eventID: String, contractID: String, accountId: String, to: String, cc: String, bcc: String, subject: String,
                           text: String, fileIDs: [String], scheduledAt: Date?) async throws -> String {
        guard let api, let workspace, workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Wysyłka wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable { var draft: Bool; var scheduled: Bool; var scheduledAt: String? }
        let body: [String: JSONValue] = [
            "op": .string("contractEmail"), "id": .string(eventID), "contractId": .string(contractID),
            "accountId": .string(accountId), "to": .string(to), "cc": .string(cc), "bcc": .string(bcc), "subject": .string(subject),
            "text": .string(text), "fileIds": .array(fileIDs.map { JSONValue.string($0) }),
            "scheduledAt": scheduledAt.map { JSONValue.string(MeetingDates.iso($0)) } ?? .null,
        ]
        let data = try await workspace.withPending(scheduledAt == nil ? "Wysyłanie umowy…" : "Planowanie wysyłki…") {
            try await api.post("/events/card", body, timeout: 120)
        }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        if reply.scheduled {
            return (reply.draft ? "Draft umowy zostanie wysłany " : "Umowa zostanie wysłana ") + OfferText.dayTime(reply.scheduledAt)
        }
        return reply.draft ? "Draft umowy wysłany przez email" : "Umowa wysłana przez email"
    }
}

@MainActor struct EventContractEmailSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let contractID: String
    let sent: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var setup: ContractEmailSetup?
    @State private var loadError: String?
    @State private var accountId = ""
    @State private var to = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var subject = ""
    @State private var text = ""
    @State private var scheduled = false
    @State private var scheduledAt = ComposeSheet.defaultSchedule
    @State private var fileIDs: Set<String> = []
    @State private var previewHTML: String?
    @State private var previewLoading = false
    @State private var sending = false
    @State private var problem: String?

    private var draft: Bool { setup?.draft ?? false }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label(draft ? "Wyślij draft umowy przez email" : "Wyślij umowę przez email", systemImage: "envelope").font(.title2.bold())
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
                    if sending { Text("Wysyłanie...") }
                    else {
                        let label: String = scheduled ? (draft ? "Zaplanuj draft" : "Zaplanuj umowę") : (draft ? "Wyślij draft" : "Wyślij umowę")
                        Label(label, systemImage: "paperplane")
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(sending || setup == nil || setup?.accounts.isEmpty == true || setup?.pdfReady != true)
            }
            .padding(16).crmBar()
        }
        .frame(minWidth: 720, idealWidth: 780, minHeight: 660, idealHeight: 760)
        .task { await load() }
        .sheet(isPresented: Binding(get: { previewHTML != nil }, set: { if !$0 { previewHTML = nil } })) {
            VStack(spacing: 0) {
                HStack { Text("Podgląd wiadomości").font(.headline); Spacer(); Button("Zamknij") { previewHTML = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                EmailWebView(html: previewHTML ?? "")
            }
            .frame(width: 760, height: 720)
        }
        .alert(Text(draft ? "Nie wysłano draftu umowy" : "Nie wysłano umowy"), isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .interactiveDismissDisabled(sending)
        .overlay {
            if sending { PendingOverlay(text: scheduled ? "Planowanie wysyłki…" : "Pobieram PDF umowy i załączniki, wysyłam…") }
            else if previewLoading { PendingOverlay(text: "Przygotowywanie podglądu ze stopką…") }
        }
    }

    private func form(_ setup: ContractEmailSetup) -> some View {
        Form {
            Section {
                if setup.accounts.isEmpty {
                    Text("Nie masz skonfigurowanych kont pocztowych").foregroundStyle(.secondary)
                } else {
                    Picker("Od:", selection: $accountId) { ForEach(setup.accounts) { Text($0.label).tag($0.id) } }
                }
                TextField("Do:", text: $to, prompt: Text("email@example.com"))
                if !setup.contact.isEmpty { Text("Klient: \(setup.contact)").font(.caption).foregroundStyle(.secondary) }
                TextField("DW:", text: $cc, prompt: Text("Opcjonalnie"))
                TextField("UDW:", text: $bcc, prompt: Text("Opcjonalnie"))
                TextField("Temat:", text: $subject, prompt: Text("Temat wiadomości"))
            }
            Section("Wiadomość:") {
                TextEditor(text: $text).font(.body).frame(minHeight: 160)
                Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.").font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Label(setup.pdfReady ? "PDF \(draft ? "draftu" : "umowy") zostanie dołączony do wiadomości."
                                     : "PDF umowy nie został jeszcze wygenerowany. Najpierw użyj przycisku „Generuj PDF”.",
                      systemImage: setup.pdfReady ? "doc.richtext" : "exclamationmark.triangle")
                    .foregroundStyle(setup.pdfReady ? Color.blue : Color.orange)
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
                Text(draft
                     ? "PDF draftu zostanie dołączony zawsze. Zaznaczone pliki będą dodatkowymi załącznikami, a dokument zachowa status „Szkic” i nadal będzie można go edytować."
                     : "PDF umowy zostanie dołączony zawsze. Zaznaczone pliki będą dodatkowymi załącznikami, a status umowy zmieni się na „Wysłana”.")
                    .font(.caption).foregroundStyle(.orange)
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

    private func fileRow(_ file: ContractEmailSetup.File) -> some View {
        Toggle(isOn: Binding(get: { fileIDs.contains(file.id) }, set: { on in
            if on { fileIDs.insert(file.id) } else { fileIDs.remove(file.id) }
        })) {
            HStack(spacing: 8) {
                Text(file.name).lineLimit(1)
                if let approval = file.approval {
                    Label(approval, systemImage: "checkmark.seal.fill")
                        .font(.caption2.weight(.medium)).foregroundStyle(.green)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.green.opacity(0.12), in: Capsule())
                }
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
            let next = try await store.tabQuery(eventID, "contract", "emailSetup", ["contractId": contractID], as: ContractEmailSetup.self)
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
            previewHTML = try await store.contractEmailPreview(eventID, contractID: contractID, accountId: accountId, subject: subject, text: text)
        } catch {
            problem = store.failureText(error, "Nie udało się przygotować podglądu.")
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
            let notice = try await store.sendContractEmail(eventID, contractID: contractID, accountId: accountId, to: to.trimmingCharacters(in: .whitespacesAndNewlines),
                                                           cc: cc, bcc: bcc, subject: subject.trimmingCharacters(in: .whitespacesAndNewlines), text: text,
                                                           fileIDs: Array(fileIDs), scheduledAt: scheduled ? scheduledAt : nil)
            await sent()
            state.succeed(notice)
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas wysyłania email")
        }
    }
}
