import SwiftUI

// MARK: Przekazanie księgowej (jak „Dla księgowej” w CRM, `SaldeoDeliveryPanel`) — zamiast jednej długiej strony: u góry
// działalność i miesiąc, z lewej kafle i trzy listy (dokumenty spoza KSeF, płatności zbiorcze, braki i „Do dosłania”), z prawej
// kontrola pakietu i wysyłka krok po kroku. Szczegóły pozycji (z poprawą istniejącego opisu i podglądem pliku) — w oknie.

private struct SaldeoTarget: Identifiable { let key: String; var id: String { key } }

private struct SaldeoNote: View {
    let text: String
    var color: Color = CrmTheme.rgb(0x4ade80)
    var symbol = "checkmark.circle.fill"
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol)
            Text(text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.callout)
        .foregroundStyle(color)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
    }
}

@MainActor struct FinanceAccountantView: View {
    @ObservedObject var store: FinanceSaldeoStore
    @ObservedObject var finance: FinanceStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var list = "documents"
    @State private var details: SaldeoTarget?
    @State private var confirmSend = false
    @State private var removing: SaldeoMonth.Followup?
    @State private var showHelp = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if store.setup == nil {
                if let error = store.setupError {
                    ContentUnavailableView {
                        Label("Nie udało się wczytać ustawień", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadSetup(force: true) } } }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView("Ładowanie ustawień przekazania…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else if store.companies.isEmpty {
                ContentUnavailableView("Brak działalności", systemImage: "building.2",
                                       description: Text("Wybrane w filtrze działalności nie mają danych do przekazania księgowej."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                header
                Divider()
                if let data = store.data, data.companyId == store.companyID, data.month == store.month, data.year == store.year {
                    HStack(spacing: 0) {
                        lists(data)
                        Divider()
                        ScrollView { inspector(data).padding(16) }
                            .frame(width: 380)
                            .background(Color.primary.opacity(0.02))
                    }
                } else if let error = store.loadError {
                    ContentUnavailableView {
                        Label("Nie można odczytać danych miesiąca", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.load() } } }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView("Pobieram aktualne dokumenty, opisy i powiązania…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .task { await store.loadSetup() }
        .onChange(of: finance.scopeCompanies.map(\.id)) { store.ensureCompany() }
        .task(id: store.loadKey) { await store.load(resetMessages: false) }
        .task(id: store.companyID) { await store.checkPin() }
        .sheet(item: $details) { target in FinSaldeoDetailsSheet(store: store, key: target.key) }
        .confirmationDialog("Wysłać sprawdzony pakiet?", isPresented: $confirmSend, titleVisibility: .visible) {
            Button("Wyślij pakiet") { Task { await store.send() } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text(sendSummary) }
        .confirmationDialog("Usunąć pozycję z listy „Do dosłania”?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń z listy", role: .destructive) {
                if let item = removing { Task { await store.setFollowup(bankId: item.bankId, acknowledged: false, expected: nil) } }
                removing = nil
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: { Text("Usuwa pozycję z wewnętrznej listy „Do dosłania”. Nie zmieni to dopasowania ani statusu płatności.") }
    }

    private var sendSummary: String {
        guard let review = store.review else { return "" }
        let saldeo = review.prepared.count
        let accountant = review.accountant.count
        let documents = SaldeoText.plural(saldeo, "dokument", "dokumenty", "dokumentów")
        let files = SaldeoText.plural(accountant, "załącznik", "załączniki", "załączników")
        let skipped = review.reportAlreadySent ? " — identyczny raport był już wysłany i zostanie pominięty" : ""
        return "Do Saldeo (\(review.saldeoEmail)): \(saldeo) \(documents) spoza KSeF. Do księgowej (\(review.accountantEmail)): \(accountant) \(files)\(skipped). Wysyłamy dokładnie sprawdzone pliki z kontroli \(String(review.revision.prefix(8)))."
    }

    // MARK: Nagłówek
    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                if store.companies.count > 1 {
                    Picker("", selection: Binding(get: { store.companyID ?? "" }, set: { store.select($0) })) {
                        ForEach(store.companies) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden().fixedSize()
                } else if let company = store.company {
                    Text(company.name).font(.headline)
                }
                HStack(spacing: 2) {
                    Button { store.step(-1) } label: { Image(systemName: "chevron.left") }.help("Poprzedni miesiąc")
                    Menu {
                        ForEach(1...12, id: \.self) { value in
                            Button(SaldeoText.months[value - 1]) { store.setPeriod(month: value, year: store.year) }
                        }
                        Divider()
                        ForEach((store.year - 2)...(store.year + 1), id: \.self) { value in
                            Button("Rok \(String(value))") { store.setPeriod(month: store.month, year: value) }
                        }
                    } label: {
                        Text("\(SaldeoText.months[store.month - 1]) \(String(store.year))").monospacedDigit()
                    }
                    .fixedSize()
                    Button { store.step(1) } label: { Image(systemName: "chevron.right") }.help("Następny miesiąc")
                }
                Spacer()
                Button { Task { await store.load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
                    .help("Pobierz aktualne dokumenty, opisy i powiązania (unieważnia przygotowaną kontrolę)")
                Button { showHelp = true } label: { Image(systemName: "questionmark.circle") }
                    .buttonStyle(.borderless).help("Co trafia do księgowej")
                    .popover(isPresented: $showHelp, arrowEdge: .bottom) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Gotowa paczka miesiąca — tylko to, czego potrzebuje księgowa").font(.headline)
                            Text("Do Saldeo: wyłącznie dokumenty spoza KSeF. Do księgowej: oryginalne wyciągi oraz opisy płatności zbiorczych, gdy jeden przelew pokrywa kilka faktur. Zwykłych dopasowań, podatków, płac ani wewnętrznych list braków nie wysyłamy jako dodatkowych raportów.")
                            Text("Sprawdź plik kontrolny, potem zapisz paczkę albo wyślij ją jednym przyciskiem. Nic nie wysyła się automatycznie. E-mail nie tworzy rozrachunków ani nie potwierdza odbioru w Saldeo.")
                            Text("Niezakończone wewnętrzne dopasowania nie blokują wysyłki gotowych dokumentów i nie oznaczają zakończenia rozliczenia miesiąca.").foregroundStyle(.secondary)
                        }
                        .font(.callout).fixedSize(horizontal: false, vertical: true)
                        .padding(14).frame(width: 420, alignment: .leading)
                    }
            }
            .controlSize(.small)
            .disabled(store.busy)
            Text("Do Saldeo trafiają wyłącznie dokumenty spoza KSeF; do księgowej — oryginalne wyciągi i opisy płatności zbiorczych. Nic nie wysyła się automatycznie.")
                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    // MARK: Listy
    private func lists(_ data: SaldeoMonth) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                FinTile(symbol: "paperplane", label: "Nowe pliki do Saldeo", value: "\(data.counts.pending)", hint: "\(data.counts.sent) wysłanych wcześniej — bez ponownej wysyłki")
                FinTile(symbol: "building.columns", label: "Oryginalne wyciągi", value: "\(data.counts.statements)", hint: "Załączniki dla księgowej", warn: data.counts.statements == 0)
                FinTile(symbol: "square.stack.3d.up", label: "Płatności zbiorcze", value: "\(data.counts.collective)", hint: "Tylko te płatności wymagają opisu podziału")
                FinTile(symbol: "doc.badge.arrow.up", label: "KSeF — pomijamy", value: "\(data.counts.ksef)", hint: "Bez ponownej wysyłki faktur i kopii CRM")
            }
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
            Picker("", selection: $list) {
                Text("Dokumenty spoza KSeF (\(data.documents.count))").tag("documents")
                Text("Płatności zbiorcze (\(data.collective.count))").tag("collective")
                Text("Braki i do dosłania (\(data.unlinked.count + data.followups.count))").tag("missing")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            .padding(.horizontal, 16).padding(.bottom, 8)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    switch list {
                    case "collective": collective(data)
                    case "missing": missing(data)
                    default: documents(data)
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .disabled(store.busy)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder private func documents(_ data: SaldeoMonth) -> some View {
        Text("To jedyna lista dokumentów przekazywanych do Saldeo. Zapisane powiązania są widoczne do kontroli; zwykłe przelewy nie otrzymują dodatkowych opisów. Istniejący opis niepowiązanego dokumentu możesz poprawić.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if data.documents.isEmpty {
            SaldeoNote(text: "Brak dokumentów spoza KSeF do przekazania w tym okresie.")
        }
        ForEach(data.documents) { item in documentRow(item, data: data) }
        if data.counts.excluded > 0 {
            Text("Pominięto \(data.counts.excluded) proform, dokumentów roboczych lub anulowanych.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func documentRow(_ item: SaldeoMonth.Doc, data: SaldeoMonth) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "doc.text").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(item.number).fontWeight(.medium).textSelection(.enabled)
                        Text("· źródło: \(item.sourceLabel)").font(.caption).foregroundStyle(.secondary)
                    }
                    Text([item.counterparty, FinFormat.day(item.date), item.amount.map { FinFormat.money($0, item.currency) } ?? ""].filter { !$0.isEmpty && $0 != "—" }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                switch item.state {
                case "sent": BankChip(text: "E-mail wysłany", color: CrmTheme.rgb(0x4ade80)).help(item.sentAt.map { "Wysłano \(FinFormat.dateTime($0)); odbiór w Saldeo niepotwierdzony" } ?? "")
                case "saldeo": BankChip(text: "Do Saldeo", color: theme.accent)
                default: BankChip(text: "W raporcie", color: Color.secondary)
                }
            }
            if item.hasLink {
                Text("Powiązana z płatnością — bez edycji opisu").font(.caption).foregroundStyle(CrmTheme.rgb(0x86efac))
                ForEach(item.links) { link in
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(FinFormat.day(link.date)) · przelew \(FinFormat.money(link.amount, link.currency))\(link.assigned > 0 ? " · do tej faktury \(FinFormat.money(link.assigned, link.currency))" : "")")
                        Text("Nr płatności: \(link.reference.isEmpty ? "nie zapisano" : link.reference)").foregroundStyle(.secondary).textSelection(.enabled)
                        if !link.group.isEmpty {
                            Text("Jedna płatność za \(link.group.count) dokumentów: \(link.group.joined(separator: ", "))").foregroundStyle(theme.accent)
                        }
                    }
                    .font(.caption)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(CrmTheme.rgb(0x4ade80).opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
                }
            } else if !item.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Opisana w analizie — bez powiązanej płatności").font(.caption).foregroundStyle(CrmTheme.rgb(0x86efac))
                Text(item.note).font(.caption).lineLimit(3).textSelection(.enabled)
            } else {
                Text("Bez powiązanej płatności i bez opisu w analizie. Jeżeli pozycja wymaga wyjaśnienia, uzupełnij je w analizie.")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Button { details = SaldeoTarget(key: item.key) } label: { Label("Zobacz więcej", systemImage: "eye") }
                if item.editable && !item.hasLink && data.canManage {
                    Button { details = SaldeoTarget(key: item.key) } label: { Label("Edytuj istniejący opis", systemImage: "pencil") }
                }
                if !item.hasLink && item.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button("Przejdź do analizy") { finance.part = .reconciliation }
                }
            }
            .controlSize(.small)
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private func collective(_ data: SaldeoMonth) -> some View {
        Text("Jedna płatność — kilka faktur. Księgowa otrzyma numer przelewu, datę, kwotę oraz podział między dokumenty, także faktury KSeF bez ponownego wysyłania ich plików.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if data.collective.isEmpty {
            Text("Brak zapisanych płatności za kilka faktur. Nie dołączymy pustego raportu.").font(.callout).foregroundStyle(.secondary)
        }
        ForEach(data.collective) { payment in
            VStack(alignment: .leading, spacing: 4) {
                Text("\(FinFormat.day(payment.date)) · \(FinFormat.money(payment.amount, payment.currency)) · \(payment.counterparty)").fontWeight(.medium)
                Text("Nr płatności: \(payment.reference.isEmpty ? "nie zapisano" : payment.reference)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                if !payment.statementName.isEmpty { Text(payment.statementName).font(.caption).foregroundStyle(.secondary) }
                ForEach(Array(payment.documents.enumerated()), id: \.offset) { _, document in
                    Text("\(document.number) · \(document.counterparty) — \(document.allocated.map { FinFormat.money($0, payment.currency) } ?? "Brak zapisanej kwoty")")
                        .font(.caption).foregroundStyle(theme.accent)
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    @ViewBuilder private func missing(_ data: SaldeoMonth) -> some View {
        Text("Tylko w CRM — to operacje z wyciągu, nie faktury do wysłania. Przy wydatku możesz świadomie pozostawić brak dokumentu do uzupełnienia i przekazać pozostałe dokumenty. Opisy pochodzą z analizy; VAT, ZUS i PIT pozostają tylko na wyciągach.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        ForEach(data.warnings, id: \.self) { warning in FinBanner(text: warning) }
        if data.counts.statementOnly > 0 {
            SaldeoNote(text: "Tylko na wyciągach i w rejestrze: \(data.counts.statementOnly) operacji VAT / ZUS / PIT. Nie trafiają do brakujących dokumentów ani jako osobne pliki do Saldeo. Ich opisy i dane pozostają w analizie CRM.",
                       color: CrmTheme.rgb(0x93c5fd), symbol: "info.circle.fill")
        }
        Text("Płatności bez powiązanego dokumentu (\(data.unlinked.count))").font(.headline).padding(.top, 4)
        if data.unlinked.isEmpty {
            SaldeoNote(text: "Brak pozostałych płatności bez powiązanego dokumentu.")
        }
        ForEach(data.unlinked) { bank in unlinkedRow(bank, data: data) }
        HStack {
            Text("Dokumenty do dosłania — \(SaldeoText.months[store.month - 1].lowercased()) \(String(store.year)) (\(data.followups.count))").font(.headline)
            Spacer()
            Button { Task { await store.exportCsv("followups") } } label: { Label("Pobierz listę", systemImage: "arrow.down.doc") }
                .controlSize(.small).disabled(data.followups.isEmpty)
        }
        .padding(.top, 8)
        Text("Lista zapisuje się w CRM i pozostaje po wysłaniu paczki. Po znalezieniu dokumentu dopasuj go w uzgodnieniu i uwzględnij w kolejnym przekazaniu. Samo dopasowanie nie usuwa pozycji ani nie oznacza jej wysłania.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if data.followups.isEmpty {
            Text("Nie zaznaczono dokumentów do późniejszego dosłania.").font(.callout).foregroundStyle(.secondary)
        }
        ForEach(data.followups) { item in
            VStack(alignment: .leading, spacing: 4) {
                Text("\(FinFormat.day(item.date)) · \(FinFormat.money(item.amount, item.currency)) · \(item.counterparty.isEmpty ? "Brak nazwy kontrahenta" : item.counterparty)").fontWeight(.medium)
                Text("Nr płatności: \(item.reference.isEmpty ? "nie zapisano" : item.reference)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                Text(item.status).font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).fixedSize(horizontal: false, vertical: true)
                if !item.note.isEmpty { Text(item.note).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                Text("Potwierdzono: \(FinFormat.dateTime(item.acknowledgedAt))").font(.caption2).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Button("Przejdź do analizy") { finance.part = .reconciliation }
                    if data.canManage { Button("Usuń z listy") { removing = item }.disabled(store.followupSaving != nil) }
                }
                .controlSize(.small)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func unlinkedRow(_ bank: SaldeoMonth.Unlinked, data: SaldeoMonth) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(FinFormat.day(bank.bookedDate ?? bank.date)) · \(bank.credit ? "Wpływ" : "Wydatek") \(FinFormat.money(bank.amount, bank.currency))").fontWeight(.medium)
            if let note = bank.dateNote {
                Label(note, systemImage: "calendar.badge.clock").font(.caption).foregroundStyle(CrmTheme.rgb(0x7dd3fc))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("\(bank.counterparty.isEmpty ? "Brak nazwy kontrahenta" : bank.counterparty) · \(bank.status)").font(.caption).foregroundStyle(.secondary)
            Text("Nr płatności: \(bank.reference.isEmpty ? "nie zapisano" : bank.reference)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            if bank.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Brak opisu w analizie — wróć do analizy, aby go uzupełnić.").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
            } else {
                Text("Opis z analizy: \(bank.note)").font(.caption).lineLimit(3).textSelection(.enabled)
            }
            if bank.canAcknowledge {
                VStack(alignment: .leading, spacing: 4) {
                    Toggle(isOn: Binding(get: { bank.acknowledged }, set: { value in
                        Task { await store.setFollowup(bankId: bank.id, acknowledged: value, expected: bank.expected) }
                    })) {
                        Text("Świadomie wysyłam pozostałe dokumenty — dokument do tego wydatku doślę później.").fixedSize(horizontal: false, vertical: true)
                    }
                    .toggleStyle(.checkbox)
                    .disabled(!data.canManage || store.followupSaving != nil)
                    if bank.staleAcknowledgment {
                        Text("Dane lub opis zmieniły się od potwierdzenia. Sprawdź je i zaznacz ponownie.").font(.caption)
                    }
                    Text("Zapis na liście „Do dosłania” nie zmienia dopasowania ani statusu rozliczenia.").font(.caption2).opacity(0.7)
                }
                .font(.caption).foregroundStyle(CrmTheme.rgb(0xfde68a))
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(CrmTheme.rgb(0xfbbf24).opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack(spacing: 8) {
                Button { details = SaldeoTarget(key: bank.key) } label: { Label("Zobacz płatność", systemImage: "eye") }
                if !bank.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    if data.canManage {
                        Button { details = SaldeoTarget(key: bank.key) } label: { Label("Edytuj opis z analizy", systemImage: "pencil") }
                    }
                } else {
                    Button("Przejdź do analizy") { finance.part = .reconciliation }
                }
            }
            .controlSize(.small)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Kontrola pakietu i wysyłka
    private func inspector(_ data: SaldeoMonth) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sprawdź pakiet przed wysyłką — \(SaldeoText.months[store.month - 1]) \(String(store.year))").font(.headline)
            VStack(alignment: .leading, spacing: 4) {
                Text("Konto nadawcze CRM").font(.caption).foregroundStyle(.secondary)
                Picker("", selection: $store.emailAccountID) {
                    Text("Wybierz konto").tag("")
                    ForEach(store.setup?.accounts ?? []) { Text($0.email).tag($0.id) }
                }
                .labelsHidden()
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Adres dokumentów Saldeo").font(.caption).foregroundStyle(.secondary)
                TextField("firma@dok.saldeo.pl", text: $store.saldeoEmail).textFieldStyle(.roundedBorder)
            }
            pinBox
            VStack(alignment: .leading, spacing: 4) {
                Text("E-mail księgowej").font(.caption).foregroundStyle(.secondary)
                TextField("ksiegowosc@biuro.pl", text: $store.accountantEmail).textFieldStyle(.roundedBorder)
            }
            if !data.blockers.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Popraw pliki lub dane wymagane w paczce", systemImage: "exclamationmark.triangle.fill").fontWeight(.medium)
                    ForEach(data.blockers, id: \.self) { Text("• \($0)").fixedSize(horizontal: false, vertical: true) }
                }
                .font(.caption).foregroundStyle(CrmTheme.rgb(0xfdba74))
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(CrmTheme.rgb(0xf97316).opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
            } else {
                SaldeoNote(text: "Możesz przygotować paczkę dokumentów spoza KSeF oraz wyciągów.\(data.followups.isEmpty ? "" : " Lista „Do dosłania” (\(data.followups.count)) pozostaje wyłącznie w CRM.") Niewyjaśnione pozycje nie są automatycznie uznawane za rozliczone.")
            }
            Button { Task { await store.prepareReview() } } label: {
                Label(store.review == nil ? "1. Pobierz plik kontrolny" : "Przygotuj nowy plik kontrolny", systemImage: "arrow.down.doc")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .disabled(store.busy || store.loading || !store.isSaldeoAdmin)
            Text(store.isSaldeoAdmin
                 ? "Prywatny plik HTML: dokładny plan wysyłki, gotowe załączniki i osobno informacje wewnętrzne. Zapisuje się w Pobranych i otwiera w przeglądarce. Nie trafia do księgowej ani do paczki ZIP. Nie zawiera PIN-u."
                 : "Plik kontrolny i wysyłkę przygotowuje aktywny administrator CRM (automatyczna autoryzacja Saldeo).")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let review = store.review { reviewBox(review) }
            Button { store.saveBundle() } label: { Label("Zapisz sprawdzoną paczkę ZIP", systemImage: "archivebox").frame(maxWidth: .infinity) }
                .disabled(store.busy || !(store.review.map { store.reviewApproved && $0.blockers.isEmpty } ?? false))
            Text("ZIP zawiera oddzielne foldery „saldeo” i „ksiegowa”. Zapisanie nie wysyła plików i nie oznacza ich jako dostarczone. Nie przekazuj tej samej paczki ręcznie i ponownie przyciskiem wysyłki.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button { confirmSend = true } label: { Label("2. Wyślij sprawdzony pakiet", systemImage: "paperplane.fill").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(!canSend(data))
            Text("Wysyłamy dokładnie sprawdzone załączniki. Zmiana działalności, miesiąca, odbiorców, opisów, dopasowań lub potwierdzeń braków wymaga ponownej kontroli. Plik kontrolny służy tylko Tobie — nie jest wysyłany księgowej.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button { Task { await store.exportCsv("reconciliation") } } label: { Label("Pobierz rejestr transakcji CSV", systemImage: "tablecells").frame(maxWidth: .infinity) }
                .controlSize(.small).disabled(store.busy)
            if let handoff = data.latestHandoff {
                Text("Ostatnie przekazanie raportu: \(FinFormat.dateTime(handoff.deliveredAt)) → \(handoff.deliveredTo).").font(.caption).foregroundStyle(.secondary)
            }
            if let failure = store.failure {
                SaldeoNote(text: failure, color: CrmTheme.rgb(0xfca5a5), symbol: "xmark.octagon.fill").textSelection(.enabled)
            }
            if let outcome = store.outcome {
                SaldeoNote(text: outcome).textSelection(.enabled)
            }
        }
    }

    private func canSend(_ data: SaldeoMonth) -> Bool {
        guard let review = store.review, store.reviewApproved, review.blockers.isEmpty, data.blockers.isEmpty else { return false }
        if store.busy || store.loading || store.followupSaving != nil { return false }
        switch store.pin {
        case .checking, .failed: return false
        case .missing: return data.counts.pending == 0
        case .ready: return true
        }
    }

    private var pinBox: some View {
        let ready = store.pin == .ready
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if store.pin == .checking { ProgressView().controlSize(.mini) } else { Image(systemName: "checkmark.shield") }
                Text("Automatyczny PIN Saldeo").fontWeight(.medium)
            }
            Text(store.pin.message).fixedSize(horizontal: false, vertical: true)
            Text("PIN nie jest zwracany do aplikacji ani zapisywany w pliku kontrolnym. Zatwierdzenie paczki pozostaje wymagane.").foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("Sprawdź ponownie") { Task { await store.checkPin() } }.controlSize(.small).disabled(store.pin == .checking)
        }
        .font(.caption)
        .foregroundStyle(ready ? CrmTheme.rgb(0x86efac) : Color.primary)
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background((ready ? CrmTheme.rgb(0x4ade80) : Color.primary).opacity(ready ? 0.06 : 0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func reviewBox(_ review: SaldeoReview) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Kontrola z \(FinFormat.dateTime(review.createdAt)) · wersja \(String(review.revision.prefix(8)))").font(.caption)
            Text("\(review.prepared.count) \(SaldeoText.plural(review.prepared.count, "dokument", "dokumenty", "dokumentów")) do Saldeo · \(review.accountant.count) \(SaldeoText.plural(review.accountant.count, "załącznik", "załączniki", "załączników")) dla księgowej")
                .font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Button { store.openControlFile() } label: { Label("Otwórz plik kontrolny", systemImage: "safari") }
                Button { store.revealControlFile() } label: { Image(systemName: "folder") }.help("Pokaż plik kontrolny w Finderze")
            }
            .controlSize(.small)
            if !review.blockers.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Wysyłka zablokowana — popraw poniższe pozycje i przygotuj nową kontrolę:")
                    ForEach(review.blockers, id: \.self) { Text("• \($0)").fixedSize(horizontal: false, vertical: true) }
                }
                .font(.caption).foregroundStyle(CrmTheme.rgb(0xfdba74))
            } else {
                Toggle(isOn: $store.reviewApproved) {
                    Text("Sprawdziłem odbiorców, dokumenty spoza KSeF, wyciągi i opisy płatności zbiorczych. Akceptuję tę paczkę. Wewnętrzne braki pozostają do uzupełnienia w CRM.")
                        .font(.caption).fixedSize(horizontal: false, vertical: true)
                }
                .toggleStyle(.checkbox)
            }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Szczegóły pozycji (jak `SaldeoDocumentDetailsModal`)

@MainActor private struct FinSaldeoDetailsSheet: View {
    @ObservedObject var store: FinanceSaldeoStore
    let key: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var details: SaldeoDetails?
    @State private var loadError: String?
    @State private var draft = ""
    @State private var saving = false
    @State private var noteError: String?
    @State private var preview: BankPreviewItem?
    @State private var confirmClose = false

    private var dirty: Bool {
        guard let original = details?.origin?.original else { return false }
        return draft.trimmingCharacters(in: .whitespacesAndNewlines) != original.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var editable: Bool { (details.map { $0.canEditNote && !$0.hasPaymentLink && $0.canManage }) ?? false }

    var body: some View {
        BankSheetFrame(details.map { $0.isPayment ? "Płatność — wewnętrzna analiza CRM" : "Dokument spoza KSeF — kontrola wysyłki" } ?? "Szczegóły pozycji",
                       symbol: details?.isPayment == true ? "building.columns" : "doc.text",
                       subtitle: details.map { "\($0.number) · źródło: \($0.sourceLabel)" }) {
            if let details {
                ScrollView { content(details).padding(18) }
            } else if let loadError {
                ContentUnavailableView("Nie można otworzyć szczegółów", systemImage: "exclamationmark.triangle", description: Text(loadError))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Pobieram aktualne dane pozycji…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } footer: {
            if dirty { Text("Zmiany w opisie nie są zapisane.").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
            Spacer()
            Button(editable && dirty ? "Anuluj / zamknij" : "Zamknij", role: .cancel) { if dirty { confirmClose = true } else { dismiss() } }
                .keyboardShortcut(.cancelAction).disabled(saving)
            if editable {
                Button(saving ? "Zapisuję…" : "Zapisz opis z analizy") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!dirty || saving)
            }
        }
        .frame(minWidth: 720, idealWidth: 820, minHeight: 560, idealHeight: 720)
        .interactiveDismissDisabled(dirty || saving)
        .task { await load() }
        .sheet(item: $preview) { item in
            if let bank = store.finance?.bank { BankPreviewSheet(item: item, store: bank) }
        }
        .confirmationDialog("Opis ma niezapisane zmiany. Zamknąć okno i je porzucić?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Porzuć zmiany", role: .destructive) { dismiss() }
            Button("Wróć do edycji", role: .cancel) {}
        }
    }

    private func load() async {
        do {
            let fresh = try await store.details(key)
            details = fresh
            draft = fresh.origin?.original ?? ""
            loadError = nil
        } catch {
            loadError = store.failureText(error, "Nie można otworzyć szczegółów.")
        }
    }

    private func save() async {
        guard let details, dirty, !saving else { return }
        let note = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !note.isEmpty else { noteError = "Tutaj można tylko poprawić istniejący opis. Nie można dodać nowego ani usunąć wyjaśnienia z analizy."; return }
        guard note.count <= 20000 else { noteError = "Opis może mieć maksymalnie 20 000 znaków. Skróć go przed zapisem."; return }
        saving = true
        noteError = nil
        let error = await store.saveNote(details, note: note)
        saving = false
        if let error {
            noteError = error
        } else {
            await load()
        }
    }

    private func field(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.isEmpty ? "Nie zapisano" : value).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func day(_ value: String) -> String { value.isEmpty ? "Nie zapisano" : FinFormat.day(value) }

    @ViewBuilder private func content(_ item: SaldeoDetails) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                Label(item.disposition, systemImage: "doc.text").font(.callout).foregroundStyle(theme.accent)
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                    GridRow {
                        field(item.isPayment ? "Rodzaj płatności" : "Rodzaj dokumentu", item.kind)
                        field(item.isPayment ? "Nadawca / odbiorca" : "Kontrahent", item.counterparty)
                        field(item.isPayment ? "Pełna kwota przelewu" : "Kwota dokumentu", SaldeoText.money(item.amount, item.currency))
                    }
                    GridRow {
                        field(item.isPayment ? "Data płatności" : "Data dokumentu", day(item.date))
                        if item.isPayment { field("Źródło", item.sourceLabel) } else { field("Termin płatności", day(item.dueDate)) }
                        if item.isPayment { Color.clear.frame(height: 1) } else { field("Źródło", item.sourceLabel) }
                    }
                }
                if !item.ksefReference.isEmpty { field("Numer KSeF", item.ksefReference) }
            }
            .padding(14).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))

            if !item.hasPaymentLink {
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.isPayment ? "Wewnętrzny opis płatności" : "Istniejący opis dokumentu").font(.headline)
                    if editable {
                        Text("\(item.isPayment ? "Ten opis pozostaje w CRM, poza paczką dla księgowej." : "Opis niepowiązanego dokumentu zostanie dołączony do jego kopii dla Saldeo.") Edytujesz zapis z analizy. Zmiana unieważni wcześniejszą kontrolę paczki.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        TextEditor(text: $draft)
                            .font(.body).frame(minHeight: 110)
                            .scrollContentBackground(.hidden)
                            .padding(6).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                            .disabled(saving)
                        if dirty {
                            Text("Zmiany w opisie nie są zapisane. Do wysyłki nadal obowiązuje poprzedni opis.").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                        }
                    } else if !item.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(item.note).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    } else if !item.relatedNotes.contains(where: { !$0.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                        Text("Brak dodatkowego opisu. Nie blokuje to wysyłki dokumentu. Jeśli potrzebne jest wyjaśnienie, uzupełnij je w analizie CRM.")
                            .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    if let noteError {
                        Text(noteError).font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }

            if !item.hasPaymentLink && !item.relatedNotes.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Pozostałe opisy źródłowe z analizy").font(.headline)
                    Text("Te informacje pozostają zachowane i nie są zastępowane edycją powyżej.").font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(item.relatedNotes.enumerated()), id: \.offset) { _, note in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(note.label).font(.caption).foregroundStyle(.secondary)
                            Text(note.note).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(item.isPayment ? "Przelew i przypisane dokumenty" : "Powiązane płatności (\(item.payments.count))").font(.headline)
                Text("Powiązania służą do kontroli w CRM. Do księgowej trafia osobny opis tylko wtedy, gdy jedna płatność rozlicza kilka faktur; zwykłych dopasowań nie opisujemy ponownie.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if item.payments.isEmpty {
                    Text(item.isPayment ? "Szczegóły przelewu nie są dostępne." : "Brak zapisanego powiązania z przelewem. Sam status „opłacona” nie wskazuje płatności bankowej.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                ForEach(item.payments) { payment in paymentCard(payment, item: item) }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(item.isPayment ? "Wyciąg źródłowy" : "Plik źródłowy").font(.headline)
                    Spacer()
                    Button { Task { preview = await store.preview(item.key) } } label: { Label("Podgląd pliku", systemImage: "eye") }
                        .disabled(!item.hasPreview || saving)
                }
                if let missing = item.previewMissing {
                    Text(missing).font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("To oryginalny plik. Zapisany opis i informacje o płatnościach sprawdzisz w nowym pliku kontrolnym wysyłki.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func paymentCard(_ payment: SaldeoDetails.Payment, item: SaldeoDetails) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(payment.direction) · \(day(payment.date))").fontWeight(.semibold)
                Spacer()
                if payment.collective { BankChip(text: "Płatność zbiorcza — kilka dokumentów", color: theme.accent) }
            }
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    field("Pełna kwota przelewu", SaldeoText.money(payment.amount, payment.currency))
                    field(item.isPayment ? "Łącznie przypisane z przelewu" : "Przypisane z przelewu do tego dokumentu", SaldeoText.money(payment.allocatedAmount, payment.currency))
                    if item.isPayment { Color.clear.frame(height: 1) } else { field("Przypisane w walucie dokumentu", SaldeoText.money(payment.documentAmount, payment.documentCurrency)) }
                }
                GridRow {
                    field("Nadawca / odbiorca", payment.counterparty)
                    field("Data księgowania", day(payment.postingDate))
                    field("Numer płatności z wyciągu", payment.reference)
                }
            }
            field("Pełny tytuł przelewu", payment.title)
            field("Wyciąg źródłowy", payment.statementName)
            if !item.hasPaymentLink && !payment.note.isEmpty { field("Opis płatności zapisany w analizie", payment.note) }
            if !item.isPayment && payment.currency != payment.documentCurrency {
                Text("Różne waluty. Kwota bankowa i kwota przypisana do dokumentu pokazują osobne strony rozliczenia.").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
            }
            if !payment.linkedDocuments.isEmpty {
                Text("Dokumenty rozliczone tym przelewem").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(Array(payment.linkedDocuments.enumerated()), id: \.offset) { _, linked in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(linked.number) · \(linked.counterparty.isEmpty ? "Kontrahent nie zapisany" : linked.counterparty)").fontWeight(.medium)
                        HStack(alignment: .top) {
                            field("Część przelewu przypisana do dokumentu", SaldeoText.money(linked.allocatedAmount, payment.currency))
                            field("Przypisane w walucie dokumentu", SaldeoText.money(linked.documentAmount, linked.currency))
                        }
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }
}
