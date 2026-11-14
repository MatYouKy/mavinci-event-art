import SwiftUI

// MARK: Broszury, część G5 — broszury w karcie klienta (kontakt lub organizacja, jak `ContactQuickActions` i zakładka
// „Broszury” w CRM): zapisane wersje PDF przypisane do klienta (`ClientBrochuresPanel`), wysyłka zapisanej wersji bez ponownego
// generowania (`SendSavedBrochureEmailModal`), „Wyślij broszurę” z klientem jako odbiorcą i historia wysyłek klienta.
// Serwer: `src/lib/native/brochureClient.ts`; przygotowanie i wysyłka — `/bridge/brochures/deliveries`, jak w CRM.

/// Klient z karty kontaktu (`RecipientContext`): `contact` albo `organization`.
struct BrochureRecipientContext: Equatable {
    var type: String
    var id: String
    var name: String
    var scope: String { (type == "organization" ? "organization=" : "contact=") + id }
}

/// Zapisane wersje PDF klienta (`sales_brochure_generations`).
struct BrochureSavedList: Decodable {
    struct Version: Decodable, Identifiable {
        var id: String
        var brochureId: String
        var brochureName: String
        var version: Int
        var pdfPath: String
        var fileName: String
        var createdAt: String
        var createdBy: String
        var recipientName: String
        var recipientEmail: String
        var organizationName: String
        var campaign: Bool
        var authorName: String
        var recipient: String {
            let name = recipientName.isEmpty ? "Klient" : recipientName
            return name + (recipientEmail.isEmpty ? " · bez e-maila" : " · " + recipientEmail)
        }
    }
    var canViewAll: Bool
    var canSend: Bool
    var currentEmployeeId: String
    var versions: [Version]
}

/// Okno „Wyślij zapisaną broszurę”: wersja PDF, skrzynki, domyślna treść i ostatnia wiadomość tej wersji.
struct BrochureSavedSetup: Decodable {
    struct Source: Decodable {
        var id: String
        var brochureId: String
        var version: Int
        var fileName: String
        var pdfPath: String
        var recipientName: String
        var fixedEmail: String
        var brochureName: String
    }
    var source: Source
    var accounts: [BrochureMailSetup.Account]
    var to: String
    var subject: String
    var text: String
    var aiInstruction: String
    var delivery: BrochureDelivery?
    var previous: BrochureDelivery?
}

extension BrochuresStore {
    func saved(_ context: BrochureRecipientContext, all: Bool, offset: Int) async throws -> BrochureSavedList {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(BrochureSavedList.self, from: try await api.get("/brochures?op=saved&\(context.scope)&all=\(all)&offset=\(offset)"))
    }

    func savedSetup(_ generationId: String) async throws -> BrochureSavedSetup {
        guard let api else { throw AppError.configuration }
        return try Self.snakeDecoder.decode(BrochureSavedSetup.self, from: try await api.get("/brochures?op=savedSetup&id=\(generationId)"))
    }

    /// Treść wiadomości zapisanej wersji (marka broszury, stopka skrzynki): `bodyHtml` do zapisu, `html` do podglądu.
    func savedCompose(_ generationId: String, accountId: String, subject: String, text: String) async throws -> (bodyHtml: String, html: String) {
        struct Reply: Decodable { var bodyHtml: String; var html: String }
        guard let api else { throw AppError.configuration }
        let body: [String: JSONValue] = [
            "op": .string("savedCompose"), "generationId": .string(generationId), "accountId": .string(accountId),
            "subject": .string(subject), "text": .string(text),
        ]
        let reply = try JSONDecoder().decode(Reply.self, from: try await api.post("/brochures", body))
        return (reply.bodyHtml, reply.html)
    }

    func savedEdit(_ deliveryId: String) async throws -> (subject: String, accountId: String, text: String) {
        struct Reply: Decodable { var subject: String; var accountId: String; var text: String }
        guard let api else { throw AppError.configuration }
        let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/brochures?op=savedEdit&id=\(deliveryId)"))
        return (reply.subject, reply.accountId, reply.text)
    }

