import SwiftUI

// MARK: Zakładka „Korespondencja” eventu (`EventCorrespondenceTab` w CRM): wiadomości z klientem o evencie — wysłane z eventu
// (agenda, Karta Weselna, kalkulacja, umowa, oferta i faktura eventu), odpowiedzi w tych wątkach, korespondencja zapytania,
// dołączone ręcznie — razem z wiadomościami systemowymi (np. potwierdzenie realizacji), z filtrem „Ukryj systemowe”,
// kierunkiem i wyszukiwaniem. „Napisz do klienta” i „Odpowiedz” wysyłają od osoby wysyłającej (pierwsza skrzynka — własna),
// a wiadomość trafia do wątku eventu. Prywatność skrzynek jak w Wiadomościach. Serwer: `src/lib/native/eventCorrespondence.ts`
// (zakładka `correspondence`, odczyty `suggestions` / `search` / `composeSetup`, czynności `link` / `exclude` / `preview`,
// wysyłka `op=correspondenceEmail`).

struct EventCorrespondenceData: Decodable, Equatable {
    struct Attachment: Decodable, Hashable { var id: String; var filename: String; var size: Double? }
    struct Message: Decodable, Hashable {
        var key: String
        var type: String
        var id: String
        var subject: String
        var from: String
        var to: String
        var at: String
        var body: String
        var attachments: [Attachment]
        var source: String
        var system: Bool
        var accessible: Bool
        var incoming: Bool { type == "received" }
    }
    struct Scheduled: Decodable, Hashable { var id: String; var status: String; var scheduledAt: String?; var subject: String; var to: String; var error: String?; var author: String? }
    struct Excluded: Decodable, Hashable { var key: String; var type: String; var id: String; var subject: String?; var at: String? }
    struct Recipient: Decodable, Hashable { var eventName: String; var to: String; var name: String }
    var messages: [Message]
    var scheduled: [Scheduled]
    var excluded: [Excluded]
    var canManage: Bool
    var signature: String
    var recipient: Recipient
}

/// Wiadomość z wyszukiwania („Dołącz…”) i z „Inne wiadomości z klientem”.
struct EventMailCandidate: Decodable, Hashable { var key: String; var type: String; var id: String; var subject: String; var from: String; var to: String; var at: String }

