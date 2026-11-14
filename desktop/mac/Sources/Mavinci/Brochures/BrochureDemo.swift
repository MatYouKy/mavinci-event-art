import SwiftUI

// MARK: Broszury, część G4 — „Demo strefy sprzedawcy · statystyki i PDF-y” (`BrochureDemoReport`): udostępnienie demo,
// liczniki, wersje broszury z przypisanymi linkami, próbne oferty odwiedzających (szczegóły, PDF, usuwanie) i dobrowolnie
// podane dane. Serwer: `src/lib/native/brochureDemo.ts`; usuwanie — `/bridge/brochures/[id]/demo-documents/[documentId]`.

/// Data i godzina z zapisu bazy (także z mikrosekundami) w formacie systemu.
enum BrochureDates {
    static func text(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return "—" }
        let trimmed = raw.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        guard let date = ISO8601DateFormatter().date(from: trimmed) else { return raw }
        return date.formatted(date: .numeric, time: .shortened)
    }
}

struct BrochureDemoReport: Decodable {
    struct Employee: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }
    struct Attribution: Decodable {
        var recipientEmail: String
        var employeeId: String?
        var version: Int?
        var campaignId: String?
        var campaignName: String
    }
    /// Wersja PDF broszury z linkiem demo przypisanym do autora (i odbiorcy).
    struct Source: Decodable, Identifiable {
        var id: String
        var version: Int
        var pdfPath: String
        var employeeName: String
        var createdAt: String
        var demoUrl: String?
        var recipientEmail: String
        var campaignId: String?
        var recipient: String {
            if campaignId != nil { return "Kampania" }
            return recipientEmail.isEmpty ? "Bez wskazanego odbiorcy" : recipientEmail
        }
    }
    struct Price: Decodable, Hashable {
        var name: String
        var price: String
    }
    /// Próbna oferta wygenerowana przez odwiedzającego demo (także anonimowo).
    struct Document: Decodable, Identifiable {
        var id: String
        var status: String
        var pdfPath: String?
        var createdAt: String
        var downloadStartedAt: String?
        var employeeName: String
        var title: String
        var website: String
        var fullName: String
        var organization: String
        var email: String
        var phone: String
        var primary: String
        var accent: String
        var surface: String
        var prices: [Price]
        var logoAdded: Bool
        var coverAdded: Bool
        var portraitAdded: Bool
        var attribution: Attribution?

        static let labels = ["generating": "Przygotowywanie", "ready": "Gotowy", "failed": "Nieudana próba"]
        var label: String { Self.labels[status] ?? status }
        var person: String { fullName.isEmpty ? "Próba anonimowa" : fullName }
        var detail: String {
            if !organization.isEmpty { return organization }
            return email.isEmpty ? "Bez danych kontaktowych" : email
        }
        var source: String {
            guard let attribution else { return "Link ogólny — bez przypisania" }
            if attribution.campaignId != nil {
                return "Kampania: " + (attribution.campaignName.isEmpty ? "bez nazwy" : attribution.campaignName)
            }
            return attribution.recipientEmail.isEmpty ? "Bez wskazanego odbiorcy" : attribution.recipientEmail
        }
        var sourceVersion: String? { attribution.map({ value in "Broszura v" + (value.version.map({ number in String(number) }) ?? "—") }) }
    }
    struct Person: Decodable, Identifiable {
        var id: String
        var fullName: String
        var organization: String
        var email: String
        var phone: String
        var logoAdded: Bool
        var colors: [String]
        var updatedAt: String
        var employeeName: String
        var visits: Int
        var pdfs: Int
    }

    var canViewAll: Bool
    var canManage: Bool
    var employees: [Employee]
    var sent: Int
    var visits: Int
    var sessions: Int
    var leads: Int
    var pdfs: Int
    var downloads: Int
    var sources: [Source]
    var documents: [Document]
    var people: [Person]
}

extension BrochuresStore {
    func demoReport(_ id: String, all: Bool, employee: String, offset: Int) async throws -> BrochureDemoReport {
        guard let api else { throw AppError.configuration }
        var path = "/brochures?op=demoReport&id=\(id)&all=\(all)&offset=\(offset)"
        if all && !employee.isEmpty { path += "&employee=\(employee)" }
        return try JSONDecoder().decode(BrochureDemoReport.self, from: try await api.get(path))
    }

