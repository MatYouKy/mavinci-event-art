import SwiftUI

// MARK: Oferty, część D2 — okna czynności z karty „Akcje” jak w CRM: „Wyślij ofertę przez email” (`SendOfferEmailModal`),
// „Powiąż ofertę” (`OfferLinkModal`), powód aktualizacji zaakceptowanej oferty (`OfferDraftRevisionActions`) i „Utwórz
// wydarzenie z zapytania” (`ConvertInquiryModal`). Serwer: `src/lib/native/offerActions.ts`.

struct OfferEmailSetup: Decodable {
    struct Account: Decodable, Identifiable, Hashable {
        var id: String
        var label: String
    }
    var number: String
    var accounts: [Account]
    var to: String
    var recipientName: String
    var subject: String
    var text: String
    var pdfReady: Bool
}

struct OfferLinkChoice: Decodable, Identifiable, Hashable {
    var id: String
    var label: String
    var date: String?
    var company: String
    var contact: String
    var email: String
}

struct OfferEventSetup: Decodable {
    struct Option: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }
    var eventId: String?
    var name: String?
    var date: String?
    var location: String?
    var endNote: String?
    var categories: [Option]?
    var companies: [Option]?
    var companyId: String?
}

extension OffersStore {
    private func readAction<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get(path))
    }

    private func postAction<T: Decodable>(_ body: [String: JSONValue], timeout: TimeInterval? = nil, as type: T.Type) async throws -> T {
        guard let api, workspace?.canWrite == true else {
            throw NativeFailure(status: 0, message: "Ta czynność wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        return try JSONDecoder().decode(T.self, from: try await api.post("/offers", body, timeout: timeout))
    }

    func emailSetup(_ id: String) async throws -> OfferEmailSetup {
        try await readAction("/offers?op=emailSetup&id=\(id)", as: OfferEmailSetup.self)
    }

    func linkChoices(_ id: String, kind: String, search: String) async throws -> [OfferLinkChoice] {
        struct Reply: Decodable { var choices: [OfferLinkChoice] }
        let query = search.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)?.replacingOccurrences(of: "&", with: "%26") ?? ""
        return try await readAction("/offers?op=linkChoices&id=\(id)&kind=\(kind)&search=\(query)", as: Reply.self).choices
    }

    func eventSetup(_ id: String) async throws -> OfferEventSetup {
        try await readAction("/offers?op=eventSetup&id=\(id)", as: OfferEventSetup.self)
    }

    fileprivate func emailFields(_ id: String, accountId: String, subject: String, text: String, recipientName: String) -> [String: JSONValue] {
        ["id": .string(id), "accountId": .string(accountId), "subject": .string(subject), "text": .string(text), "recipientName": .string(recipientName)]
    }

    func emailPreview(_ id: String, accountId: String, subject: String, text: String, recipientName: String) async throws -> String {
        struct Reply: Decodable { var html: String }
        var body = emailFields(id, accountId: accountId, subject: subject, text: text, recipientName: recipientName)
        body["op"] = .string("emailPreview")
        return try await postAction(body, as: Reply.self).html
    }

    func emailAI(_ id: String, subject: String, text: String, instructions: String) async throws -> String {
        struct Reply: Decodable { var text: String }
        let body: [String: JSONValue] = [
            "op": .string("emailAI"), "id": .string(id), "subject": .string(subject), "text": .string(text), "instructions": .string(instructions),
        ]
        return try await postAction(body, timeout: 120, as: Reply.self).text
    }

    /// Wysyłka (albo zaplanowanie) oferty; zwraca komunikat dla pracownika i ewentualne ostrzeżenie funkcji poczty.
    func emailSend(_ id: String, accountId: String, to: String, cc: String, bcc: String, subject: String, text: String,
                   recipientName: String, scheduledAt: Date?) async throws -> (notice: String, warning: String?) {
        struct Reply: Decodable { var scheduled: Bool; var scheduledAt: String?; var warning: String? }
        var body = emailFields(id, accountId: accountId, subject: subject, text: text, recipientName: recipientName)
        body["op"] = .string("emailSend")
        body["to"] = .string(to)
        body["cc"] = .string(cc)
        body["bcc"] = .string(bcc)
        body["scheduledAt"] = scheduledAt.map { JSONValue.string(MeetingDates.iso($0)) } ?? .null
        let reply = try await postAction(body, timeout: 120, as: Reply.self)
        await loadDetail(id)
        Task { await sync(force: true) }
        let notice = reply.scheduled
            ? "Oferta zostanie wysłana \(OfferText.dayTime(reply.scheduledAt))"
            : "Oferta wysłana przez email"
        return (notice, reply.warning)
    }

    func createEvent(_ id: String, name: String, date: Date, categoryId: String?, companyId: String?) async throws -> String? {
        struct Reply: Decodable { var eventId: String? }
        let body: [String: JSONValue] = [
            "op": .string("eventCreate"), "id": .string(id), "name": .string(name), "date": .string(MeetingDates.iso(date)),
            "categoryId": categoryId.map { JSONValue.string($0) } ?? .null, "companyId": companyId.map { JSONValue.string($0) } ?? .null,
        ]
        let reply = try await postAction(body, timeout: 120, as: Reply.self)
        await loadDetail(id)
        Task { await sync(force: true) }
        return reply.eventId
    }
}