enum EventMailText {
    static let sources: [String: String] = [
        "event": "Wysłana z eventu", "backfill": "Wysłana z eventu", "manual": "Dołączona",
        "confirmation": "Potwierdzenie realizacji", "inquiry": "Z zapytania", "thread": "W wątku",
    ]
    static let scheduled: [String: String] = ["scheduled": "Zaplanowana", "processing": "Wysyłanie", "retry": "Ponawiana", "failed": "Nieudana"]
    static func replySubject(_ subject: String) -> String {
        let trimmed = subject.trimmingCharacters(in: .whitespaces)
        return trimmed.range(of: #"^(re|odp)\s*:"#, options: [.regularExpression, .caseInsensitive]) != nil ? trimmed : "Re: \(trimmed)"
    }
    static func size(_ bytes: Double?) -> String {
        guard let bytes, bytes > 0 else { return "" }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

@MainActor struct EventCorrespondenceTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("eventCorrespondence.hideSystem") private var hideSystem = false
    @State private var query = ""
    @State private var direction = "all"
    @State private var selection: String?
    @State private var composing: EventCorrespondenceCompose?
    @State private var attaching = false
    @State private var suggesting = false

    private var data: EventCorrespondenceData? { store.tab(eventID, "correspondence", as: EventCorrespondenceData.self) }

    private func visible(_ data: EventCorrespondenceData) -> [EventCorrespondenceData.Message] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return data.messages.filter { message in
            if hideSystem && message.system { return false }
            if direction != "all" && message.type != direction { return false }
            if needle.isEmpty { return true }
            return ([message.subject, message.from, message.to, message.body] + message.attachments.map(\.filename))
                .contains { $0.lowercased().contains(needle) }
        }
    }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|correspondence"] {
                ContentUnavailableView {
                    Label("Nie udało się wczytać korespondencji", systemImage: "envelope.badge")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "correspondence") } } }
            } else {
                ProgressView("Ładowanie korespondencji…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "correspondence") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await store.loadTab(eventID, "correspondence") }
        }
        .sheet(item: $composing) { compose in
            EventCorrespondenceComposeSheet(store: store, eventID: eventID, compose: compose) { await store.loadTab(eventID, "correspondence") }
        }
        .sheet(isPresented: $attaching) {
            EventCorrespondenceAttachSheet(store: store, eventID: eventID)
        }
        .sheet(isPresented: $suggesting) {
            EventCorrespondenceSuggestionsSheet(store: store, eventID: eventID, known: Set((data?.messages.map(\.key) ?? []) + (data?.excluded.map(\.key) ?? [])),
                                                canManage: data?.canManage == true)
        }
    }

    // MARK: Układ

    private func content(_ data: EventCorrespondenceData) -> some View {
        let messages = visible(data)
        let systemCount = data.messages.filter(\.system).count
        return VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Korespondencja").font(.title2.weight(.light))
                    Text("\(data.messages.count) \(data.messages.count == 1 ? "wiadomość" : "wiadomości")\(systemCount > 0 ? " · systemowe: \(systemCount)" : "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { Task { await store.loadTab(eventID, "correspondence") } } label: { Image(systemName: "arrow.clockwise") }
                    .help("Odśwież korespondencję")
                Button { suggesting = true } label: { Label("Inne wiadomości z klientem", systemImage: "person.2") }
                if data.canManage {
                    Button { attaching = true } label: { Label("Dołącz…", systemImage: "plus") }
                        .help("Dołącz wiadomość lub całą konwersację z Twoich skrzynek")
                }
                Button { composing = EventCorrespondenceCompose(reply: nil) } label: { Label("Napisz do klienta", systemImage: "square.and.pencil") }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 18).padding(.vertical, 12)
            HStack(spacing: 12) {
                TextField("Szukaj w temacie, adresach, treści…", text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 360)
                Picker("Kierunek", selection: $direction) {
                    Text("Wszystkie").tag("all"); Text("Odebrane").tag("received"); Text("Wysłane").tag("sent")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                Toggle("Ukryj systemowe", isOn: $hideSystem).toggleStyle(.checkbox)
                Spacer()
            }
            .padding(.horizontal, 18).padding(.bottom, 10)
            Divider()
            HStack(spacing: 0) {
                list(data, messages).frame(minWidth: 320, idealWidth: 400, maxWidth: 460)
                Divider()
                detail(data, messages.first { $0.key == selection } ?? data.messages.first { $0.key == selection })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private func list(_ data: EventCorrespondenceData, _ messages: [EventCorrespondenceData.Message]) -> some View {
        List(selection: $selection) {
            if !data.scheduled.isEmpty {
                Section("Zaplanowane wysyłki") {
                    ForEach(data.scheduled, id: \.id) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.subject.isEmpty ? "(bez tematu)" : item.subject).lineLimit(1)
                            Text([EventMailText.scheduled[item.status] ?? item.status, OfferText.dayTime(item.scheduledAt), item.to, item.author ?? ""]
                                .filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(item.status == "failed" ? Color.red : Color.secondary).lineLimit(1)
                            if let error = item.error { Text(error).font(.caption2).foregroundStyle(.red).lineLimit(2) }
                        }
                        .selectionDisabled()
                    }
                }
            }
            Section("Wiadomości") {
                if messages.isEmpty {
                    Text(data.messages.isEmpty
                         ? "Brak wiadomości o tym evencie w Twoich skrzynkach. Wiadomości wysłane z eventu i odpowiedzi klienta pojawią się tutaj."
                         : "Żadna wiadomość nie pasuje do filtrów.")
                        .font(.callout).foregroundStyle(.secondary).padding(.vertical, 8)
                        .selectionDisabled()
                }
                ForEach(messages, id: \.key) { message in row(message).tag(message.key) }
            }
            if data.canManage && !data.excluded.isEmpty {
                Section("Wykluczone (\(data.excluded.count))") {
                    ForEach(data.excluded, id: \.key) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.subject ?? "Wiadomość spoza Twoich skrzynek").lineLimit(1).foregroundStyle(.secondary)
                                if let at = item.at { Text(OfferText.dayTime(at)).font(.caption).foregroundStyle(.tertiary) }
                            }
                            Spacer()
                            Button("Przywróć") { Task { await exclude(type: item.type, id: item.id, exclude: false) } }.controlSize(.small)
                        }
                        .selectionDisabled()
                    }
                }
            }
        }
        .listStyle(.inset)
    }

    private func row(_ message: EventCorrespondenceData.Message) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: message.incoming ? "arrow.down.left" : "arrow.up.right")
                .foregroundStyle(message.incoming ? Color.green : theme.accent).frame(width: 16)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(message.subject.isEmpty ? "(bez tematu)" : message.subject).fontWeight(.medium).lineLimit(1)
                    Spacer(minLength: 6)
                    Text(OfferText.dayTime(message.at)).font(.caption).foregroundStyle(.secondary)
                }
                Text(message.incoming ? "Od: \(message.from)" : "Do: \(message.to)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 6) {
                    Text(EventMailText.sources[message.source] ?? message.source).font(.caption2).foregroundStyle(.secondary)
                    if message.system { Label("Systemowa", systemImage: "checkmark.shield").font(.caption2).foregroundStyle(.blue) }
                    if !message.attachments.isEmpty { Label("\(message.attachments.count)", systemImage: "paperclip").font(.caption2).foregroundStyle(.secondary) }
                }
            }
        }
        .padding(.vertical, 3)
        .opacity(message.system ? 0.85 : 1)
    }

    @ViewBuilder private func detail(_ data: EventCorrespondenceData, _ message: EventCorrespondenceData.Message?) -> some View {
        if let message {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(message.subject.isEmpty ? "(bez tematu)" : message.subject).font(.title3.weight(.semibold)).textSelection(.enabled)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Od: \(message.from)").textSelection(.enabled)
                        Text("Do: \(message.to)").textSelection(.enabled)
                        Text(OfferText.dayTime(message.at))
                    }
                    .font(.callout).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        Text(EventMailText.sources[message.source] ?? message.source).font(.caption)
                            .padding(.horizontal, 8).padding(.vertical, 3).background(Color.secondary.opacity(0.12), in: Capsule())
                        if message.system {
                            Label("Systemowa", systemImage: "checkmark.shield").font(.caption).foregroundStyle(.blue)
                                .padding(.horizontal, 8).padding(.vertical, 3).background(Color.blue.opacity(0.1), in: Capsule())
                        }
                    }
                    HStack(spacing: 8) {
                        if message.accessible && message.incoming {
                            Button { composing = EventCorrespondenceCompose(reply: message) } label: { Label("Odpowiedz", systemImage: "arrowshape.turn.up.left") }
                        }
                        if message.accessible {
                            Button { Task { await state.openLink("/crm/messages/\(message.id)?type=\(message.type)") } } label: {
                                Label("Otwórz w Wiadomościach", systemImage: "envelope.open")
                            }
                        }
                        if data.canManage {
                            Button { Task { await exclude(type: message.type, id: message.id, exclude: true) } } label: {
                                Label("Wyklucz z eventu", systemImage: "xmark.circle")
                            }
                        }
                    }
                    if !message.accessible {
                        Text("Wiadomość ze skrzynki, do której nie masz dostępu — widoczna tutaj jako wiadomość systemowa o evencie.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Divider()
                    Text(message.body.isEmpty ? "Brak treści wiadomości." : message.body)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    if !message.attachments.isEmpty {
                        Divider()
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Załączniki").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            ForEach(message.attachments, id: \.id) { attachment in
                                Label("\(attachment.filename)\(EventMailText.size(attachment.size).isEmpty ? "" : " · \(EventMailText.size(attachment.size))")",
                                      systemImage: "paperclip").font(.callout).textSelection(.enabled)
                            }
                        }
                    }
                }
                .padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            ContentUnavailableView("Wybierz wiadomość", systemImage: "envelope", description: Text("Treść, załączniki i odpowiedź — po zaznaczeniu wiadomości na liście."))
        }
    }

    private func exclude(type: String, id: String, exclude: Bool) async {
        do {
            try await store.tabAction(eventID, "correspondence", "exclude", ["type": .string(type), "messageId": .string(id), "exclude": .bool(exclude)],
                                      reload: ["correspondence"], success: exclude ? "Wiadomość wykluczona z korespondencji eventu" : "Wiadomość przywrócona do korespondencji eventu",
                                      pending: exclude ? "Wykluczanie…" : "Przywracanie…")
            if exclude && selection == "\(type):\(id)" { selection = nil }
        } catch {
            state.error = store.failureText(error, "Nie udało się zmienić korespondencji.")
        }
    }
}