    func savedAI(_ generationId: String, subject: String, text: String, instruction: String) async throws -> String {
        struct Reply: Decodable { var text: String }
        guard let api else { throw AppError.configuration }
        let body: [String: JSONValue] = [
            "op": .string("savedAI"), "generationId": .string(generationId), "subject": .string(subject), "text": .string(text),
            "instruction": .string(instruction),
        ]
        return try JSONDecoder().decode(Reply.self, from: try await api.post("/brochures", body, timeout: 90)).text
    }

    /// Ostatnia wiadomość zapisanej wersji PDF (stan po utracie odpowiedzi serwera).
    func latestDelivery(_ generationId: String) async throws -> BrochureDelivery? {
        try await deliveries("generation=\(generationId)").deliveries.first
    }

    /// Kontakt jako odbiorca „Wyślij broszurę” (pusty e-mail — kontakt bez prawidłowego adresu).
    func contactRecipient(_ id: String) async throws -> BrochureRecipient {
        struct Reply: Decodable { var name: String; var email: String; var contactId: String; var organizationId: String? }
        guard let api else { throw AppError.configuration }
        let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/brochures?op=contactRecipient&id=\(id)"))
        return BrochureRecipient(email: reply.email, name: reply.name, contactId: reply.contactId, organizationId: reply.organizationId)
    }
}

/// Otwarcie broszury w edytorze z innego ekranu (np. „Otwórz broszurę bazową” w karcie klienta).
@MainActor final class BrochureRouter: ObservableObject {
    static let shared = BrochureRouter()
    @Published var pending: String?
}

extension Workspace {
    func showBrochure(_ id: String) {
        guard UUID(uuidString: id) != nil else { return }
        guard let item = navigation.flatMap(\.flattened).first(where: { $0.screen == .brochures }) else {
            openCRM("/crm/brochures/\(id)")
            return
        }
        BrochureRouter.shared.pending = id
        openHref(item.href)
    }
}

/// Czynności broszur w szczegółach kontaktu: „Wyślij broszurę”, zapisane PDF-y klienta, historia wysyłek.
@MainActor struct ContactBrochureActions: View {
    let context: BrochureRecipientContext
    @EnvironmentObject private var state: Workspace
    @State private var route: ClientBrochuresRoute?
    @State private var mailing = false

    private var canSend: Bool { state.employee?.has("offers_manage") == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if canSend {
                Button { mailing = true } label: { Label("Wyślij broszurę…", systemImage: "paperplane") }
                    .help("Wybierz broszurę i przygotuj wiadomość z załącznikiem dla tego klienta")
            }
            Button { route = ClientBrochuresRoute(tab: "saved") } label: { Label("Broszury klienta…", systemImage: "book") }
                .help("Zapisane PDF-y przypisane do klienta — otwarcie, pobranie i wysyłka bez ponownego generowania")
            Button { route = ClientBrochuresRoute(tab: "history") } label: { Label("Historia wysyłek broszur…", systemImage: "clock.arrow.circlepath") }
                .help("Wiadomości z broszurą do tego klienta, załączniki i stan wysyłki")
        }
        .buttonStyle(.link)
        .linkCursor()
        .sheet(item: $route) { route in
            ClientBrochuresSheet(context: context, initialTab: route.tab, canSendNew: canSend)
                .environmentObject(state)
                .environment(\.crmTheme, state.theme)
                .tint(state.theme.accent)
        }
        .sheet(isPresented: $mailing) {
            ClientBrochureMailSheet(context: context)
                .environmentObject(state)
                .environment(\.crmTheme, state.theme)
                .tint(state.theme.accent)
        }
    }
}

/// „Wyślij broszurę” z karty klienta — okno wysyłki z wyborem broszury i klientem jako odbiorcą (własny magazyn broszur).
@MainActor struct ClientBrochureMailSheet: View {
    let context: BrochureRecipientContext
    @EnvironmentObject private var state: Workspace
    @StateObject private var store = BrochuresStore()
    @State private var ready = false

    var body: some View {
        Group {
            if ready {
                BrochureMailSheet(store: store, brochureId: nil, context: context)
            } else {
                ProgressView().frame(width: 720, height: 760)
            }
        }
        .task {
            store.workspace = state
            ready = true
        }
    }
}