    /// Usunięcie próbnej oferty z demo wraz z plikiem PDF (jak „Usuń” w CRM).
    func deleteDemoDocument(brochureId: String, documentId: String) async throws {
        let address = (api?.base ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/brochures/\(brochureId)/demo-documents/\(documentId)"
        guard let api, let url = URL(string: address) else { throw AppError.configuration }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AppError.unauthorized }
        if !(200..<300).contains(status) {
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            let message = reply["error"]?.text ?? ""
            throw NativeFailure(status: status, message: message.isEmpty ? "Nie udało się usunąć dokumentu. (HTTP \(status))" : message, fieldErrors: [:])
        }
    }
}

/// Wyniki demo broszury w środkowym panelu edytora (pozycja „Demo i statystyki” w spisie stron).
@MainActor struct BrochureDemoPanel: View {
    @ObservedObject var model: BrochureEditorModel
    @Environment(\.crmTheme) private var theme
    @State private var report: BrochureDemoReport?
    @State private var all = false
    @State private var employee = ""
    @State private var offset = 0
    @State private var loading = false
    @State private var error: String?
    @State private var list = "sources"
    @State private var selectedSource: String?
    @State private var selectedDocument: String?
    @State private var details: BrochureDemoReport.Document?
    @State private var removing: BrochureDemoReport.Document?
    @State private var deleting = false
    @State private var pdf: OfferPdfPreview?