extension EventCardStore {
    /// Podgląd wiadomości z zakładki „Korespondencja” (stopka i szablon skrzynki, cytat odpowiedzi) — bez zapisu.
    func correspondencePreview(_ eventID: String, _ body: [String: JSONValue]) async throws -> String {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let html: String }
        var request = body
        request["op"] = .string("tabAction")
        request["id"] = .string(eventID)
        request["eventId"] = .string(eventID)
        request["tab"] = .string("correspondence")
        request["action"] = .string("preview")
        return try JSONDecoder().decode(Reply.self, from: try await api.post("/events/card", request)).html
    }

    /// Wysyłka albo zaplanowanie wiadomości z zakładki; zwraca komunikat jak w CRM.
    func sendCorrespondence(_ eventID: String, _ body: [String: JSONValue], scheduledAt: Date?) async throws -> String {
        guard let api, let workspace, workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Wysyłka wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable { var scheduled: Bool; var scheduledAt: String?; var warning: String? }
        var request = body
        request["op"] = .string("correspondenceEmail")
        request["id"] = .string(eventID)
        request["scheduledAt"] = scheduledAt.map { JSONValue.string(MeetingDates.iso($0)) } ?? .null
        let payload = request
        let data = try await workspace.withPending(scheduledAt == nil ? "Wysyłanie wiadomości…" : "Planowanie wysyłki…") {
            try await api.post("/events/card", payload, timeout: 120)
        }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        let notice = reply.scheduled ? "Wiadomość zostanie wysłana \(OfferText.dayTime(reply.scheduledAt))" : "Wiadomość wysłana"
        if let warning = reply.warning, !warning.isEmpty { return "\(notice) — \(warning)" }
        return notice
    }
}

