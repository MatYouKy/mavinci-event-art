import SwiftUI

// MARK: Faktura z pro formy — 1:1 z `ConvertProformaModal`: cała pro forma jako faktura VAT (szkic) albo opłacona faktura
// zaliczkowa (100% pro formy, wpłata zapisana przy pro formie albo potwierdzona z rzeczywistą datą), numer automatyczny
// (podgląd następnego) albo własny, daty i termin płatności, poprawione dane nabywcy, odbiorca KSeF z pro formy (do
// poprawy), potem podgląd przed wystawieniem. Serwer: `/bridge/native/v1/finance` (`proformaSetup`, `proformaNumber`,
// `proformaConvert` — funkcja bazy `convert_proforma_with_payment_atomic`).

struct ProformaSetup: Decodable {
    struct Totals: Decodable { var net: Double; var vat: Double; var gross: Double }
    struct Seller: Decodable { var name: String; var nip: String }
    struct Buyer: Decodable, Equatable {
        var name: String; var nip: String; var email: String; var street: String; var postalCode: String; var city: String
    }
    struct Item: Decodable { var name: String; var unit: String; var quantity: Double; var priceNet: Double; var vatRate: Double; var gross: Double }
    var id: String
    var number: String
    var status: String
    var companyId: String
    var convertedTo: String
    var currency: String
    var totals: Totals
    var seller: Seller
    var buyer: Buyer
    var items: [Item]
    var manualPaidAmount: Double
    var paidDate: String
    var recipient: InvoiceRecipientDraft
    var recipientError: String?
}

@MainActor final class ProformaConvertModel: ObservableObject, InvoiceRecipientHost {
    let proformaID: String
    weak var workspace: Workspace?

    @Published var setup: ProformaSetup?
    @Published var loadError: String?
    @Published var loading = true
    @Published var saving = false
    @Published var problem: String?
    @Published var preview = false

    @Published var targetType = "vat"
    @Published var numberingMode = "auto"
    @Published var customNumber = ""
    @Published var autoPreview = ""
    @Published var numberLoading = false
    @Published var issueDate = FinanceText.dayString(Date())
    @Published var saleDate = FinanceText.dayString(Date())
    @Published var paymentTermDays = "7"
    @Published var receivedPaymentConfirmed = false
    /// „DD.MM.RRRR” albo „RRRR-MM-DD” — jak pole daty wpłaty w CRM (może być puste).
    @Published var receivedPaymentDate = ""
    @Published var buyer = ProformaSetup.Buyer(name: "", nip: "", email: "", street: "", postalCode: "", city: "")

    // Odbiorca KSeF
    @Published var recipient = InvoiceRecipientDraft.same
    @Published var recipientReadError: String?
    @Published var recipientLoading = false
    @Published var recipientLoadError: String?
    @Published var recipientOrganizations: [InvoiceRecipientOrganization] = []
    private var recipientRequest = 0
    private var numberRequest = 0

    init(proformaID: String) { self.proformaID = proformaID }