struct ClientBrochuresRoute: Identifiable {
    let id = UUID()
    let tab: String
}

/// „Broszury klienta”: zapisane wersje PDF (otwarcie, wysyłka własnej wersji, broszura bazowa) i historia wysyłek klienta.
@MainActor struct ClientBrochuresSheet: View {
    let context: BrochureRecipientContext
    let initialTab: String
    let canSendNew: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = BrochuresStore()
    @State private var tab = "saved"
    @State private var list: BrochureSavedList?
    @State private var all = false
    @State private var offset = 0
    @State private var loading = false
    @State private var error: String?
    @State private var selection: String?
    @State private var pdf: OfferPdfPreview?
    @State private var mailing: String?
    @State private var newMail = false
    @State private var revision = 0
    @State private var ready = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Broszury klienta").font(.title3.weight(.semibold))
                    Text(context.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Picker("", selection: $tab) {
                    Text("Zapisane PDF-y").tag("saved")
                    Text("Historia wysyłek").tag("history")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                if canSendNew {
                    Button { newMail = true } label: { Label("Wyślij broszurę…", systemImage: "paperplane") }
                }
            }
            .padding(14)
            Divider()
            if ready {
                if tab == "history" {
                    BrochureDeliveriesPanel(store: store, scope: context.scope, revision: revision, title: "Historia wysyłek broszur",
                                            changed: { revision += 1 })
                } else {
                    savedView
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            HStack {
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(12)
        }
        .frame(width: 900, height: 660)
        .task {
            store.workspace = state
            if initialTab == "history" { tab = "history" }
            ready = true
        }
        .task(id: "\(ready)|\(all)|\(offset)|\(revision)") { await load() }
        .sheet(item: $pdf) { file in OfferPdfViewer(file: file) }
        .sheet(isPresented: $newMail) {
            BrochureMailSheet(store: store, brochureId: nil, context: context, onChange: { revision += 1 })
        }
        .sheet(item: Binding(get: { mailing.map({ id in SavedMailRoute(id: id) }) }, set: { value in mailing = value?.id })) { route in
            BrochureSavedMailSheet(store: store, generationId: route.id) { revision += 1 }
        }
    }

    private var savedView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Zapisane wersje PDF przypisane do tego klienta, także bez wysłania e-maila. Możesz je otworzyć i pobrać ponownie. Późniejsze zmiany broszury bazowej nie zmieniają tych plików.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if list?.canViewAll == true {
                Picker("", selection: Binding(get: { all }, set: { value in
                    all = value
                    offset = 0
                })) {
                    Text("Moje").tag(false)
                    Text("Wszystkie dostępne").tag(true)
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            if let error { Text(error).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            if let rows = list?.versions {
                if rows.isEmpty {
                    ContentUnavailableView("Brak zapisanych broszur", systemImage: "book",
                                           description: Text("W edytorze broszury wybierz tego klienta i wygeneruj PDF."))
                } else {
                    table(rows)
                }
                HStack {
                    Button("Poprzednie") { offset = max(0, offset - 25) }.disabled(offset == 0 || loading)
                    Spacer()
                    Text("Kliknij dwukrotnie wiersz, aby otworzyć zapisany PDF.").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Następne") { offset += 25 }.disabled(rows.count < 25 || loading)
                }
            } else if loading {
                ProgressView("Wczytywanie broszur…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func table(_ rows: [BrochureSavedList.Version]) -> some View {
        Table(rows, selection: $selection) {
            TableColumn("Broszura") { row in
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.brochureName)
                    Text("Wersja \(row.version)").font(.caption).foregroundStyle(.secondary)
                }
            }
            TableColumn("Data") { row in Text(BrochureDates.text(row.createdAt)).foregroundStyle(.secondary) }
            TableColumn("Odbiorca") { row in
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.recipient)
                    if !row.organizationName.isEmpty { Text(row.organizationName).font(.caption).foregroundStyle(.secondary) }
                }
            }
            TableColumn("Przygotował") { row in Text(row.authorName) }
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let row = rows.first(where: { $0.id == id }) {
                Button("Otwórz zapisany PDF") { Task { await open(row) } }
                if canSend(row) {
                    Button("Wyślij tę wersję…") { mailing = row.id }
                }
                Divider()
                Button("Otwórz broszurę bazową") {
                    dismiss()
                    state.showBrochure(row.brochureId)
                }
            }
        } primaryAction: { ids in
            if let id = ids.first, let row = rows.first(where: { $0.id == id }) { Task { await open(row) } }
        }
    }

    private func canSend(_ row: BrochureSavedList.Version) -> Bool {
        list?.canSend == true && row.createdBy == list?.currentEmployeeId && !row.campaign
    }

    private func load() async {
        guard ready else { return }
        loading = true
        defer { loading = false }
        do {
            let next = try await store.saved(context, all: all, offset: offset)
            guard !Task.isCancelled else { return }
            list = next
            error = nil
        } catch {
            guard !Task.isCancelled else { return }
            self.error = store.failureText(error, "Nie udało się pobrać broszur klienta. Spróbuj ponownie.")
        }
    }

    private func open(_ row: BrochureSavedList.Version) async {
        if let file = await store.savedPdf(bucket: "generated-brochures", path: row.pdfPath, fileName: row.fileName) { pdf = file }
    }
}

private struct SavedMailRoute: Identifiable {
    let id: String
}

/// „Wyślij zapisaną broszurę” (`SendSavedBrochureEmailModal`): ten sam PDF bez ponownego generowania; przygotowanie wiadomości,
/// podgląd i osobne zatwierdzenie wysyłki, edycja przygotowanej wiadomości, pomoc AI, świadome ponowienie niepewnej wysyłki.
@MainActor struct BrochureSavedMailSheet: View {
    @ObservedObject var store: BrochuresStore
    let generationId: String
    let onSent: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var setup: BrochureSavedSetup?
    @State private var loadError: String?
    @State private var accountId = ""
    @State private var to = ""
    @State private var subject = ""
    @State private var text = ""
    @State private var delivery: BrochureDelivery?
    @State private var previous: BrochureDelivery?
    @State private var editing = false
    @State private var confirmResend = false
    @State private var acceptDuplicateRisk = false
    @State private var busy: String?
    @State private var error: String?
    @State private var previewShown = false
    @State private var previewHtml = ""
    @State private var pdf: OfferPdfPreview?
    @State private var aiOpen = false
    @State private var aiBusy = false
    @State private var aiInstruction = ""
    @State private var aiResult = ""
    @State private var batch = UUID().uuidString.lowercased()

    private var locked: Bool { setup == nil || busy != nil || aiBusy }
    private var reviewing: Bool { delivery != nil && !editing }
    private var sendable: Bool { ["prepared", "failed"].contains(delivery?.status ?? "") }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Wyślij zapisaną broszurę").font(.title3.weight(.semibold))
                Spacer()
            }
            .padding(16)
            Divider()
            if let setup {
                Form {
                    if let error {
                        Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
                    }
                    attachment(setup.source)
                    if let delivery, !editing { review(delivery) } else { composer(setup) }
                }
                .formStyle(.grouped)
                .task(id: previewKey) { await refreshPreview() }
            } else if let loadError {
                ContentUnavailableView { Label("Nie można wysłać tej wersji", systemImage: "paperplane") } description: { Text(loadError) }
            } else {
                ProgressView("Wczytywanie wersji PDF i danych odbiorcy…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            footer
        }
        .frame(width: 720, height: 780)
        .interactiveDismissDisabled(busy != nil || aiBusy)
        .task { await load() }
        .sheet(item: $pdf) { file in OfferPdfViewer(file: file) }
    }

    private var previewKey: String { "\(previewShown)|\(accountId)|\(subject)|\(text)|\(reviewing)" }

    // MARK: Widoki

    private func attachment(_ source: BrochureSavedSetup.Source) -> some View {
        Section {
            LabeledContent("Załącznik") { Text("Wersja \(source.version) · \(source.fileName)").textSelection(.enabled) }
            Button("Podejrzyj załącznik") { Task { await openAttachment() } }.disabled(locked)
        } footer: {
            Text("Wysyłasz ten zapisany PDF — bez ponownego generowania. Powiązanie z klientem i linki wewnątrz pliku pozostają bez zmian.")
        }
    }

    @ViewBuilder private func review(_ delivery: BrochureDelivery) -> some View {
        Section {
            LabeledContent("Stan") { Text(delivery.label).foregroundStyle(delivery.color) }
            if delivery.retryOfDeliveryId != nil {
                Text("To ręcznie przygotowane ponowienie. Poprzednia próba pozostaje w historii i mogła już dotrzeć do odbiorcy.")
                    .foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
            LabeledContent("Do") { Text(delivery.recipientEmail).textSelection(.enabled) }
            LabeledContent("Temat") { Text(delivery.subject).textSelection(.enabled) }
            if let message = delivery.errorMessage, !message.isEmpty {
                Text(message).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
            EmailWebView(html: delivery.bodyHtml ?? "").frame(height: 300)
            HStack {
                if sendable {
                    Button { Task { await editDelivery() } } label: { Label("Edytuj wiadomość", systemImage: "pencil") }.disabled(locked)
                }
                Spacer()
                Button { Task { await refreshDelivery() } } label: { Label("Odśwież stan", systemImage: "arrow.clockwise") }.disabled(locked)
            }
            if delivery.status == "sending" {
                Text("Wysyłka jeszcze trwa. Sprawdź folder Wysłane i odśwież stan.").foregroundStyle(.orange)
            }
        } header: {
            Text("Przygotowana wiadomość")
        } footer: {
            Text("Powyżej dokładna, wcześniej zapisana wiadomość. Wysyłka użyje tej treści, odbiorcy, stopki i załącznika.")
        }
        if delivery.status == "uncertain" {
            Section {
                Text("Brak potwierdzenia nie oznacza, że wiadomość nie dotarła. Sprawdź folder Wysłane. Możesz świadomie przygotować osobną próbę z tym samym PDF-em, ale odbiorca może otrzymać wiadomość dwukrotnie.")
                    .fixedSize(horizontal: false, vertical: true)
                Toggle("Rozumiem ryzyko duplikatu i chcę przygotować ponowną wysyłkę.", isOn: $acceptDuplicateRisk)
                    .toggleStyle(.checkbox)
                    .disabled(locked)
                Button { Task { await prepareRetry() } } label: { Label("Przygotuj ponowną wysyłkę", systemImage: "arrow.clockwise") }
                    .disabled(locked || !acceptDuplicateRisk)
            } header: {
                Text("Wynik niepewny")
            } footer: {
                Text("Ponowienie jest dostępne po 5 minutach od rozpoczęcia poprzedniej próby, aby dać jej czas na zakończenie. Przygotowanie nie wysyła maila.")
            }
        }
    }

    @ViewBuilder private func composer(_ setup: BrochureSavedSetup) -> some View {
        if editing {
            Section {
                Text("Edytujesz przygotowaną wiadomość. Po zapisaniu ponownie sprawdzisz podgląd z aktualną stopką. Odbiorca i PDF pozostają bez zmian. Treść zapisze się jako zwykły tekst (formatowanie nadane w CRM nie zostanie zachowane).")
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        } else if let previous {
            Section {
                Text("Ten PDF wysłano już \(BrochureDates.text(previous.sentAt ?? previous.createdAt)) do \(previous.recipientEmail).")
                    .fixedSize(horizontal: false, vertical: true)
                Toggle("Chcę przygotować kolejną wiadomość z tą samą wersją PDF.", isOn: $confirmResend).toggleStyle(.checkbox).disabled(locked)
            }
        }
        Section {
            if setup.accounts.isEmpty {
                Text("Brak skrzynki, z której możesz wysyłać wiadomości. Dodaj skrzynkę w ustawieniach poczty CRM.").foregroundStyle(.orange)
            } else {
                Picker("Od", selection: $accountId) { ForEach(setup.accounts) { account in Text(account.label).tag(account.id) } }
            }
            TextField("Do", text: $to, prompt: Text("adres@hotel.pl"))
                .disabled(editing || !setup.source.fixedEmail.isEmpty)
            TextField("Temat", text: $subject)
        } header: {
            Text("Wiadomość")
        } footer: {
            Text(recipientNote(setup))
        }
        .disabled(locked)
        Section {
            TextEditor(text: $text).font(.body).frame(minHeight: 170).disabled(locked)
            HStack {
                Toggle("Podgląd ze stopką", isOn: $previewShown)
                Spacer()
                Button { aiOpen.toggle() } label: { Label("Pomoc AI", systemImage: "sparkles") }.disabled(locked)
            }
            if aiOpen { aiPanel }
            if previewShown {
                EmailWebView(html: previewHtml.isEmpty ? "<p style=\"font-family:-apple-system;color:#888\">Przygotowywanie podglądu…</p>" : previewHtml)
                    .frame(height: 300)
            }
        } header: {
            Text("Treść")
        } footer: {
            Text(editing ? "Zapis poprawek nie wysyła maila. Najpierw sprawdzisz podgląd i osobno zatwierdzisz wysyłkę."
                 : "„Przygotuj wiadomość” zapisze treść ze stopką. Następnie sprawdzisz ją i osobno zatwierdzisz wysłanie.")
        }
    }

    private func recipientNote(_ setup: BrochureSavedSetup) -> String {
        if editing { return "Edycja dotyczy tematu i treści tej przygotowanej wiadomości. Odbiorca pozostaje bez zmian." }
        if !setup.source.fixedEmail.isEmpty { return "Adres jest przypisany do tego PDF. Dla innego odbiorcy przygotuj osobną wersję." }
        return "Ten PDF nie ma przypisanego e-maila. Wpisz adres osoby, do której chcesz go wysłać; powiązanie z klientem pozostanie bez zmian."
    }

    private var aiPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Co AI ma uwzględnić?").font(.caption).foregroundStyle(.secondary)
            TextField("", text: Binding(get: { aiInstruction }, set: { value in aiInstruction = String(value.prefix(1400)) }), axis: .vertical)
                .lineLimit(3...6).textFieldStyle(.roundedBorder).disabled(locked)
            Text("Po kliknięciu poniżej przekażemy do OpenAI treść maila, Twoje wskazówki, nazwę klienta/organizacji i opisy usług z zapisanej broszury. Bez pliku PDF, zdjęć, prywatnych notatek i danych rozliczeniowych z CRM. AI nie wysyła wiadomości i nie zmienia załącznika.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button(aiBusy ? "Przygotowuję propozycję…" : "Przygotuj propozycję AI") { Task { await proposeAI() } }
                .disabled(locked || aiInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if !aiResult.isEmpty {
                Text("Propozycja AI — sprawdź i popraw przed zastosowaniem").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $aiResult).font(.body).frame(minHeight: 140)
                HStack {
                    Button("Zastąp treść propozycją") {
                        text = aiResult.trimmingCharacters(in: .whitespacesAndNewlines)
                        aiResult = ""
                        aiOpen = false
                        store.workspace?.succeed("Zastosowano propozycję. Możesz dalej edytować wiadomość przed wysłaniem.")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(aiResult.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Odrzuć propozycję") { aiResult = "" }
                }
            }
        }
        .controlSize(.small)
        .padding(.vertical, 4)
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if let busy {
                ProgressView().controlSize(.small)
                Text(busy).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            } else if aiBusy {
                ProgressView().controlSize(.small)
                Text("AI analizuje przekazany tekst. Obecna wiadomość pozostaje bez zmian.").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy != nil || aiBusy)
            if editing {
                Button("Anuluj zmiany") {
                    editing = false
                    previewShown = false
                    aiResult = ""
                    aiOpen = false
                    error = nil
                }
                .disabled(locked)
            }
            if setup != nil && !reviewing {
                Button(editing ? "Zapisz zmiany i pokaż podgląd" : "Przygotuj wiadomość") { Task { await prepare() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(locked || accountId.isEmpty || (!editing && previous != nil && !confirmResend))
            }
            if reviewing && sendable {
                Button { Task { await send() } } label: { Label("Wyślij broszurę", systemImage: "paperplane.fill") }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(locked)
            }
        }
        .padding(14)
    }

    // MARK: Działania

    private func load() async {
        do {
            let loaded = try await store.savedSetup(generationId)
            accountId = loaded.accounts.first?.id ?? ""
            to = loaded.to
            subject = loaded.subject
            text = loaded.text
            aiInstruction = loaded.aiInstruction
            delivery = loaded.delivery
            previous = loaded.previous
            setup = loaded
        } catch {
            loadError = store.failureText(error, "Nie udało się otworzyć formularza wysyłki broszury.")
        }
    }

    private func report(_ failure: Error?, _ fallback: String) {
        let message = failure.map { store.failureText($0, fallback) } ?? fallback
        error = message
        store.workspace?.error = message
    }

    private func refreshPreview() async {
        guard previewShown, !reviewing, !accountId.isEmpty, !subject.trimmingCharacters(in: .whitespaces).isEmpty,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        try? await Task.sleep(for: .milliseconds(400))
        guard !Task.isCancelled else { return }
        if let result = try? await store.savedCompose(generationId, accountId: accountId, subject: subject, text: text), !Task.isCancelled {
            previewHtml = result.html
        }
    }

    private func editDelivery() async {
        guard let delivery, sendable, busy == nil else { return }
        busy = "Otwieranie treści do edycji…"
        defer { busy = nil }
        do {
            let draft = try await store.savedEdit(delivery.id)
            accountId = draft.accountId
            subject = draft.subject
            text = draft.text
            to = delivery.recipientEmail
            editing = true
            previewShown = false
            previewHtml = ""
            aiResult = ""
            aiOpen = false
            error = nil
        } catch {
            report(error, "Nie udało się otworzyć treści do edycji.")
        }
    }

    private func proposeAI() async {
        guard !locked else { return }
        if text.count > 12000 {
            report(nil, "Skróć treść wiadomości do 12 000 znaków przed użyciem pomocy AI.")
            return
        }
        aiBusy = true
        aiResult = ""
        error = nil
        defer { aiBusy = false }
        do {
            aiResult = try await store.savedAI(generationId, subject: subject, text: text, instruction: aiInstruction)
        } catch {
            report(error, "Nie udało się przygotować propozycji AI. Twoja treść wiadomości nie została zmieniona.")
        }
    }

    private func prepare() async {
        guard let setup, busy == nil, !aiBusy, !reviewing || editing else { return }
        let edited = editing ? delivery : nil
        let email = to.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let title = subject.trimmingCharacters(in: .whitespaces)
        if !BrochureRecipient.valid(email) || accountId.isEmpty || title.isEmpty || title.count > 250 || subject.contains("\n")
            || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            report(nil, "Sprawdź adres odbiorcy, konto nadawcy, temat (do 250 znaków) i treść wiadomości.")
            return
        }
        if edited == nil && previous != nil && !confirmResend {
            report(nil, "Potwierdź, że chcesz ponownie wysłać tę samą wersję broszury.")
            return
        }
        busy = edited == nil ? "Przygotowywanie wiadomości…" : "Zapisywanie poprawek wiadomości…"
        error = nil
        var html = ""
        do {
            html = try await store.savedCompose(generationId, accountId: accountId, subject: title, text: text).bodyHtml
            var body: [String: JSONValue]
            if let edited {
                body = ["action": .string("update_saved"), "deliveryId": .string(edited.id), "emailAccountId": .string(accountId),
                        "subject": .string(title), "bodyHtml": .string(html)]
                if let revision = edited.draftRevision { body["expectedRevision"] = .number(Double(revision)) }
            } else {
                body = ["action": .string("prepare_saved"), "generationId": .string(setup.source.id), "batchId": .string(batch),
                        "recipient": .object(["email": .string(email)]), "emailAccountId": .string(accountId), "subject": .string(title),
                        "bodyHtml": .string(html), "confirmResend": .bool(confirmResend)]
                if let previous { body["previousDeliveryId"] = .string(previous.id) }
            }
            let saved = try await store.deliveryRequest(body)
            delivery = saved
            editing = false
            previewShown = false
            onSent()
            store.workspace?.succeed(edited != nil
                ? "Zapisano poprawki. Sprawdź podgląd i zatwierdź wysyłkę. Załączony PDF pozostał bez zmian."
                : "Odczytano zapisaną wiadomość. Sprawdź jej treść i stan przed wysłaniem. PDF nie był generowany ponownie.")
        } catch {
            // Odczyt zapisanego stanu bez wysyłki (utracona odpowiedź serwera).
            if let recovered = try? await store.latestDelivery(generationId) {
                if let edited, !html.isEmpty, recovered.id == edited.id, recovered.bodyHtml == html, recovered.subject == title,
                   recovered.emailAccountId == accountId {
                    delivery = recovered
                    editing = false
                    previewShown = false
                    busy = nil
                    store.workspace?.succeed("Odczytano zapisane poprawki. Sprawdź podgląd przed wysłaniem.")
                    return
                }
                if edited == nil, recovered.batchId == batch, recovered.recipientEmail == email { delivery = recovered }
            }
            report(error, edited != nil
                ? "Nie udało się zapisać poprawek. Twoja treść pozostaje w edytorze. Niczego nie wysłano."
                : "Nie udało się przygotować wiadomości. Niczego nie wysłano.")
        }
        busy = nil
    }

    private func send() async {
        guard let current = delivery, !editing, sendable, busy == nil, !aiBusy else { return }
        busy = "Wysyłanie zapisanej broszury…"
        error = nil
        defer { busy = nil }
        var body: [String: JSONValue] = ["action": .string("send"), "deliveryId": .string(current.id)]
        if let revision = current.draftRevision { body["expectedRevision"] = .number(Double(revision)) }
        do {
            let result = try await store.deliveryRequest(body)
            delivery = result
            onSent()
            if result.status == "sent" {
                store.workspace?.succeed("Broszura została wysłana. Zapisano ją w historii wysyłek klienta.")
                dismiss()
            }
        } catch {
            // Bez potwierdzenia nie odblokowujemy wysyłki: stan niepewny do czasu odczytu z serwera.
            var unknown = current
            unknown.status = "uncertain"
            delivery = unknown
            if let recovered = try? await store.latestDelivery(generationId), recovered.id == current.id { delivery = recovered }
            onSent()
            report(error, "Nie otrzymano potwierdzenia wysyłki. Sprawdź stan wiadomości i folder Wysłane przed ponowieniem.")
        }
    }

    private func prepareRetry() async {
        guard let current = delivery, current.status == "uncertain", acceptDuplicateRisk, busy == nil, !aiBusy else { return }
        busy = "Przygotowywanie ponownej wysyłki…"
        error = nil
        defer { busy = nil }
        do {
            let saved = try await store.deliveryRequest(["action": .string("retry_uncertain"), "deliveryId": .string(current.id),
                                                          "acceptDuplicateRisk": .bool(true)])
            delivery = saved
            acceptDuplicateRisk = false
            editing = false
            previewShown = false
            onSent()
            store.workspace?.succeed(["prepared", "failed"].contains(saved.status)
                ? "Przygotowano osobną próbę. Sprawdź wiadomość, ewentualnie ją edytuj i kliknij „Wyślij broszurę”. Niczego teraz nie wysłano."
                : "Odczytano istniejącą próbę ponowienia. Sprawdź jej aktualny stan. Nie uruchomiono nowej wysyłki.")
        } catch {
            report(error, "Nie udało się przygotować ponowienia. Niczego nie wysłano. Możesz odświeżyć stan lub ponowić przygotowanie.")
        }
    }

    private func refreshDelivery() async {
        guard busy == nil, !aiBusy else { return }
        busy = "Sprawdzanie stanu wiadomości…"
        defer { busy = nil }
        do {
            if let latest = try await store.latestDelivery(generationId) { delivery = latest }
            acceptDuplicateRisk = false
            error = nil
        } catch {
            report(error, "Nie udało się odczytać stanu wiadomości.")
        }
    }

    private func openAttachment() async {
        guard let source = setup?.source else { return }
        if let file = await store.savedPdf(bucket: "generated-brochures", path: source.pdfPath, fileName: source.fileName) { pdf = file }
    }
}