// MARK: Wyślij ofertę przez email

@MainActor struct OfferEmailSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    @Environment(\.dismiss) private var dismiss
    @State private var setup: OfferEmailSetup?
    @State private var loadError: String?
    @State private var accountId = ""
    @State private var to = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var subject = ""
    @State private var text = ""
    @State private var scheduled = false
    @State private var scheduledAt = ComposeSheet.defaultSchedule
    @State private var aiOpen = false
    @State private var aiInstruction = "Popraw błędy językowe i zredaguj wiadomość, zachowując jej sens."
    @State private var aiResult = ""
    @State private var aiBusy = false
    @State private var previewHTML: String?
    @State private var previewLoading = false
    @State private var sending = false
    @State private var problem: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Wyślij ofertę przez email", systemImage: "envelope").font(.title2.bold())
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
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction).disabled(sending || aiBusy)
                Button { Task { await send() } } label: {
                    if sending { Text(scheduled ? "Planowanie..." : "Wysyłanie...") }
                    else { Label(scheduled ? "Zaplanuj ofertę" : "Wyślij ofertę", systemImage: "paperplane") }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(sending || aiBusy || accountId.isEmpty || setup?.pdfReady != true)
            }
            .padding(16).crmBar()
        }
        .frame(minWidth: 760, idealWidth: 820, minHeight: 680, idealHeight: 780)
        .task { await load() }
        .sheet(isPresented: Binding(get: { previewHTML != nil }, set: { if !$0 { previewHTML = nil } })) {
            VStack(spacing: 0) {
                HStack { Text("Podgląd wiadomości").font(.headline); Spacer(); Button("Zamknij") { previewHTML = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                EmailWebView(html: previewHTML ?? "")
            }
            .frame(width: 760, height: 720)
        }
        .alert("Nie wysłano oferty", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .interactiveDismissDisabled(sending || aiBusy)
        .overlay {
            if sending { PendingOverlay(text: scheduled ? "Planowanie wysyłki…" : "Wysyłanie oferty…") }
            else if previewLoading { PendingOverlay(text: "Przygotowywanie podglądu ze stopką…") }
        }
    }

    private func form(_ setup: OfferEmailSetup) -> some View {
        Form {
            Section {
                if setup.accounts.isEmpty {
                    Text("Nie masz skrzynki, z której możesz wysłać ofertę.").foregroundStyle(.secondary)
                } else {
                    Picker("Od:", selection: $accountId) { ForEach(setup.accounts) { Text($0.label).tag($0.id) } }
                }
                TextField("Do:", text: $to, prompt: Text("email@example.com"))
                if !setup.recipientName.isEmpty { Text("Klient: \(setup.recipientName)").font(.caption).foregroundStyle(.secondary) }
                TextField("DW:", text: $cc, prompt: Text("Opcjonalnie"))
                TextField("UDW:", text: $bcc, prompt: Text("Opcjonalnie"))
                TextField("Temat:", text: $subject, prompt: Text("Temat wiadomości"))
            }
            Section("Wiadomość:") {
                TextEditor(text: $text).font(.body).frame(minHeight: 180).disabled(aiBusy)
                HStack {
                    Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button { aiOpen.toggle() } label: { Label("Redaguj AI", systemImage: "sparkles") }.controlSize(.small).disabled(sending || aiBusy)
                }
                if aiOpen { aiPanel }
            }
            Section {
                Label(setup.pdfReady ? "Aktualny, wygenerowany PDF oferty \(setup.number) zostanie dołączony do wiadomości."
                                     : "Wygeneruj aktualny PDF oferty przed wysyłką.",
                      systemImage: setup.pdfReady ? "doc.richtext" : "exclamationmark.triangle")
                    .foregroundStyle(setup.pdfReady ? Color.blue : Color.orange)
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

    private var aiPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Polecenie dla AI").font(.caption).foregroundStyle(.secondary)
            TextField("", text: Binding(get: { aiInstruction }, set: { aiInstruction = String($0.prefix(2000)) }),
                      prompt: Text("Np. popraw błędy lub napisz bardziej formalnie"), axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.roundedBorder)
            Button(aiBusy ? "Redagowanie…" : "Przygotuj propozycję") { Task { await redact() } }
                .controlSize(.small).disabled(aiBusy || aiInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if !aiResult.isEmpty {
                Text("Propozycja treści").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $aiResult).font(.body).frame(minHeight: 140)
                HStack {
                    Button("Użyj propozycji") {
                        text = aiResult.trimmingCharacters(in: .whitespacesAndNewlines)
                        aiResult = ""
                        aiOpen = false
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(aiResult.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Odrzuć") { aiResult = "" }
                }
                .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        loadError = nil
        do {
            let next = try await store.emailSetup(offerID)
            accountId = next.accounts.first?.id ?? ""
            to = next.to
            subject = next.subject
            text = next.text
            setup = next
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać skrzynek pracownika")
        }
    }

    private func showPreview() async {
        previewLoading = true
        defer { previewLoading = false }
        do {
            previewHTML = try await store.emailPreview(offerID, accountId: accountId, subject: subject, text: text, recipientName: setup?.recipientName ?? "")
        } catch {
            problem = store.failureText(error, "Nie udało się przygotować podglądu.")
        }
    }

    private func redact() async {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { problem = "Wpisz wiadomość oraz polecenie dla AI."; return }
        aiBusy = true
        aiResult = ""
        defer { aiBusy = false }
        do {
            aiResult = try await store.emailAI(offerID, subject: subject, text: text, instructions: aiInstruction)
        } catch {
            problem = store.failureText(error, "Nie udało się zredagować wiadomości.")
        }
    }

    private func send() async {
        if to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź adres email odbiorcy"; return }
        if subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź temat wiadomości"; return }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź treść wiadomości"; return }
        if accountId.isEmpty { problem = "Wybierz skrzynkę pracownika, z której ma zostać wysłana oferta"; return }
        if scheduled && scheduledAt.timeIntervalSinceNow < 30 { problem = "Termin wysyłki musi przypadać w przyszłości"; return }
        sending = true
        defer { sending = false }
        do {
            let result = try await store.emailSend(offerID, accountId: accountId, to: to, cc: cc, bcc: bcc, subject: subject, text: text,
                                                   recipientName: setup?.recipientName ?? "", scheduledAt: scheduled ? scheduledAt : nil)
            store.workspace?.succeed(result.notice)
            if let warning = result.warning { store.workspace?.notice = warning }
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas wysyłania email")
        }
    }
}

// MARK: Powiąż ofertę

@MainActor struct OfferLinkSheet: View {
    @ObservedObject var store: OffersStore
    let detail: OfferDetail
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var kind: String
    @State private var search = ""
    @State private var choices: [OfferLinkChoice] = []
    @State private var selected: String?
    @State private var loading = false
    @State private var saving = false
    @State private var problem: String?

    init(store: OffersStore, detail: OfferDetail) {
        self.store = store
        self.detail = detail
        _kind = State(initialValue: detail.offer.eventId != nil ? "inquiry" : "event")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Powiąż ofertę").font(.title3.weight(.semibold))
            Picker("Rodzaj powiązania", selection: Binding(get: { kind }, set: { next in
                kind = next
                selected = nil
                search = ""
            })) {
                Text("Wydarzenia").tag("event").disabled(detail.offer.eventId != nil)
                Text("Moje zapytania").tag("inquiry").disabled(detail.offer.inquiryId != nil)
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            TextField("", text: $search, prompt: Text(kind == "event" ? "Wyszukaj wydarzenie…" : "Wyszukaj moje zapytanie…"))
                .textFieldStyle(.roundedBorder)
            ScrollView {
                VStack(spacing: 6) {
                    if loading {
                        ProgressView("Wczytywanie…").padding(.vertical, 20)
                    } else if choices.isEmpty {
                        Text("Brak wyników. Spróbuj innej nazwy.").font(.callout).foregroundStyle(.secondary).padding(.vertical, 20)
                    } else {
                        ForEach(choices) { choice in row(choice) }
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .frame(height: 320)
            Text("Lista pokazuje do 30 wyników. Powiązanie nie rezerwuje sprzętu."
                 + (detail.offer.status == "accepted" && kind == "inquiry" ? " Ta oferta zostanie oznaczona jako zaakceptowana w wybranym zapytaniu." : ""))
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Powiąż ofertę") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(selected == nil || loading || saving)
            }
        }
        .padding(20)
        .frame(width: 600)
        .task(id: kind + "|" + search) {
            loading = true
            selected = nil
            problem = nil
            try? await Task.sleep(for: .milliseconds(300))
            if Task.isCancelled { return }
            do {
                choices = try await store.linkChoices(detail.offer.id, kind: kind, search: search)
            } catch {
                choices = []
                problem = store.failureText(error, "Nie udało się wczytać listy.")
            }
            loading = false
        }
    }

    private func row(_ choice: OfferLinkChoice) -> some View {
        Button { selected = choice.id } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: selected == choice.id ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected == choice.id ? theme.accent : Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(choice.label).font(.callout.weight(.medium))
                    if let date = choice.date.flatMap(OfferText.day) { Text(date).font(.caption).foregroundStyle(.secondary) }
                    if !choice.company.isEmpty { Text("Klient: \(choice.company)").font(.caption) }
                    if !choice.contact.isEmpty { Text("Kontakt: \(choice.contact)").font(.caption).foregroundStyle(.secondary) }
                    if choice.email.isEmpty {
                        Text("Brak adresu e-mail").font(.caption2).foregroundStyle(.tertiary)
                    } else {
                        Text(choice.email).font(.caption).foregroundStyle(theme.accent)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .background((selected == choice.id ? theme.accent.opacity(0.15) : Color.primary.opacity(0.04)), in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func save() async {
        guard let selected else { return }
        saving = true
        defer { saving = false }
        if await store.change(detail.offer.id, "link", ["kind": .string(kind), "targetId": .string(selected)], success: "Zapisano powiązanie oferty") {
            dismiss()
        } else if let message = store.workspace?.error {
            problem = message
        }
    }
}

// MARK: Powód aktualizacji zaakceptowanej oferty

@MainActor struct OfferRevisionReasonSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dlaczego oferta została zaktualizowana?").font(.title3.weight(.semibold))
            ProductTextArea(text: Binding(get: { reason }, set: { reason = String($0.prefix(2000)) }),
                            prompt: "Np. klientka zamówiła 4 dodatkowe mikrofony", lines: 4...8)
            if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Wróć do edycji") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz aktualizację") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || reason.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
            }
        }
        .padding(20)
        .frame(width: 520)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if await store.change(offerID, "draftRevision", ["action": .string("save"), "reason": .string(reason)],
                              success: "Zapisano uzasadnienie i historię aktualizacji. Oferta pozostaje szkicem.") {
            dismiss()
        } else if let message = store.workspace?.error {
            problem = message
        }
    }
}

// MARK: Utwórz wydarzenie z zapytania

@MainActor struct OfferEventSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    let setup: OfferEventSetup
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var date: Date
    @State private var hasDate: Bool
    @State private var categoryId = ""
    @State private var companyId: String
    @State private var saving = false
    @State private var problem: String?

    init(store: OffersStore, offerID: String, setup: OfferEventSetup) {
        self.store = store
        self.offerID = offerID
        self.setup = setup
        _name = State(initialValue: setup.name ?? "")
        let parsed = Self.parse(setup.date ?? "")
        _date = State(initialValue: parsed ?? Date())
        _hasDate = State(initialValue: parsed != nil)
        _companyId = State(initialValue: setup.companyId ?? "")
    }

    /// „RRRR-MM-DDTGG:MM” w strefie Europe/Warsaw.
    static func parse(_ value: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = MeetingDates.zone
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter.date(from: value)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Utwórz wydarzenie z zapytania").font(.title3.weight(.semibold))
            Text("Dokumenty i zadania zachowają powiązania. Przy zaakceptowanej ofercie przeniesiemy wycenę oraz plan zasobów i dodamy zadanie weryfikacji dostępności.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let note = setup.endNote { Text(note).font(.callout).foregroundStyle(.secondary) }
            if let location = setup.location, !location.isEmpty { Text("Miejsce wydarzenia: \(location)").font(.callout).foregroundStyle(.secondary) }
            ProductField(label: "Nazwa") { TextField("", text: $name).textFieldStyle(.roundedBorder) }
            ProductField(label: "Termin *") {
                HStack {
                    if hasDate {
                        DatePicker("", selection: $date, displayedComponents: [.date, .hourAndMinute]).labelsHidden()
                            .environment(\.timeZone, MeetingDates.zone)
                    } else {
                        Button("Ustaw termin") { hasDate = true }
                    }
                }
            }
            HStack(alignment: .top, spacing: 12) {
                ProductField(label: "Kategoria") {
                    Picker("", selection: $categoryId) {
                        Text("Bez kategorii").tag("")
                        ForEach(setup.categories ?? []) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden()
                }
                ProductField(label: "Działalność") {
                    Picker("", selection: $companyId) {
                        Text("Nieprzypisana").tag("")
                        ForEach(setup.companies ?? []) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden()
                }
            }
            if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Tworzenie…" : "Utwórz wydarzenie") { Task { await create() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || !hasDate)
            }
        }
        .padding(20)
        .frame(width: 560)
        .interactiveDismissDisabled(saving)
    }

    private func create() async {
        saving = true
        problem = nil
        defer { saving = false }
        do {
            let eventId = try await store.createEvent(offerID, name: name.trimmingCharacters(in: .whitespaces), date: date,
                                                      categoryId: categoryId.isEmpty ? nil : categoryId, companyId: companyId.isEmpty ? nil : companyId)
            store.workspace?.succeed("Zapytanie zostało przekształcone w wydarzenie")
            dismiss()
            if let eventId { state.showEvent(eventId) }
        } catch {
            problem = store.failureText(error, "Nie udało się utworzyć wydarzenia")
        }
    }
}