/// Okno wysyłki z zakładki: nowa wiadomość do klienta albo odpowiedź na odebraną wiadomość.
struct EventCorrespondenceCompose: Identifiable {
    let id = UUID()
    var reply: EventCorrespondenceData.Message?
}

private struct EventCorrespondenceComposeSetup: Decodable {
    struct Account: Decodable, Identifiable, Hashable { var id: String; var label: String }
    var accounts: [Account]
    var to: String
    var contact: String
    var subject: String
}

@MainActor private struct EventCorrespondenceComposeSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let compose: EventCorrespondenceCompose
    let sent: () async -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var setup: EventCorrespondenceComposeSetup?
    @State private var loadError: String?
    @State private var accountId = ""
    @State private var to = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var subject = ""
    @State private var text = ""
    @State private var scheduled = false
    @State private var scheduledAt = ComposeSheet.defaultSchedule
    @State private var previewHTML: String?
    @State private var previewLoading = false
    @State private var sending = false
    @State private var problem: String?
    @State private var recipientField: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label(compose.reply == nil ? "Napisz do klienta" : "Odpowiedź", systemImage: compose.reply == nil ? "square.and.pencil" : "arrowshape.turn.up.left")
                    .font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            if let setup {
                form(setup)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć wysyłki", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
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
                    if sending { Text("Wysyłanie...") } else { Label(scheduled ? "Zaplanuj wysyłkę" : "Wyślij", systemImage: "paperplane") }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(recipientField == nil ? .defaultAction : nil)
                .disabled(sending || setup == nil || setup?.accounts.isEmpty == true)
            }
            .padding(16).crmBar()
        }
        .frame(minWidth: 700, idealWidth: 760, minHeight: 600, idealHeight: 700)
        .task { await load() }
        .sheet(isPresented: Binding(get: { previewHTML != nil }, set: { if !$0 { previewHTML = nil } })) {
            VStack(spacing: 0) {
                HStack { Text("Podgląd wiadomości").font(.headline); Spacer(); Button("Zamknij") { previewHTML = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                EmailWebView(html: previewHTML ?? "")
            }
            .frame(width: 760, height: 720)
        }
        .alert(Text("Nie wysłano wiadomości"), isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .interactiveDismissDisabled(sending)
        .overlay {
            if sending { PendingOverlay(text: scheduled ? "Planowanie wysyłki…" : "Wysyłanie wiadomości…") }
            else if previewLoading { PendingOverlay(text: "Przygotowywanie podglądu ze stopką…") }
        }
    }

    private func form(_ setup: EventCorrespondenceComposeSetup) -> some View {
        Form {
            Section {
                if setup.accounts.isEmpty {
                    Text("Nie masz skonfigurowanych kont pocztowych").foregroundStyle(.secondary)
                } else {
                    Picker("Od:", selection: $accountId) { ForEach(setup.accounts) { Text($0.label).tag($0.id) } }
                }
                RecipientField("Do:", text: $to, prompt: "email@example.com", field: "to", openField: $recipientField, inForm: true)
                if compose.reply == nil && !setup.contact.isEmpty { Text("Klient: \(setup.contact)").font(.caption).foregroundStyle(.secondary) }
                RecipientField("DW:", text: $cc, prompt: "Opcjonalnie", field: "cc", openField: $recipientField, inForm: true)
                RecipientField("UDW:", text: $bcc, prompt: "Opcjonalnie", field: "bcc", openField: $recipientField, inForm: true)
                TextField("Temat:", text: $subject, prompt: Text("Temat wiadomości"))
            }
            Section("Wiadomość:") {
                TextEditor(text: $text).font(.body).frame(minHeight: 180)
                Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”. Wiadomość trafi do korespondencji eventu.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let reply = compose.reply {
                Section("Cytowana wiadomość") {
                    Text("\(reply.from) · \(OfferText.dayTime(reply.at))").font(.caption).foregroundStyle(.secondary)
                    Text(reply.body).font(.callout).foregroundStyle(.secondary).lineLimit(12).textSelection(.enabled)
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
            let next = try await store.tabQuery(eventID, "correspondence", "composeSetup", as: EventCorrespondenceComposeSetup.self)
            // Pierwsza skrzynka to własna skrzynka osoby wysyłającej (kolejność z serwera, `compareSendingAccounts`).
            accountId = next.accounts.first?.id ?? ""
            if let reply = compose.reply {
                to = reply.from
                subject = EventMailText.replySubject(reply.subject)
            } else {
                to = next.to
                subject = next.subject
            }
            setup = next
        } catch {
            loadError = store.failureText(error, "Błąd podczas ładowania kont email")
        }
    }

    private func requestBody() -> [String: JSONValue] {
        var body: [String: JSONValue] = [
            "accountId": .string(accountId), "to": .string(to.trimmingCharacters(in: .whitespacesAndNewlines)), "cc": .string(cc), "bcc": .string(bcc),
            "subject": .string(subject.trimmingCharacters(in: .whitespacesAndNewlines)), "text": .string(text),
        ]
        if let reply = compose.reply { body["replyId"] = .string(reply.id) }
        return body
    }

    private func showPreview() async {
        previewLoading = true
        defer { previewLoading = false }
        do {
            previewHTML = try await store.correspondencePreview(eventID, requestBody())
        } catch {
            problem = store.failureText(error, "Nie udało się przygotować podglądu.")
        }
    }

    private func send() async {
        if to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź adres email odbiorcy"; return }
        if subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź temat wiadomości"; return }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź treść wiadomości"; return }
        if accountId.isEmpty { problem = "Wybierz konto pocztowe nadawcy"; return }
        if scheduled && scheduledAt.timeIntervalSinceNow < 30 { problem = "Termin wysyłki musi przypadać w przyszłości"; return }
        sending = true
        defer { sending = false }
        do {
            let notice = try await store.sendCorrespondence(eventID, requestBody(), scheduledAt: scheduled ? scheduledAt : nil)
            await sent()
            state.succeed(notice)
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się wysłać wiadomości")
        }
    }
}

/// „Dołącz…”: wyszukiwanie po temacie w skrzynkach osoby i dołączenie wiadomości (z całą konwersacją).
@MainActor private struct EventCorrespondenceAttachSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [EventMailCandidate] = []
    @State private var selected: EventMailCandidate?
    @State private var wholeThread = true
    @State private var searching = false
    @State private var info: String?

    private struct Results: Decodable { var messages: [EventMailCandidate] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dołącz wiadomość lub konwersację").font(.title2.bold())
            HStack {
                TextField("Temat wiadomości (min. 3 znaki)", text: $query).textFieldStyle(.roundedBorder).onSubmit { Task { await search() } }
                Button("Szukaj") { Task { await search() } }.disabled(searching || query.trimmingCharacters(in: .whitespaces).count < 3)
            }
            if let info { Text(info).font(.callout).foregroundStyle(.secondary) }
            List(results, id: \.key, selection: Binding(get: { selected?.key }, set: { key in selected = results.first { $0.key == key } })) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.subject.isEmpty ? "(bez tematu)" : item.subject).lineLimit(1)
                    Text("\(item.type == "received" ? "Odebrane" : "Wysłane") · \(OfferText.dayTime(item.at)) · \(item.from) → \(item.to)")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .tag(item.key)
            }
            .frame(minHeight: 260)
            Toggle("Dołącz całą konwersację (także kolejne odpowiedzi)", isOn: $wholeThread).toggleStyle(.checkbox)
            Text("Łączymy odpowiedzi w wątku oraz wiadomości o tym samym temacie z tym samym rozmówcą w tej skrzynce. Prefiksy Re:, Odp: i Fwd: nie zmieniają tematu.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Dołącz") { Task { await attach() } }.buttonStyle(.borderedProminent).disabled(selected == nil)
            }
        }
        .padding(20)
        .frame(minWidth: 620, minHeight: 480)
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard text.count >= 3 else { return }
        searching = true
        defer { searching = false }
        do {
            results = try await store.tabQuery(eventID, "correspondence", "search", ["q": text], as: Results.self).messages
            selected = nil
            info = results.isEmpty ? "Nie znaleziono wiadomości o takim temacie w dostępnych skrzynkach." : nil
        } catch {
            info = store.failureText(error, "Wyszukiwanie korespondencji jest chwilowo niedostępne.")
        }
    }

    private func attach() async {
        guard let selected else { return }
        do {
            try await store.tabAction(eventID, "correspondence", "link",
                                      ["type": .string(selected.type), "messageId": .string(selected.id), "thread": .bool(wholeThread)],
                                      reload: ["correspondence"], success: "Korespondencja została dołączona do eventu", pending: "Dołączanie…")
            dismiss()
        } catch {
            state.error = store.failureText(error, "Nie udało się dołączyć wiadomości.")
        }
    }
}

