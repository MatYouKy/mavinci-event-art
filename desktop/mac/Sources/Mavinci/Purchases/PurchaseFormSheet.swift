import SwiftUI
import UniformTypeIdentifiers

// MARK: Okno „Dodaj zakup” / „Popraw zakup” — 1:1 z CRM (`PurchaseFormModal`): plik dokumentu (zdjęcie paragonu, kilka zdjęć
// stron albo PDF; można też przeciągnąć pliki z Findera — serwer zapisuje plik i odczytuje go AI), dane dokumentu do sprawdzenia,
// sposób zapłaty (domyślnie firmowa karta), kategoria kosztów i opcjonalnie event — koszt eventu (całość albo część dokumentu)
// z listą wszystkich kosztów tego eventu.

@MainActor struct PurchaseFormSheet: View {
    @ObservedObject var store: PurchasesStore
    let document: PurchaseDocument?
    /// Zapisany dokument i czy to nowy zakup.
    let saved: (PurchaseDocument, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft = PurchaseDraft()
    @State private var upload: PurchaseUpload?
    @State private var fileNames: [String] = []
    @State private var working: String?
    @State private var problem: String?
    @State private var importing = false
    @State private var picking = false
    @State private var eventQuery = ""
    @State private var eventOptions: [PurchaseEventOption]?
    @State private var eventLoading = false
    @State private var eventName = ""
    @State private var costs: PurchaseEventCosts?
    @State private var prepared = false
    /// Zakup zapisany — przesłany plik należy już do dokumentu (nie usuwać przy zamknięciu okna).
    @State private var finished = false

    private var companies: [PurchaseCompanyRef] {
        var list = store.access.recordCompanies
        if let document, !list.contains(where: { $0.id == document.companyId }) {
            list.append(PurchaseCompanyRef(id: document.companyId, name: document.companyName ?? "Działalność"))
        }
        return list
    }
    private var hasFile: Bool { upload != nil || document?.hasFile == true }
    private var warnings: [String] { upload?.reading?.warnings ?? [] }
    private var fileText: String {
        if upload != nil {
            return "Nowy plik: " + (fileNames.count > 1 ? "PDF z \(fileNames.count) zdjęć" : fileNames.first ?? "dokument")
        }
        return document?.hasFile == true ? "Dokument ma zapisany plik." : "Dodaj zdjęcie paragonu, zdjęcia stron albo PDF faktury."
    }
    private var eventSearchKey: String { picking ? draft.companyID + "|" + eventQuery : "" }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(document == nil ? "Dodaj zakup" : "Popraw zakup").font(.title2.bold())
                Text("Zdjęcie paragonu albo faktura — dane odczyta AI, sprawdź je przed zapisem.").font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            HStack(alignment: .top, spacing: 0) {
                form.frame(minWidth: 480, maxWidth: .infinity)
                Divider()
                eventPanel.frame(width: 400)
            }
            Divider()
            HStack(spacing: 10) {
                if let problem {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.callout)
                        .lineLimit(3).textSelection(.enabled)
                } else if !hasFile {
                    Label("Bez pliku zakupu nie da się wysłać w rozliczeniu miesiąca.", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(document == nil ? "Zapisz zakup" : "Zapisz zmiany") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(working != nil)
            }
            .padding(16)
        }
        .frame(width: 1000, height: 740)
        .overlay { if let working { PendingOverlay(text: working) } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await choose(urls) }
            case .failure(let error): problem = error.localizedDescription
            }
        }
        .task {
            guard !prepared else { return }
            prepared = true
            draft = document.map { PurchaseDraft(document: $0) } ?? PurchaseDraft(company: store.access.recordCompanies.first?.id ?? "")
            if let event = document?.event { eventName = (event.name ?? "Event") + " · " + PurchaseFormat.day(event.date) }
        }
        .task(id: eventSearchKey) { await searchEvents() }
        .task(id: draft.eventID) { await loadCosts() }
        .onDisappear {
            if !finished, let upload { store.discard(upload.file.path) }
        }
    }

    // MARK: Plik i dane dokumentu
    private var form: some View {
        Form {
            Section("Plik dokumentu") {
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: hasFile ? "doc.text.fill" : "doc.badge.plus").font(.title2).foregroundStyle(theme.accent)
                    Text(fileText).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    if let document, document.hasFile, upload == nil {
                        Button("Podgląd") { Task { await store.openFile(document) } }
                    }
                    Button(hasFile ? "Zamień plik" : "Dodaj plik") { importing = true }.disabled(working != nil)
                }
                .dropDestination(for: URL.self) { urls, _ in
                    let files = urls.filter(\.isFileURL)
                    guard !files.isEmpty, working == nil else { return false }
                    Task { await choose(files) }
                    return true
                }
                Text("Kilka zdjęć to strony jednego dokumentu (do \(PurchaseLimits.maxPages)). Każdy paragon dodaj osobno. Pliki możesz też przeciągnąć tutaj z Findera.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let error = upload?.readingError {
                    Text(error).font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                }
                ForEach(warnings, id: \.self) { warning in
                    Label(warning, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                        .fixedSize(horizontal: false, vertical: true)
                }
                if document != nil, let reading = upload?.reading {
                    Button { draft = draft.with(reading) } label: { Label("Wstaw odczytane dane", systemImage: "sparkles") }
                }
            }
            Section("Dokument") {
                if companies.count > 1 {
                    Picker("Działalność", selection: $draft.companyID) {
                        ForEach(companies) { company in Text(company.name).tag(company.id) }
                    }
                    .disabled(!draft.eventID.isEmpty)
                    .help(draft.eventID.isEmpty ? "Działalność, której dotyczy zakup" : "Najpierw usuń event — event należy do działalności.")
                }
                Picker("Rodzaj dokumentu", selection: $draft.kind) {
                    ForEach(PurchaseKind.allCases) { kind in Text(kind.label).tag(kind) }
                }
                TextField("Sprzedawca", text: limited(\.sellerName, 200), prompt: Text("np. Leroy Merlin"))
                TextField("NIP sprzedawcy", text: limited(\.sellerNip, 30), prompt: Text("z nagłówka paragonu"))
                TextField(draft.kind == .invoice ? "Numer faktury" : "Numer paragonu / dokumentu", text: limited(\.number, 120))
                DatePicker("Data zakupu", selection: dateBinding, in: ...Date(), displayedComponents: .date)
                    .environment(\.timeZone, PurchaseFormat.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                TextField("Co kupiono", text: limited(\.label, 200), prompt: Text("np. gadżety na wesele, taśmy, baterie"))
            }
            Section("Kwota i zapłata") {
                TextField("Kwota brutto", text: $draft.gross)
                TextField("Kwota netto", text: $draft.net, prompt: Text("jeśli podana na dokumencie"))
                TextField("Waluta", text: Binding(get: { draft.currency }, set: { draft.currency = String($0.uppercased().prefix(3)) }))
                Picker("Zapłacono", selection: $draft.method) {
                    ForEach(PurchaseMethod.allCases) { method in Text(method.label).tag(method) }
                }
                Picker("Kategoria kosztów", selection: $draft.categoryID) {
                    Text("Bez kategorii (ustali księgowość)").tag("")
                    ForEach(store.categories.finance) { category in Text(category.name).tag(category.id) }
                }
                TextField("Uwagi", text: limited(\.notes, 2000), axis: .vertical).lineLimit(2...5)
            }
        }
        .formStyle(.grouped)
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { PurchaseFormat.date(draft.date) ?? Date() }, set: { draft.date = PurchaseFormat.dayString($0) })
    }

    /// Pole tekstowe z limitem długości (jak `maxLength` w CRM).
    private func limited(_ key: WritableKeyPath<PurchaseDraft, String>, _ limit: Int) -> Binding<String> {
        Binding(get: { draft[keyPath: key] }, set: { draft[keyPath: key] = String($0.prefix(limit)) })
    }

    // MARK: Koszt eventu
    private var eventPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Koszt eventu").font(.title3).textCase(.uppercase)
                    Spacer()
                    if !draft.eventID.isEmpty {
                        Button { clearEvent() } label: { Label("Bez eventu", systemImage: "xmark") }.controlSize(.small)
                    }
                }
                if !draft.eventID.isEmpty {
                    chosenEvent
                } else if picking {
                    eventPicker
                } else {
                    Text("Zakup dla konkretnego eventu (np. gadżety na wesele) dopisz do jego kosztów — zobaczysz wszystkie koszty tego eventu.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button { picking = true } label: { Label("Przypisz do eventu", systemImage: "calendar") }.disabled(draft.companyID.isEmpty)
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder private var chosenEvent: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "calendar").foregroundStyle(theme.accent)
            Text(eventName.isEmpty ? (costs?.event.name ?? "Event") : eventName).font(.headline.weight(.regular))
        }
        if draft.currency.uppercased() != "PLN" {
            Text("Do eventu można przypisać zakup w PLN.").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
        }
        if let costs, !costs.settlementOpen {
            Text("Podsumowanie tego eventu jest już wysłane albo zatwierdzone — koszt dopisze osoba z finansów.")
                .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).fixedSize(horizontal: false, vertical: true)
        }
        VStack(alignment: .leading, spacing: 4) {
            LabeledContent("Kwota dla eventu (brutto)") {
                TextField("Kwota dla eventu", text: $draft.eventAmount, prompt: Text("cały dokument")).labelsHidden()
                    .textFieldStyle(.roundedBorder).frame(width: 130)
            }
            Text(grossHint).font(.caption).foregroundStyle(.secondary)
        }
        Picker("Kategoria kosztu", selection: $draft.eventCategoryID) {
            Text("Bez kategorii").tag("")
            ForEach(store.categories.event) { category in Text(category.name).tag(category.id) }
        }
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                Text(costsTitle)
                    .font(.caption).foregroundStyle(.secondary).textCase(.uppercase)
                if let costs {
                    if costs.costs.isEmpty {
                        Text("Ten event nie ma jeszcze kosztów.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        ForEach(costs.costs) { cost in costRow(cost) }
                    }
                } else {
                    HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Wczytywanie…").font(.caption).foregroundStyle(.secondary) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        }
    }

    private var costsTitle: String {
        guard let costs else { return "Koszty tego eventu" }
        return "Koszty tego eventu · razem " + PurchaseFormat.money(costs.total)
    }

    private var grossHint: String {
        if let gross = PurchaseFormat.number(draft.gross), gross > 0 { return "Puste — cały dokument (\(PurchaseFormat.money(gross)))." }
        return "Puste — cały dokument."
    }

    private func costRow(_ cost: PurchaseEventCost) -> some View {
        let details = [PurchaseFormat.day(cost.date), cost.categoryName ?? "", cost.createdByName ?? "", PurchaseCostStatus.label(cost.status) ?? ""]
            .filter { !$0.isEmpty && $0 != "—" }.joined(separator: " · ")
        return HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(cost.name ?? "Koszt").lineLimit(1).help(cost.document ?? cost.name ?? "")
                if !details.isEmpty { Text(details).font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            Text(PurchaseFormat.money(cost.amount, cost.currency)).monospacedDigit()
                .foregroundStyle(cost.mine == true ? theme.accent : Color.primary)
        }
        .font(.caption)
    }

    @ViewBuilder private var eventPicker: some View {
        TextField("Szukaj eventu", text: $eventQuery, prompt: Text("Szukaj eventu po nazwie…")).textFieldStyle(.roundedBorder).labelsHidden()
        if eventLoading && eventOptions == nil {
            HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Wczytywanie eventów…").font(.caption).foregroundStyle(.secondary) }
        } else if (eventOptions ?? []).isEmpty {
            Text(eventQuery.isEmpty ? "Brak eventów w najbliższym czasie — wyszukaj po nazwie." : "Nie znaleziono eventu.")
                .font(.caption).foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(eventOptions ?? []) { event in
                    Button { pick(event) } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(event.name ?? "Event")
                            Text([PurchaseFormat.day(event.date), event.location ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        Button("Anuluj wybór") { picking = false }
    }

    // MARK: Czynności
    private func pick(_ event: PurchaseEventOption) {
        let financeName = store.categories.finance.first(where: { $0.id == draft.categoryID })?.name
        if draft.eventCategoryID.isEmpty {
            draft.eventCategoryID = PurchaseDraft.eventCategory(for: financeName, in: store.categories.event)
        }
        draft.eventAmount = ""
        costs = nil
        draft.eventID = event.id
        eventName = (event.name ?? "Event") + " · " + PurchaseFormat.day(event.date)
        picking = false
    }

    private func clearEvent() {
        draft.eventID = ""
        draft.eventAmount = ""
        draft.eventCategoryID = ""
        eventName = ""
        costs = nil
    }

    /// Eventy do wyboru: najbliższe dziś, z wyszukiwaniem (z krótkim opóźnieniem przy pisaniu).
    private func searchEvents() async {
        guard picking, !draft.companyID.isEmpty else { return }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        eventLoading = true
        defer { eventLoading = false }
        do {
            let options = try await store.events(company: draft.companyID, query: eventQuery.purchaseTrimmed)
            if !Task.isCancelled { eventOptions = options }
        } catch {
            guard !Task.isCancelled else { return }
            eventOptions = []
            problem = store.failureText(error, "Nie udało się wczytać eventów.")
        }
    }

    private func loadCosts() async {
        let event = draft.eventID
        guard !event.isEmpty else { costs = nil; return }
        do {
            let data = try await store.costs(event: event)
            if draft.eventID == event { costs = data }
        } catch {
            guard !Task.isCancelled else { return }
            problem = store.failureText(error, "Nie udało się wczytać kosztów eventu.")
        }
    }

    /// Plik dokumentu: zapis na serwerze i odczyt AI; poprzedni (niezapisany) plik znika z serwera.
    private func choose(_ urls: [URL]) async {
        guard !urls.isEmpty else { return }
        guard urls.count <= PurchaseLimits.maxPages else { problem = "Dokument może mieć najwyżej \(PurchaseLimits.maxPages) stron."; return }
        guard !draft.companyID.isEmpty else { problem = "Najpierw wybierz działalność."; return }
        guard store.workspace?.canWrite == true else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        problem = nil
        working = urls.count > 1 ? "Składanie \(urls.count) stron i odczytywanie dokumentu…" : "Zapisywanie pliku i odczytywanie dokumentu…"
        defer { working = nil }
        do {
            let previous = upload
            let result = try await store.upload(company: draft.companyID, files: urls)
            if let previous { store.discard(previous.file.path) }
            upload = result
            fileNames = urls.map(\.lastPathComponent)
            if document == nil { draft = draft.with(result.reading) }
            if result.reading != nil {
                store.workspace?.succeed(document != nil ? "Plik dodany. Odczyt AI możesz wstawić do formularza." : "Dokument odczytany — sprawdź dane przed zapisem.")
            } else {
                store.workspace?.notice = result.readingError ?? "Plik dodany — uzupełnij dane ręcznie."
            }
        } catch {
            problem = store.failureText(error, "Nie udało się dodać pliku.")
        }
    }

    private func save() async {
        let errors = draft.errors(today: PurchaseFormat.today())
        guard errors.isEmpty else { problem = errors.joined(separator: " "); return }
        guard store.workspace?.canWrite == true else { problem = "Zapis wymaga połączenia z serwerem CRM."; return }
        problem = nil
        working = "Zapisywanie zakupu…"
        defer { working = nil }
        do {
            let result = try await store.save(id: document?.id, data: draft.payload(filePath: upload?.file.path))
            finished = true
            dismiss()
            saved(result, document == nil)
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać zakupu.")
        }
    }
}