    private var reloadKey: String { "\(all)|\(employee)|\(offset)|\(model.deliveriesRevision)" }
    private var sellerDemo: Binding<Bool> {
        Binding(get: { model.draft?.sellerDemo ?? false }, set: { value in model.draft?.sellerDemo = value })
    }
    private var pageText: String { "Strona \(offset / 50 + 1) · liczniki obejmują całą historię" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Demo strefy sprzedawcy").font(.title3.weight(.semibold))
                    Text("Statystyki, próbne oferty i dane z formularza demo. PDF-y widzą tylko uprawnieni pracownicy.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { Task { await load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(loading || deleting)
            }
            VStack(alignment: .leading, spacing: 2) {
                Toggle("Udostępnij demo z tej broszury", isOn: sellerDemo)
                    .toggleStyle(.switch)
                    .disabled(!model.canEdit)
                Text("Zmiana zapisuje się sama. Po wyłączeniu demo nie otworzy się także z linków w wysłanych PDF-ach.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if report?.canViewAll == true { scope }
            Text(info).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let error { Text(error).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            if let report {
                metrics(report)
                Picker("", selection: $list) {
                    Text("Wersje i linki").tag("sources")
                    Text("Wygenerowane dokumenty").tag("documents")
                    Text("Podane dane").tag("people")
                }
                .pickerStyle(.segmented).labelsHidden()
                Group {
                    switch list {
                    case "documents": documentsTable(report)
                    case "people": peopleTable(report)
                    default: sourcesTable(report)
                    }
                }
                .frame(minHeight: 200, maxHeight: .infinity)
                HStack {
                    Button("Poprzednia strona") { offset = max(0, offset - 50) }.disabled(offset == 0 || loading)
                    Spacer()
                    Text(pageText).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Następna strona") { offset += 50 }
                        .disabled(loading || (report.documents.count < 50 && report.people.count < 50 && report.sources.count < 50))
                }
            } else if loading {
                ProgressView("Wczytywanie wyników…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Spacer()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: reloadKey) { await load() }
        .sheet(item: $details) { document in
            BrochureDemoDocumentSheet(model: model, document: document, open: { Task { await openPdf(document) } })
        }
        .sheet(item: $pdf) { file in OfferPdfViewer(file: file) }
        .confirmationDialog("Usunąć próbną ofertę?", isPresented: Binding(get: { removing != nil }, set: { if !$0 && !deleting { removing = nil } }),
                            titleVisibility: .visible) {
            if let document = removing {
                Button("Usuń dokument i PDF", role: .destructive) { Task { await remove(document) } }
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: {
            Text(removalText)
        }
    }

    private var info: String {
        var value = "Aby zbierać statystyki, wygeneruj PDF i udostępnij jego link z listy „Wersje i linki”."
        if report?.canViewAll == true {
            value += " Autor wersji jest właścicielem jej wyników, niezależnie od opiekuna na okładce. Starsze wejścia bez przypisania są dostępne w widoku „Wszystkie”."
        }
        return value
    }

    private var removalText: String {
        guard let document = removing else { return "" }
        let who = !document.fullName.isEmpty ? document.fullName : !document.organization.isEmpty ? document.organization : "próba anonimowa"
        return "Usuniesz dokument z \(BrochureDates.text(document.createdAt)) (\(who)) oraz zapisany plik PDF. Tej operacji nie można cofnąć. "
            + "Liczniki dokumentów i pobrań zostaną zaktualizowane. Dane sesji i historia wejść pozostaną zachowane."
    }

    private var scope: some View {
        HStack(spacing: 12) {
            Picker("", selection: Binding(get: { all }, set: { value in changeView(value, person: "") })) {
                Text("Moje").tag(false)
                Text("Wszystkie").tag(true)
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            if all {
                Picker("Pracownik", selection: Binding(get: { employee }, set: { value in changeView(true, person: value) })) {
                    Text("Wszyscy, także nieprzypisane").tag("")
                    ForEach(report?.employees ?? []) { person in Text(person.name).tag(person.id) }
                }
                .fixedSize()
            }
            Text(all ? "Wyniki wybranego pracownika lub całego zespołu." : "Tylko Twoje wersje broszury, linki i wyniki demo.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .disabled(deleting)
    }

    private func metrics(_ report: BrochureDemoReport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 8)], spacing: 8) {
                tile(report.sent, "Wysłane wiadomości", action: { model.selectedPage = "deliveries" })
                tile(report.visits, "Wejścia w demo")
                tile(report.sessions, "Sesje demo")
                tile(report.leads, "Próby z danymi")
                tile(report.pdfs, "Gotowe PDF-y")
                tile(report.downloads, "Uruchomione pobrania")
            }
            Text("Wejścia obejmują ponowne otwarcia strony; sesje nie oznaczają unikalnych osób. Uruchomienie pobrania nie potwierdza zapisu na dysku. Podgląd pracownika również może naliczyć wejście. Odbiorca linku nie musi być osobą korzystającą z demo: link mógł zostać przekazany dalej. Dane formularza nie stanowią zgody marketingowej.")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private func tile(_ value: Int, _ label: String, action: (() -> Void)? = nil) -> some View {
        let content = VStack(alignment: .leading, spacing: 2) {
            Text(String(value)).font(.title2.monospacedDigit()).foregroundStyle(theme.accent)
            Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.black.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        if let action {
            Button(action: action) { content.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .help("Pokaż historię wysyłek")
        } else {
            content
        }
    }

    // MARK: Listy

    @ViewBuilder private func sourcesTable(_ report: BrochureDemoReport) -> some View {
        if report.sources.isEmpty {
            ContentUnavailableView("Brak wersji PDF w tym widoku", systemImage: "doc.richtext",
                                   description: Text("Wygeneruj broszurę, aby otrzymać własny link."))
        } else {
            Table(report.sources, selection: $selectedSource) {
                TableColumn("Wersja / data") { row in
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Broszura v" + String(row.version))
                        Text(BrochureDates.text(row.createdAt)).font(.caption).foregroundStyle(.secondary)
                    }
                }
                TableColumn("Pracownik") { row in Text(row.employeeName) }
                TableColumn("Odbiorca / kampania") { row in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.recipient)
                        if row.demoUrl == nil {
                            Text("Bez linku śledzącego — wygeneruj nową wersję z włączonym demo.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let row = report.sources.first(where: { $0.id == id }) { sourceMenu(row) }
            } primaryAction: { ids in
                if let id = ids.first, let row = report.sources.first(where: { $0.id == id }) { Task { await openSource(row) } }
            }
        }
    }

    @ViewBuilder private func sourceMenu(_ row: BrochureDemoReport.Source) -> some View {
        Button("Zobacz PDF") { Task { await openSource(row) } }.disabled(row.pdfPath.isEmpty || deleting)
        Button("Kopiuj przypisany link") { copy(row.demoUrl) }.disabled(row.demoUrl == nil)
        Button("Otwórz przypisane demo") { if let link = row.demoUrl, let url = URL(string: link) { NSWorkspace.shared.open(url) } }
            .disabled(row.demoUrl == nil)
        if let campaign = row.campaignId {
            Divider()
            Button("Zobacz kampanię w CRM") { model.workspace?.openCRM("/crm/campaigns?campaign=\(campaign)") }
        }
    }

    @ViewBuilder private func documentsTable(_ report: BrochureDemoReport) -> some View {
        if report.documents.isEmpty {
            ContentUnavailableView("Nikt jeszcze nie uruchomił generowania", systemImage: "doc.text")
        } else {
            Table(report.documents, selection: $selectedDocument) {
                TableColumn("Data") { row in Text(BrochureDates.text(row.createdAt)).foregroundStyle(.secondary) }
                TableColumn("Osoba / organizacja") { row in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.person)
                        Text(row.detail).font(.caption).foregroundStyle(.secondary)
                    }
                }
                TableColumn("Pracownik") { row in Text(row.employeeName) }
                TableColumn("Źródło linku") { row in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.source)
                        if let version = row.sourceVersion { Text(version).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                TableColumn("Stan / pobranie") { row in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.label).foregroundStyle(row.status == "failed" ? Color.orange : Color.primary)
                        Text(row.downloadStartedAt == nil ? "—" : "Pobranie: " + BrochureDates.text(row.downloadStartedAt))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let row = report.documents.first(where: { $0.id == id }) {
                    Button("Zobacz PDF") { Task { await openPdf(row) } }.disabled(row.pdfPath == nil || deleting)
                    Button("Zobacz szczegóły") { details = row }.disabled(deleting)
                    Divider()
                    Button("Usuń…", role: .destructive) { removing = row }
                        .disabled(!report.canManage || !model.canEdit || deleting || row.status == "generating")
                }
            } primaryAction: { ids in
                if let id = ids.first { details = report.documents.first(where: { $0.id == id }) }
            }
            .onDeleteCommand {
                if report.canManage, model.canEdit, !deleting, let id = selectedDocument,
                   let row = report.documents.first(where: { $0.id == id }), row.status != "generating" { removing = row }
            }
        }
    }

    @ViewBuilder private func peopleTable(_ report: BrochureDemoReport) -> some View {
        if report.people.isEmpty {
            ContentUnavailableView("Brak danych kontaktowych na tej stronie wyników", systemImage: "person.crop.rectangle")
        } else {
            Table(report.people) {
                TableColumn("Osoba / organizacja") { row in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.fullName.isEmpty ? "Bez imienia" : row.fullName).textSelection(.enabled)
                        Text(row.organization).font(.caption).foregroundStyle(.secondary)
                    }
                }
                TableColumn("Pracownik") { row in Text(row.employeeName) }
                TableColumn("Kontakt") { row in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.email.isEmpty ? "—" : row.email).textSelection(.enabled)
                        Text(row.phone).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
                TableColumn("Personalizacja") { row in
                    HStack(spacing: 4) {
                        Text(row.logoAdded ? "Dodano logo" : "Bez logo").font(.caption)
                        ForEach(row.colors, id: \.self) { value in
                            Circle().fill(CrmTheme.hex(value) ?? .clear).frame(width: 10, height: 10).help(value)
                        }
                    }
                }
                TableColumn("Wejścia / PDF") { row in Text("\(row.visits) / \(row.pdfs)").monospacedDigit() }
                TableColumn("Ostatnia zmiana") { row in Text(BrochureDates.text(row.updatedAt)).foregroundStyle(.secondary) }
            }
        }
    }

    // MARK: Działania

    private func changeView(_ showAll: Bool, person: String) {
        guard showAll != all || person != employee else { return }
        report = nil
        error = nil
        details = nil
        removing = nil
        offset = 0
        all = showAll
        employee = person
    }

    private func load() async {
        loading = true
        do {
            let loaded = try await model.store.demoReport(model.id, all: all, employee: employee, offset: offset)
            guard !Task.isCancelled else { return }
            report = loaded
            error = nil
        } catch {
            guard !Task.isCancelled else { return }
            report = nil
            self.error = "Nie udało się odczytać wyników. Sprawdź uprawnienia do statystyk broszur."
        }
        loading = false
    }

    private func copy(_ link: String?) {
        guard let link else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link, forType: .string)
        model.workspace?.succeed("Skopiowano link przypisany do tej wersji broszury i jej autora.")
    }

    private func openSource(_ row: BrochureDemoReport.Source) async {
        guard !row.pdfPath.isEmpty else { return }
        if let file = await model.store.savedPdf(bucket: "generated-brochures", path: row.pdfPath, fileName: "Broszura-v\(row.version).pdf") { pdf = file }
    }

    private func openPdf(_ row: BrochureDemoReport.Document) async {
        guard let path = row.pdfPath else { return }
        if let file = await model.store.savedPdf(bucket: "seller-demo-pdfs", path: path, fileName: "Probna-oferta-demo.pdf") { pdf = file }
    }

    private func remove(_ document: BrochureDemoReport.Document) async {
        guard !deleting else { return }
        deleting = true
        do {
            try await model.workspace?.withPending("Usuwanie próbnej oferty…") {
                try await model.store.deleteDemoDocument(brochureId: model.id, documentId: document.id)
            }
            if details?.id == document.id { details = nil }
            removing = nil
            deleting = false
            model.workspace?.succeed("Usunięto próbną ofertę i jej PDF.")
            await load()
        } catch {
            removing = nil
            deleting = false
            model.workspace?.error = model.store.failureText(error, "Nie udało się usunąć dokumentu.")
        }
    }
}

/// „Szczegóły próbnej oferty” (`DemoDocumentDetails`): dane z formularza demo, źródło zainteresowania, ceny i personalizacja.
@MainActor struct BrochureDemoDocumentSheet: View {
    @ObservedObject var model: BrochureEditorModel
    let document: BrochureDemoReport.Document
    let open: () -> Void
    @Environment(\.dismiss) private var dismiss

    private func value(_ text: String) -> String { text.isEmpty ? "Nie podano" : text }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    LabeledContent("Pracownik") { Text(document.employeeName) }
                    LabeledContent("Utworzono") { Text(BrochureDates.text(document.createdAt)) }
                    LabeledContent("Stan") { Text(document.label) }
                    LabeledContent("Uruchomiono pobranie") {
                        Text(document.downloadStartedAt == nil ? "Nie odnotowano" : BrochureDates.text(document.downloadStartedAt))
                    }
                    LabeledContent("Tytuł oferty") { Text(document.title.isEmpty ? "Przykładowa oferta wydarzenia" : document.title) }
                    LabeledContent("Strona WWW") { Text(value(document.website)).textSelection(.enabled) }
                    LabeledContent("Imię i nazwisko") { Text(value(document.fullName)).textSelection(.enabled) }
                    LabeledContent("Organizacja") { Text(value(document.organization)).textSelection(.enabled) }
                    LabeledContent("E-mail z formularza") { Text(value(document.email)).textSelection(.enabled) }
                    LabeledContent("Telefon") { Text(value(document.phone)).textSelection(.enabled) }
                } header: {
                    Text("Szczegóły próbnej oferty")
                }
                Section {
                    if let source = document.attribution {
                        LabeledContent("Wersja broszury") { Text(source.version.map({ number in String(number) }) ?? "—") }
                        LabeledContent("Odbiorca linku") { Text(source.recipientEmail.isEmpty ? "Nie wskazano" : source.recipientEmail) }
                        if let campaign = source.campaignId {
                            LabeledContent("Kampania") {
                                Button(source.campaignName.isEmpty ? "Otwórz kampanię w CRM" : source.campaignName) {
                                    model.workspace?.openCRM("/crm/campaigns?campaign=\(campaign)")
                                }
                                .buttonStyle(.link)
                            }
                        }
                        if let employee = source.employeeId {
                            Button("Zobacz pracownika, który wygenerował broszurę") { model.workspace?.openCRM("/crm/employees/\(employee)") }
                                .buttonStyle(.link)
                        }
                    } else {
                        Text("Link ogólny — bez przypisania do odbiorcy lub kampanii.").foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Źródło zainteresowania")
                } footer: {
                    if document.attribution != nil {
                        Text("Odbiorca linku i osoba podana w formularzu mogą być różni. Link mógł zostać przekazany dalej.")
                    }
                }
                Section {
                    ForEach(document.prices, id: \.self) { item in
                        LabeledContent(item.name) { Text(item.price) }
                    }
                } header: {
                    Text("Ceny wpisane w demonstracji")
                }
                Section {
                    Text(personalization).foregroundStyle(.secondary)
                    ForEach(swatches, id: \.label) { swatch in
                        LabeledContent(swatch.label) {
                            HStack(spacing: 6) {
                                Circle().fill(CrmTheme.hex(swatch.value) ?? .clear).frame(width: 14, height: 14)
                                Text(swatch.value).font(.caption.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Personalizacja")
                } footer: {
                    Text("Dane zapisane w chwili generowania tego dokumentu. Uruchomienie pobrania nie potwierdza zapisania pliku na dysku.")
                }
            }
            .formStyle(.grouped)
            Divider()
            HStack {
                Button("Zobacz PDF") { open() }.disabled(document.pdfPath == nil)
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(14)
        }
        .frame(width: 560, height: 680)
    }

    private var personalization: String {
        let logo = document.logoAdded ? "Dodano własne logo" : "Bez własnego logo"
        let cover = document.coverAdded ? "Dodano własne zdjęcie okładki" : "Domyślne zdjęcie okładki"
        let portrait = document.portraitAdded ? "Dodano zdjęcie stopki" : "Bez własnego zdjęcia stopki"
        return logo + " · " + cover + " · " + portrait
    }

    private struct Swatch: Hashable {
        var label: String
        var value: String
    }

    private var swatches: [Swatch] {
        [Swatch(label: "Kolor główny", value: document.primary), Swatch(label: "Akcent", value: document.accent),
         Swatch(label: "Tło", value: document.surface)].filter { !$0.value.isEmpty }
    }
}