/// „Inne wiadomości z klientem”: niepowiązane wiadomości z adresami klienta z okresu eventu (tylko skrzynki osoby).
@MainActor private struct EventCorrespondenceSuggestionsSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let known: Set<String>
    let canManage: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var items: [EventMailCandidate]?
    @State private var attached: Set<String> = []
    @State private var error: String?

    private struct Suggestions: Decodable { var messages: [EventMailCandidate]; var addresses: [String] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Inne wiadomości z klientem").font(.title2.bold())
            Text("Niepowiązane wiadomości z adresami klienta (osoba kontaktowa, organizacja, jej domeny) z okresu eventu — tylko z Twoich skrzynek.")
                .font(.callout).foregroundStyle(.secondary)
            if let error {
                Text(error).foregroundStyle(.red)
            } else if let items {
                let rest = items.filter { !known.contains($0.key) && !attached.contains($0.key) }
                if rest.isEmpty {
                    ContentUnavailableView("Brak innych wiadomości z klientem", systemImage: "tray")
                } else {
                    List(rest, id: \.key) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.subject.isEmpty ? "(bez tematu)" : item.subject).lineLimit(1)
                                Text("\(item.type == "received" ? "Od: \(item.from)" : "Do: \(item.to)") · \(OfferText.dayTime(item.at))")
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Button("Otwórz") { Task { await state.openLink("/crm/messages/\(item.id)?type=\(item.type)") } }.controlSize(.small)
                            if canManage { Button("Dołącz z wątkiem") { Task { await attach(item) } }.controlSize(.small) }
                        }
                    }
                }
            } else {
                ProgressView("Wyszukiwanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack { Spacer(); Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction) }
        }
        .padding(20)
        .frame(minWidth: 680, minHeight: 460)
        .task { await load() }
    }

    private func load() async {
        do {
            items = try await store.tabQuery(eventID, "correspondence", "suggestions", as: Suggestions.self).messages
        } catch {
            self.error = store.failureText(error, "Nie udało się wyszukać wiadomości z klientem.")
        }
    }

    private func attach(_ item: EventMailCandidate) async {
        do {
            try await store.tabAction(eventID, "correspondence", "link", ["type": .string(item.type), "messageId": .string(item.id), "thread": .bool(true)],
                                      reload: ["correspondence"], success: "Wiadomość dołączona do korespondencji eventu", pending: "Dołączanie…")
            attached.insert(item.key)
        } catch {
            state.error = store.failureText(error, "Nie udało się dołączyć wiadomości.")
        }
    }
}