    private var api: NativeAPI? { workspace?.nativeAPI() }
    private func get<T: Decodable>(_ query: [String: String], as kind: T.Type = T.self) async throws -> T {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/finance", query: query))
    }
    private func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    // MARK: Pochodne (jak w oknie CRM)
    /// Dzisiejsza data jak w CRM (`toISOString`) — zgodna z kontrolą daty wpłaty w bazie.
    static var today: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }
    var paymentDueDate: String? { InvoiceMath.dueDate(issue: issueDate, days: paymentTermDays) }
    var invalidPaymentTerm: Bool { targetType != "advance" && paymentDueDate == nil }
    var currency: String { setup?.currency ?? "PLN" }

    /// „DD.MM.RRRR” albo „RRRR-MM-DD” → „RRRR-MM-DD” (`parseProformaPaymentDate`).
    static func parsePaymentDate(_ value: String) -> String? {
        let input = value.trimmingCharacters(in: .whitespaces)
        var iso = input
        if input.range(of: "^\\d{2}\\.\\d{2}\\.\\d{4}$", options: .regularExpression) != nil {
            let parts = input.split(separator: ".")
            iso = "\(parts[2])-\(parts[1])-\(parts[0])"
        }
        guard iso.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil,
              let date = FinanceText.dayDate(iso), FinanceText.dayString(date) == iso else { return nil }
        return iso
    }

    /// Wpłata zapisana przy pro formie (`getRecordedProformaPaymentDate`): pełna kwota i data nie późniejsza niż dziś
    /// i niż data wystawienia.
    var recordedPaymentDate: String? {
        guard let setup else { return nil }
        let today = Self.today
        guard setup.totals.gross > 0, setup.manualPaidAmount >= setup.totals.gross - 0.01,
              let date = Self.parsePaymentDate(setup.paidDate), date <= today, date <= issueDate else { return nil }
        return date
    }
    var paymentDateValue: String { recordedPaymentDate ?? receivedPaymentDate }
    var paymentDateDisplay: String {
        paymentDateValue.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil
            ? paymentDateValue.split(separator: "-").reversed().joined(separator: ".") : paymentDateValue
    }
    var targetNumber: String { numberingMode == "manual" ? customNumber.trimmingCharacters(in: .whitespaces) : autoPreview.nonEmpty ?? "—" }

    // MARK: Wczytanie
    func load() async {
        loading = true
        defer { loading = false }
        do {
            let data: ProformaSetup = try await get(["op": "proformaSetup", "id": proformaID])
            setup = data
            loadError = nil
            recipient = data.recipient
            recipientReadError = data.recipientError
            receivedPaymentConfirmed = false
            receivedPaymentDate = data.paidDate
            buyer = data.buyer
            await fetchNextNumber()
        } catch {
            loadError = failureText(error, "Nie znaleziono proformy")
        }
    }

    func changeTarget(_ type: String) async {
        guard type != targetType else { return }
        targetType = type
        await fetchNextNumber()
    }

    func fetchNextNumber() async {
        guard setup?.companyId.isEmpty == false else { return }
        numberRequest += 1
        let request = numberRequest
        numberLoading = true
        defer { if request == numberRequest { numberLoading = false } }
        struct Reply: Decodable { var number: String }
        do {
            let reply: Reply = try await get(["op": "proformaNumber", "id": proformaID, "type": targetType])
            guard request == numberRequest else { return }
            autoPreview = reply.number
        } catch {
            guard request == numberRequest else { return }
            workspace?.error = failureText(error, "Nie udało się odczytać numeracji")
        }
    }

    // MARK: Odbiorca
    func editRecipient(_ draft: InvoiceRecipientDraft) {
        recipientRequest += 1
        recipientLoading = false
        recipientLoadError = nil
        recipientReadError = nil
        recipient = draft
    }

    func loadRecipientOrganizations() async {
        guard recipientOrganizations.isEmpty else { return }
        struct Reply: Decodable { var organizations: [InvoiceRecipientOrganization] }
        do {
            let reply: Reply = try await get(["op": "invoiceRecipientOrgs"])
            recipientOrganizations = reply.organizations
        } catch {
            recipientLoadError = "Nie udało się wczytać organizacji. Możesz wprowadzić dane odbiorcy ręcznie."
        }
    }

    func selectRecipientOrganization(_ id: String, role: Int?) async {
        var draft = InvoiceRecipientDraft.organization(id, role: role ?? 2)
        editRecipient(draft)
        guard !id.isEmpty else { return }
        recipientRequest += 1
        let request = recipientRequest
        recipientLoading = true
        do {
            draft = try await get(["op": "invoiceRecipientOrg", "id": id])
            guard request == recipientRequest, recipient.mode == "organization", recipient.organizationId == id else { return }
            recipient = draft
            recipientLoadError = nil
        } catch {
            guard request == recipientRequest else { return }
            recipientLoadError = failureText(error, "Nie udało się odczytać odbiorcy.")
        }
        recipientLoading = false
    }

    // MARK: Sprawdzenie i zapis
    /// `validateRecipientForConversion` z okna CRM (serwer sprawdza ponownie).
    private func recipientProblem() -> String? {
        if let error = recipientReadError { return error }
        if let first = recipient.errors.first { return recipient.errors.count > 1 ? recipient.errors.joined(separator: " ") : first }
        let internalID = recipient.data.internalId.trimmingCharacters(in: .whitespaces)
        if recipient.mode != "same_as_buyer" && !internalID.isEmpty {
            let buyerNip = InvoiceMath.normalizeNip(buyer.nip)
            if internalID.split(separator: "-").first.map(String.init) != buyerNip {
                return "NIP w numerze wewnętrznym odbiorcy musi odpowiadać NIP nabywcy. Sprawdź obie strony przed wystawieniem faktury."
            }
        }
        return nil
    }

    /// „Dalej: podgląd” (`goToPreview`).
    func goToPreview() {
        if let message = recipientProblem() { problem = message; return }
        if invalidPaymentTerm { problem = "Podaj termin płatności jako liczbę całkowitą dni od 0 oraz poprawną datę wystawienia."; return }
        if numberingMode == "manual" && customNumber.trimmingCharacters(in: .whitespaces).isEmpty { problem = "Podaj numer faktury"; return }
        if targetType == "advance" {
            let saved = recordedPaymentDate
            let candidate = saved ?? Self.parsePaymentDate(receivedPaymentDate)
            guard saved != nil || receivedPaymentConfirmed, let date = candidate else {
                problem = "Potwierdź otrzymanie całej kwoty pro formy i podaj rzeczywistą datę wpłaty."
                return
            }
            if date > Self.today || date > issueDate {
                problem = "Data wpłaty nie może być w przyszłości ani po dacie wystawienia zaliczki."
                return
            }
        }
        problem = nil
        preview = true
    }

    /// „Wystaw fakturę” — identyfikator nowej faktury albo `nil` (komunikat w oknie).
    func submit() async -> String? {
        guard let workspace, let api else { return nil }
        if invalidPaymentTerm { problem = "Podaj termin płatności jako liczbę całkowitą dni od 0 oraz poprawną datę wystawienia."; return nil }
        guard workspace.canWrite else { problem = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        saving = true
        defer { saving = false }
        let form: [String: JSONValue] = [
            "targetType": .string(targetType), "numberingMode": .string(numberingMode), "customNumber": .string(customNumber),
            "issueDate": .string(issueDate), "saleDate": .string(saleDate), "paymentTermDays": .string(paymentTermDays),
            "receivedPaymentConfirmed": .bool(receivedPaymentConfirmed), "receivedPaymentDate": .string(receivedPaymentDate),
            "recipient": recipient.json,
            "buyer": .object([
                "name": .string(buyer.name), "nip": .string(buyer.nip), "email": .string(buyer.email),
                "street": .string(buyer.street), "postalCode": .string(buyer.postalCode), "city": .string(buyer.city),
            ]),
        ]
        var body: [String: JSONValue] = ["op": .string("proformaConvert"), "id": .string(proformaID), "form": .object(form)]
        if let error = recipientReadError { body["recipientUnreadable"] = .bool(true); body["recipientError"] = .string(error) }
        do {
            let data = try await api.post("/finance", body, timeout: 120)
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            guard let id = reply["id"]?.text.nonEmpty else {
                problem = "Blad konwersji"
                return nil
            }
            workspace.succeed(reply["message"]?.text.nonEmpty ?? "Faktura została utworzona (szkic)")
            return id
        } catch {
            problem = failureText(error, "Błąd podczas konwersji proformy")
            return nil
        }
    }
}

@MainActor struct ProformaConvertSheet: View {
    let proformaID: String
    let proformaNumber: String
    /// Po wystawieniu: nowa faktura (karta przechodzi do niej, jak w CRM).
    let onConverted: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model: ProformaConvertModel

    init(proformaID: String, proformaNumber: String, onConverted: @escaping (String) -> Void) {
        self.proformaID = proformaID
        self.proformaNumber = proformaNumber
        self.onConverted = onConverted
        _model = StateObject(wrappedValue: ProformaConvertModel(proformaID: proformaID))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label(model.preview ? "Podgląd faktury przed wystawieniem" : "Wystaw fakturę na podstawie proformy", systemImage: "doc.text")
                    .font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            content
            footer
        }
        .frame(minWidth: 720, idealWidth: 820, minHeight: 640, idealHeight: 820)
        .background(theme.page)
        .overlay { if model.saving { PendingOverlay(text: "Tworzenie...") } }
        .interactiveDismissDisabled(model.saving)
        .task {
            model.workspace = state
            await model.load()
        }
    }

    @ViewBuilder private var content: some View {
        if let setup = model.setup {
            if model.preview { previewForm(setup) } else { configForm(setup) }
        } else if model.loading {
            ProgressView("Ładowanie danych proformy...").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView {
                Label("Nie można otworzyć pro formy", systemImage: "exclamationmark.triangle")
            } description: {
                Text(model.loadError ?? "Nie znaleziono proformy")
            } actions: {
                Button("Spróbuj ponownie") { Task { await model.load() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: Konfiguracja
    private func configForm(_ setup: ProformaSetup) -> some View {
        Form {
            Section("Proforma źródłowa") {
                Text(proformaNumber.isEmpty ? setup.number : proformaNumber).font(.headline)
                Text("Podstawa pozycji i kwoty: ta pro forma. Zachowamy wpisane na niej nazwy i układ pozycji — bez zastępowania ich szczegółami kalkulacji lub oferty.")
                    .font(.callout).foregroundStyle(.secondary)
                if setup.items.count == 1, let item = setup.items.first {
                    Text("Pozycja na nowej fakturze: \(item.name)").font(.callout)
                }
                if model.targetType == "advance" {
                    Text("Faktura końcowa odziedziczy nazwy i układ tej zaliczki. Pełną wartość rozliczenia pobierze osobno z zamówienia, w pierwszej kolejności z powiązanego eventu; nie będzie to ponowne naliczenie samej kwoty zaliczki.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Typ docelowy") {
                Picker("Typ docelowy", selection: Binding(get: { model.targetType }, set: { value in Task { await model.changeTarget(value) } })) {
                    Text("Faktura VAT — pełnoprawna faktura sprzedażowa").tag("vat")
                    Text("Faktura zaliczkowa — cała opłacona pro forma, bez ponownego procentowania").tag("advance")
                }
                .pickerStyle(.radioGroup).labelsHidden()
            }
            if model.targetType == "advance" { advanceSection(setup) }
            numberSection
            datesSection
            buyerSection
            Section("Odbiorca na fakturze i w KSeF") {
                Text("Nabywca i odbiorca są kopiowani z pro formy, bez odświeżania ich danymi aktualnego kontaktu. Poniższe zmiany dotyczą wyłącznie nowej faktury.")
                    .font(.caption).foregroundStyle(.secondary)
                if let error = model.recipientReadError {
                    Text("\(error) Wybierz ponownie sposób wskazania odbiorcy i sprawdź jego dane.").font(.callout).foregroundStyle(.red)
                }
                InvoiceRecipientEditorView(model: model, disabled: model.saving)
            }
        }
        .formStyle(.grouped)
        .disabled(model.saving)
    }

    private func advanceSection(_ setup: ProformaSetup) -> some View {
        Section {
            Text("Kwota zaliczki: \(InvoiceMath.money(setup.totals.gross, model.currency))").fontWeight(.medium).foregroundStyle(theme.accent)
            Text(verbatim: "To 100% tej pro formy — nie przeliczamy jej ponownie procentem. Zaliczka potwierdzi otrzymaną wpłatę, a do zapłaty pozostanie \(InvoiceMath.money(0, model.currency)). Pro forma również zostanie oznaczona jako opłacona z tą samą datą — bez dodawania drugiej wpłaty. Faktura końcowa obejmie pełne zamówienie pomniejszone o rozliczone zaliczki.")
                .font(.callout).foregroundStyle(.secondary)
            if model.recordedPaymentDate != nil {
                Text("Zachowamy wpłatę potwierdzoną przy pro formie oraz jej datę.").font(.callout).foregroundStyle(theme.accent)
            } else {
                Toggle("Potwierdzam otrzymanie całej kwoty tej pro formy. Nie jest to potwierdzenie nowej, dodatkowej wpłaty.", isOn: $model.receivedPaymentConfirmed)
                    .toggleStyle(.checkbox)
            }
            HStack {
                TextField("Rzeczywista data otrzymania wpłaty *", text: Binding(get: { model.paymentDateDisplay }, set: { model.receivedPaymentDate = $0 }),
                          prompt: Text("DD.MM.RRRR"))
                    .disabled(model.recordedPaymentDate != nil)
                DatePicker("", selection: Binding(
                    get: { FinanceText.dayDate(ProformaConvertModel.parsePaymentDate(model.paymentDateValue) ?? "") ?? Date() },
                    set: { model.receivedPaymentDate = FinanceText.dayString($0) }
                ), in: ...paymentDateLimit, displayedComponents: .date)
                .labelsHidden().datePickerStyle(.field).fixedSize()
                .disabled(model.recordedPaymentDate != nil)
                .help("Wybierz datę otrzymania wpłaty z kalendarza")
            }
        }
    }

    /// Najpóźniejsza data wpłaty w kalendarzu: data wystawienia albo dzisiaj (wcześniejsza z nich).
    private var paymentDateLimit: Date {
        let issue = FinanceText.dayDate(model.issueDate) ?? Date()
        return min(issue, Date())
    }

    private var numberSection: some View {
        Section("Numer faktury") {
            Picker("Numer faktury", selection: $model.numberingMode) {
                Text("Automatyczny").tag("auto")
                Text("Własny numer").tag("manual")
            }
            .pickerStyle(.segmented).labelsHidden()
            if model.numberingMode == "auto" {
                HStack {
                    Text(model.numberLoading ? "Ładowanie..." : "Następny: \(model.autoPreview.nonEmpty ?? "—")").foregroundStyle(.secondary)
                    Spacer()
                    Button { Task { await model.fetchNextNumber() } } label: { Image(systemName: "arrow.clockwise") }
                        .buttonStyle(.borderless).help("Pobierz następny wolny numer").disabled(model.numberLoading)
                }
            } else {
                TextField("Numer", text: $model.customNumber, prompt: Text("np. FV/123/2026"))
                Text("Wpisz numer ręcznie").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func dayBinding(_ value: Binding<String>) -> Binding<Date> {
        Binding(get: { FinanceText.dayDate(value.wrappedValue) ?? Date() }, set: { value.wrappedValue = FinanceText.dayString($0) })
    }

    private var datesSection: some View {
        Section {
            DatePicker("Data wystawienia", selection: dayBinding($model.issueDate), displayedComponents: .date)
            DatePicker("Data sprzedaży", selection: dayBinding($model.saleDate), displayedComponents: .date)
            if model.targetType != "advance" {
                TextField("Termin płatności (dni)", text: $model.paymentTermDays)
                if model.invalidPaymentTerm {
                    Text("Podaj pełną liczbę dni od 0 oraz poprawną datę wystawienia.").font(.caption).foregroundStyle(.red)
                } else if let due = model.paymentDueDate {
                    Text("Od daty wystawienia · termin: \(FinanceText.day(due))\(Int(model.paymentTermDays.trimmingCharacters(in: .whitespaces)) == 0 ? " (płatność w dniu wystawienia)" : "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var buyerSection: some View {
        Section("Dane nabywcy (możesz poprawić)") {
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
                GridRow {
                    TextField("Nazwa", text: $model.buyer.name)
                    TextField("NIP", text: $model.buyer.nip)
                }
                GridRow {
                    TextField("Ulica", text: $model.buyer.street)
                    HStack {
                        TextField("Kod", text: $model.buyer.postalCode)
                        TextField("Miasto", text: $model.buyer.city)
                    }
                }
                GridRow {
                    TextField("Email", text: $model.buyer.email)
                    Color.clear.frame(height: 1)
                }
            }
            .textFieldStyle(.roundedBorder)
        }
    }

    // MARK: Podgląd
    private func previewForm(_ setup: ProformaSetup) -> some View {
        let advance = model.targetType == "advance"
        let recipient = model.recipient
        return Form {
            Section("Podsumowanie") {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
                    GridRow {
                        LabeledContent("Numer:", value: model.targetNumber)
                        LabeledContent("Typ:", value: advance ? "Zaliczkowa" : "VAT")
                        LabeledContent("Status:", value: advance ? "Opłacona" : "Szkic")
                    }
                    GridRow {
                        LabeledContent("Wystawienia:", value: model.issueDate)
                        LabeledContent("Sprzedaży:", value: model.saleDate)
                        if advance {
                            LabeledContent("Wpłata otrzymana:", value: model.paymentDateDisplay)
                        } else {
                            LabeledContent("Termin:", value: "\(model.paymentDueDate.map { FinanceText.day($0) } ?? "—") (\(Int(model.paymentTermDays.trimmingCharacters(in: .whitespaces)) ?? 0) dni od wystawienia)")
                        }
                    }
                    if advance {
                        GridRow { LabeledContent("Zaliczka:", value: "Cała kwota pro formy").gridCellColumns(3) }
                    }
                }
            }
            Section {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("SPRZEDAWCA").font(.caption2).foregroundStyle(.secondary)
                        Text(setup.seller.name.nonEmpty ?? "—")
                        Text("NIP \(setup.seller.nip.nonEmpty ?? "—")").font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("NABYWCA").font(.caption2).foregroundStyle(.secondary)
                        Text(model.buyer.name.nonEmpty ?? "—")
                        if !model.buyer.nip.isEmpty { Text("NIP \(model.buyer.nip)").font(.caption).foregroundStyle(.secondary) }
                        if !model.buyer.street.isEmpty {
                            Text("\(model.buyer.street), \(model.buyer.postalCode) \(model.buyer.city)").font(.caption).foregroundStyle(.secondary)
                        }
                        if !model.buyer.email.isEmpty { Text(model.buyer.email).font(.caption).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Section("Odbiorca") {
                if recipient.mode == "same_as_buyer" {
                    Text("Taki sam jak nabywca — \(model.buyer.name.nonEmpty ?? "—").")
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(recipient.data.name).fontWeight(.medium)
                        Text("\(recipient.data.street), \(recipient.data.postalCode) \(recipient.data.city) · \(recipient.data.countryCode)").foregroundStyle(.secondary)
                        if !recipient.data.nip.isEmpty { Text("NIP \(recipient.data.nip)").foregroundStyle(.secondary) }
                        if !recipient.data.internalId.isEmpty { Text("Numer wewnętrzny KSeF: \(recipient.data.internalId)").foregroundStyle(theme.accent) }
                        Text("Te dane będą zapisane jako oddzielny odbiorca na nowej fakturze.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("Pozycje na fakturze — odziedziczone z pro formy") {
                Grid(alignment: .trailing, horizontalSpacing: 12, verticalSpacing: 4) {
                    GridRow {
                        Text("Nazwa").gridColumnAlignment(.leading)
                        Text("Jm."); Text("Ilość"); Text("Cena netto"); Text("VAT"); Text("Brutto")
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(setup.items.enumerated()), id: \.offset) { _, item in
                        GridRow {
                            Text(item.name).gridColumnAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading)
                            Text(item.unit).foregroundStyle(.secondary)
                            Text(InvoiceMath.plain(item.quantity))
                            Text(String(format: "%.2f", item.priceNet))
                            Text(verbatim: "\(InvoiceMath.plain(item.vatRate))%")
                            Text(String(format: "%.2f", item.gross)).fontWeight(.medium)
                        }
                    }
                }
                .monospacedDigit()
                HStack {
                    LabeledContent("Netto:", value: String(format: "%.2f", setup.totals.net))
                    LabeledContent("VAT:", value: String(format: "%.2f", setup.totals.vat))
                    LabeledContent("Brutto:", value: String(format: "%.2f", setup.totals.gross) + " " + model.currency)
                }
            }
            Section {
                Text(verbatim: advance
                     ? "Otrzymano \(String(format: "%.2f", setup.totals.gross)) \(model.currency). Do zapłaty: 0,00 \(model.currency). Powstanie wystawiona, opłacona zaliczka, bez automatycznej wysyłki do KSeF. Sprawdź dane przed zatwierdzeniem."
                     : "Faktura zostanie utworzona jako szkic. Dane i pozycje można poprawić przed wystawieniem i wysłaniem do KSeF.")
            }
        }
        .formStyle(.grouped)
    }

    // MARK: Przyciski
    private var footer: some View {
        HStack(spacing: 10) {
            if model.preview {
                Button { model.preview = false } label: { Label("Wróć do edycji", systemImage: "arrow.left") }.disabled(model.saving)
            }
            if let problem = model.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.red).lineLimit(3).textSelection(.enabled)
            }
            Spacer()
            Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.saving)
            if model.preview {
                Button {
                    Task {
                        if let id = await model.submit() {
                            dismiss()
                            onConverted(id)
                        }
                    }
                } label: { Label(model.saving ? "Tworzenie..." : "Wystaw fakturę", systemImage: "checkmark") }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(model.saving || model.invalidPaymentTerm)
            } else {
                Button("Dalej: podgląd") { model.goToPreview() }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(model.loading || model.setup == nil || model.invalidPaymentTerm)
            }
        }
        .padding(16)
    }
}
