import SwiftUI

// MARK: Oferty, część D3 — „Zarezerwuj sprzęt” (`ReserveEquipmentModal`): akceptowany pakiet i warianty, braki konfiguracji
// pozycji, sprzęt z dostępnością w terminie wydarzenia, akceptowanie braków, zamienniki z wymaganymi komponentami,
// opcjonalne potwierdzenie realizacji dla klienta i zapis akceptacji z rezerwacją albo — gdy nic nie zaznaczono — akceptacja
// bez rezerwacji sprzętu. Serwer: `src/lib/native/offerReservation.ts`.

struct OfferReservationState: Decodable {
    struct Package: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var priceNet: Double
        var recommended: Bool
        var variants: [String]
    }
    struct Issue: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var packageName: String
        var missing: String
    }
    struct Equipment: Decodable, Identifiable, Hashable {
        var key: String
        var type: String
        var itemId: String
        var name: String
        var required: Double
        var total: Double
        var reserved: Double
        var available: Double
        var conflict: Bool
        var shortage: Double
        var id: String { key }
    }
    struct Preview: Decodable {
        var eventId: String
        var eventName: String
        var eventDate: String?
        var recipientEmail: String?
        var recipientName: String?
    }
    struct Confirmation: Decodable {
        var preview: Preview?
        var error: String?
    }
    var eventId: String
    var status: String
    var isNewAcceptance: Bool
    var packageMode: Bool
    var packages: [Package]
    var packageId: String?
    var variants: [String]
    var confirmation: Confirmation?
    var issues: [Issue]
    var error: String?
    var equipment: [Equipment]
}

struct OfferSubstitute: Decodable, Identifiable, Hashable {
    struct Component: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var kind: String
        var detail: String
        var quantity: Double
        var fixed: Bool
        var meters: Bool
    }
    var id: String
    var name: String
    var brand: String
    var model: String
    var thumbnailUrl: String?
    var available: Int
    var components: [Component]
}

extension OffersStore {
    func reservation(_ id: String, packageID: String?) async throws -> OfferReservationState {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(OfferReservationState.self, from: try await api.get("/offers?op=reservation&id=\(id)&package=\(packageID ?? "")"))
    }

    func substitutes(_ id: String, item: String) async throws -> [OfferSubstitute] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { var substitutes: [OfferSubstitute] }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/offers?op=substitutes&id=\(id)&item=\(item)")).substitutes
    }

    func saveSubstitution(_ id: String, from: String, to: String, quantity: Int, addComponents: Bool, packageID: String?) async throws -> OfferReservationState {
        guard let api, workspace?.canWrite == true else {
            throw NativeFailure(status: 0, message: "Zapis wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        let body: [String: JSONValue] = [
            "op": .string("substitutionSave"), "id": .string(id), "fromItemId": .string(from), "toItemId": .string(to),
            "quantity": .number(Double(quantity)), "addComponents": .bool(addComponents), "packageId": packageID.map { JSONValue.string($0) } ?? .null,
        ]
        return try JSONDecoder().decode(OfferReservationState.self, from: try await api.post("/offers", body))
    }

    /// Akceptacja i rezerwacja; zwraca komunikat i — przy wysyłce potwierdzenia — jej wynik.
    func confirmReservation(_ id: String, packageID: String?, items: [String], shortages: [String], sendConfirmation: Bool,
                            expectedRecipient: String?) async throws -> (message: String, confirmation: String?, confirmationSent: Bool) {
        guard let api, let workspace, workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Rezerwacja wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable {
            struct Confirmation: Decodable { var sent: Bool; var message: String }
            var message: String
            var confirmation: Confirmation?
        }
        let body: [String: JSONValue] = [
            "op": .string("reservationConfirm"), "id": .string(id), "packageId": packageID.map { JSONValue.string($0) } ?? .null,
            "items": .array(items.map { JSONValue.string($0) }), "shortages": .array(shortages.map { JSONValue.string($0) }),
            "sendConfirmation": .bool(sendConfirmation), "expectedRecipientEmail": .string(expectedRecipient ?? ""),
        ]
        let pending = sendConfirmation ? "Zapisuję i wysyłam…" : items.isEmpty && shortages.isEmpty ? "Zapisuję akceptację…" : "Rezerwuję…"
        let data = try await workspace.withPending(pending) { try await api.post("/offers", body, timeout: 120) }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        await loadDetail(id)
        Task { await sync(force: true) }
        return (reply.message, reply.confirmation?.message, reply.confirmation?.sent ?? false)
    }
}

@MainActor struct OfferReservationSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: OfferReservationState?
    @State private var loadError: String?
    @State private var loading = true
    @State private var packageId: String?
    @State private var selected = Set<String>()
    @State private var accepted = Set<String>()
    @State private var sendConfirmation = false
    @State private var confirming = false
    @State private var conflict: OfferReservationState.Equipment?
    /// Pozycja z brakującym sprzętem i obsadą pakietu — okno pozycji na Macu, po zamknięciu ponowne sprawdzenie.
    @State private var fixing: OfferItemRoute?

    private var equipment: [OfferReservationState.Equipment] { data?.equipment ?? [] }
    private var blocked: Bool { data == nil || data?.error != nil }
    /// Akceptacja jest możliwa także bez sprzętu: odznaczony sprzęt nie trafia do wydarzenia (jak w CRM po poprawce).
    private var canConfirm: Bool { !blocked }
    /// Oferta ma sprzęt, ale nic nie zaznaczono ani nie zaakceptowano braków — akceptacja bez rezerwacji sprzętu.
    private var withoutEquipment: Bool { !equipment.isEmpty && selected.isEmpty && accepted.isEmpty }
    /// Sprzęt, który można zaznaczyć (dostępny, bez zaakceptowanego braku).
    private var selectable: [String] { equipment.filter { !$0.conflict && !accepted.contains($0.key) }.map(\.key) }
    private var recipient: String? { data?.confirmation?.preview?.recipientEmail }
    private var confirmLabel: String {
        if confirming { return sendConfirmation ? "Zapisuję i wysyłam…" : withoutEquipment ? "Zapisuję…" : "Rezerwuję…" }
        if sendConfirmation { return "Potwierdź i wyślij wiadomość" }
        if equipment.isEmpty { return "Potwierdź ofertę" }
        return withoutEquipment ? "Potwierdź bez rezerwacji sprzętu" : "Potwierdź rezerwację"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "lock.fill").foregroundStyle(.green).padding(8).background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                Text("Zarezerwuj sprzęt").font(.title3.weight(.semibold))
                Spacer()
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) { content }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 560)
            Divider()
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(confirming)
                Button {
                    Task { await confirm() }
                } label: {
                    Label(confirmLabel, systemImage: "lock")
                }
                .buttonStyle(.borderedProminent).tint(.green).keyboardShortcut(.defaultAction)
                .disabled(loading || confirming || !canConfirm || !state.canWrite)
            }
            .padding(16)
        }
        .frame(width: 860)
        .interactiveDismissDisabled(confirming)
        .task { await load(nil) }
        .sheet(item: $fixing, onDismiss: { Task { await load(packageId) } }) { route in
            OfferItemSheet(store: store, offerID: offerID, itemID: route.itemID)
        }
        .sheet(item: $conflict) { item in
            OfferSubstitutionSheet(store: store, offerID: offerID, item: item, packageId: packageId) { next in apply(next) }
        }
    }

    // MARK: Treść

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView("Ładowanie sprzętu...").frame(maxWidth: .infinity).padding(.vertical, 60)
        } else if let loadError, data == nil {
            errorBox(loadError, issues: [])
        } else if let data {
            if let error = data.error {
                errorBox(error, issues: data.issues)
            } else {
                if data.packageMode { packagePicker(data, label: "Akceptowany pakiet i warianty") }
                if !data.variants.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("WARIANTY ZAPISANE PRZY AKCEPTACJI").font(.caption.weight(.semibold)).foregroundStyle(.green)
                        Text(data.variants.joined(separator: "  •  ")).font(.callout)
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                }
                if data.isNewAcceptance { confirmationBox(data) }
                intro.font(.callout)
                if equipment.isEmpty {
                    Text("Ta oferta nie wymaga rezerwacji sprzętu. Możesz ją potwierdzić bez przypisanego sprzętu.")
                        .font(.callout).foregroundStyle(.blue)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                } else {
                    table
                    if withoutEquipment {
                        VStack(alignment: .leading, spacing: 4) {
                            Label("Bez rezerwacji sprzętu", systemImage: "info.circle").font(.callout.weight(.semibold)).foregroundStyle(.blue)
                            Text("Nie zaznaczono żadnego sprzętu. Oferta zostanie zaakceptowana bez rezerwacji — sprzęt z produktów tej oferty nie trafi do eventu. W razie potrzeby dodasz go później w zakładce Sprzęt eventu.")
                                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                    }
                    if !accepted.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Label("Zaakceptowane braki", systemImage: "exclamationmark.triangle").font(.callout.weight(.semibold)).foregroundStyle(.yellow)
                            Text("Zaakceptowano \(accepted.count) pozycji z brakami. Pozostaną one oznaczone w zakładce Sprzęt do dalszego rozwiązania.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.yellow.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    private var intro: Text {
        let lead = equipment.isEmpty ? "Ta oferta nie zawiera pozycji sprzętowych. Po potwierdzeniu status oferty zmieni się na "
                                     : "Poniższy sprzęt zostanie wstępnie zarezerwowany dla tego eventu. Status oferty zmieni się na "
        return Text(lead).foregroundColor(.secondary) + Text("Zaakceptowana").foregroundColor(.green) + Text(".").foregroundColor(.secondary)
    }

    private func errorBox(_ message: String, issues: [OfferReservationState.Issue]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Nie można jeszcze zaakceptować oferty").font(.headline).foregroundStyle(theme.accent)
            Text(message).font(.callout)
            ForEach(issues) { issue in
                VStack(alignment: .leading, spacing: 4) {
                    Text(issue.name).font(.callout.weight(.medium))
                    Text("Pakiet: \(issue.packageName). Uzupełnij: \(issue.missing).").font(.caption).foregroundStyle(.secondary)
                    Text("Sprzęt i obsadę pakietu uzupełnisz w pozycji oferty („Sprzęt i obsada”). Zmiana samego produktu nie aktualizuje już dodanej oferty.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button("Uzupełnij pozycję") { fixing = OfferItemRoute(itemID: issue.id) }.controlSize(.small)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            if let data, data.packageMode { packagePicker(data, label: "Sprawdź inny pakiet") }
            Button("Sprawdź ponownie") { Task { await load(packageId) } }.buttonStyle(.link)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }

    private func packagePicker(_ data: OfferReservationState, label: String) -> some View {
        ProductField(label: label) {
            Picker("", selection: Binding(get: { packageId ?? "" }, set: { next in Task { await load(next.isEmpty ? nil : next) } })) {
                ForEach(data.packages) { pkg in
                    Text("\(pkg.name)\(pkg.recommended ? " — rekomendowany" : "") · \(OfferText.number(pkg.priceNet)) zł netto").tag(pkg.id)
                }
            }
            .labelsHidden()
            .disabled(confirming)
        }
    }

    private func confirmationBox(_ data: OfferReservationState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: $sendConfirmation) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Wyślij klientowi potwierdzenie realizacji po zaakceptowaniu oferty")
                    Text("Opcjonalnie. Wiadomość zostanie wysłana dopiero po zapisaniu akceptacji; bez zaznaczenia zapisujemy tylko ofertę i rezerwację.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.checkbox)
            .disabled(confirming || recipient == nil)
            if let error = data.confirmation?.error {
                Text("\(error) Możesz zapisać akceptację bez wysyłki.").font(.caption).foregroundStyle(.orange)
            } else if let preview = data.confirmation?.preview {
                VStack(alignment: .leading, spacing: 4) {
                    Text(preview.eventName).font(.callout.weight(.medium))
                    Text(preview.eventDate.map { OfferText.long($0) } ?? "Termin nie został zapisany").font(.caption).foregroundStyle(.secondary)
                    if let email = preview.recipientEmail {
                        Text("Odbiorca: \(email)\((preview.recipientName ?? "").isEmpty ? "" : " · \(preview.recipientName ?? "")")").font(.callout)
                    } else {
                        Text("Brak e-maila kontaktu i organizacji eventu. Akceptacja jest możliwa bez wiadomości.").font(.caption).foregroundStyle(.orange)
                    }
                    Text("Potwierdzenie realizacji korzysta z danych eventu: terminu, miejsca, harmonogramu i zaakceptowanej oferty. To ten sam szablon co przy zmianie statusu eventu. Nie wystawia ani nie wysyła faktury.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Tabela sprzętu

    private var table: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Group {
                    if selectable.isEmpty {
                        Color.clear
                    } else {
                        Toggle("", isOn: Binding(get: { selectable.allSatisfy { selected.contains($0) } }, set: { on in
                            if on { selected.formUnion(selectable) } else { selected.subtract(selectable) }
                        }))
                        .toggleStyle(.checkbox).labelsHidden()
                        .help("Zaznacz albo odznacz cały dostępny sprzęt")
                        .disabled(confirming)
                    }
                }
                .frame(width: 20)
                Text("Sprzęt").frame(maxWidth: .infinity, alignment: .leading)
                Text("Wymagane").frame(width: 80, alignment: .trailing)
                Text("Dostępne").frame(width: 90, alignment: .trailing)
                Text("Status").frame(width: 150, alignment: .leading)
                Color.clear.frame(width: 28)
            }
            .font(.caption).foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color.primary.opacity(0.05))
            ForEach(equipment) { item in
                Divider()
                row(item)
            }
        }
        .background(Color.primary.opacity(0.02), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
    }

    private func row(_ item: OfferReservationState.Equipment) -> some View {
        let isAccepted = accepted.contains(item.key)
        return HStack(spacing: 10) {
            Group {
                if !item.conflict && !isAccepted {
                    Toggle("", isOn: Binding(get: { selected.contains(item.key) }, set: { on in
                        if on { selected.insert(item.key) } else { selected.remove(item.key) }
                    }))
                    .toggleStyle(.checkbox).labelsHidden()
                } else {
                    Color.clear
                }
            }
            .frame(width: 20)
            HStack(spacing: 6) {
                if item.type == "kit" { Image(systemName: "shippingbox").foregroundStyle(theme.accent) }
                Text(item.name).font(.callout)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(OfferText.number(item.required)).font(.callout.weight(.medium)).monospacedDigit().frame(width: 80, alignment: .trailing)
            Text("\(OfferText.number(item.available)) / \(OfferText.number(item.total))").font(.callout).foregroundStyle(.secondary)
                .monospacedDigit().frame(width: 90, alignment: .trailing)
            statusBadge(item, accepted: isAccepted).frame(width: 150, alignment: .leading)
            Group {
                if item.conflict && !isAccepted {
                    Menu {
                        Button { acceptShortage(item) } label: { Label("Zaakceptuj brak", systemImage: "exclamationmark.triangle") }
                        Button { conflict = item } label: { Label("Rozwiąż konflikt", systemImage: "shippingbox") }
                            .disabled(item.type == "kit")
                    } label: { Image(systemName: "ellipsis.circle") }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                        .disabled(confirming)
                } else {
                    Color.clear
                }
            }
            .frame(width: 28)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .opacity(isAccepted ? 0.6 : 1)
    }

    @ViewBuilder private func statusBadge(_ item: OfferReservationState.Equipment, accepted: Bool) -> some View {
        if accepted {
            Label("Zaakceptowany brak", systemImage: "exclamationmark.triangle").reservationBadge(.yellow)
        } else if item.conflict {
            Label("Brak \(OfferText.number(item.shortage))", systemImage: "exclamationmark.triangle").reservationBadge(.red)
        } else {
            Label("Dostępne", systemImage: "checkmark.circle").reservationBadge(.green)
        }
    }

    // MARK: Czynności

    private func acceptShortage(_ item: OfferReservationState.Equipment) {
        accepted.insert(item.key)
        state.notice = "Brak sprzętu został zaakceptowany. Zostanie oznaczony w zakładce Sprzęt."
    }

    private func apply(_ next: OfferReservationState) {
        data = next
        packageId = next.packageId
        selected = Set(next.equipment.filter { !$0.conflict }.map(\.key))
        accepted = []
    }

    private func load(_ packageID: String?) async {
        loading = true
        loadError = nil
        defer { loading = false }
        do {
            let next = try await store.reservation(offerID, packageID: packageID)
            apply(next)
            if next.confirmation?.preview?.recipientEmail == nil { sendConfirmation = false }
        } catch {
            data = nil
            loadError = store.failureText(error, "Nie udało się odczytać danych oferty.")
        }
    }

    private func confirm() async {
        guard canConfirm, !confirming else { return }
        confirming = true
        defer { confirming = false }
        do {
            let send = sendConfirmation && data?.isNewAcceptance == true
            let result = try await store.confirmReservation(offerID, packageID: data?.packageMode == true ? packageId : nil,
                                                            items: Array(selected), shortages: Array(accepted),
                                                            sendConfirmation: send, expectedRecipient: recipient)
            if let confirmation = result.confirmation {
                // Treść z serwera mówi już o zapisie akceptacji; bez wysyłki — ostrzeżenie zamiast sukcesu.
                if result.confirmationSent { state.succeed(confirmation) } else { state.notice = confirmation }
            } else {
                state.succeed(result.message)
            }
            dismiss()
        } catch {
            state.error = store.failureText(error, "Błąd podczas rezerwacji sprzętu")
        }
    }
}

private extension View {
    /// Znacznik stanu w tabeli sprzętu.
    func reservationBadge(_ color: Color) -> some View {
        self.font(.caption).foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(color.opacity(0.3)))
    }
}

// MARK: Rozwiąż konflikt (zamienniki)

@MainActor struct OfferSubstitutionSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    let item: OfferReservationState.Equipment
    let packageId: String?
    let onSaved: (OfferReservationState) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var substitutes: [OfferSubstitute] = []
    @State private var quantities: [String: Double] = [:]
    @State private var loading = true
    @State private var problem: String?
    @State private var saving = false
    /// Zamiennik z wymaganymi komponentami czeka na decyzję („Wymagane komponenty”).
    @State private var pending: (substitute: OfferSubstitute, quantity: Int)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(pending == nil ? "Rozwiąż konflikt" : "Wymagane komponenty").font(.title3.weight(.semibold))
                Text(pending == nil ? item.name : "Ten sprzęt wymaga następujących komponentów do prawidłowego działania")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let pending { components(pending.substitute, quantity: pending.quantity) } else { list }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 440)
            Divider()
            HStack {
                if let pending {
                    Button("Anuluj") { self.pending = nil }.disabled(saving)
                    Spacer()
                    Button("Kontynuuj bez komponentów") { Task { await save(pending.substitute, quantity: pending.quantity, components: false) } }.disabled(saving)
                    Button { Task { await save(pending.substitute, quantity: pending.quantity, components: true) } } label: {
                        Label("Dodaj komponenty i zapisz", systemImage: "checkmark.circle")
                    }
                    .buttonStyle(.borderedProminent).disabled(saving)
                } else {
                    Spacer()
                    Button("Powrót") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                }
            }
            .padding(16)
        }
        .frame(width: 640)
        .interactiveDismissDisabled(saving)
        .task { await load() }
    }

    @ViewBuilder private var list: some View {
        if loading {
            ProgressView("Szukam alternatyw...").frame(maxWidth: .infinity).padding(.vertical, 40)
        } else if let problem, substitutes.isEmpty {
            HStack {
                Text(problem).foregroundStyle(.red)
                Button("Ponów") { Task { await load() } }
            }
        } else if substitutes.isEmpty {
            Text("Nie znaleziono dostępnych zamienników w tej kategorii.").font(.callout).foregroundStyle(.secondary).padding(.vertical, 30)
        } else {
            Text("Zastępujesz \(OfferText.number(item.required)) szt. Wybierz zamiennik i podaj jego ilość — nie musi być taka sama.")
                .font(.caption).foregroundStyle(.secondary)
            if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
            ForEach(substitutes) { substitute in row(substitute) }
        }
    }

    private func row(_ substitute: OfferSubstitute) -> some View {
        let quantity = quantities[substitute.id]
        let valid = quantity.map { $0 == $0.rounded() && $0 >= 1 && $0 <= Double(substitute.available) } ?? false
        return HStack(spacing: 12) {
            Group {
                if let address = substitute.thumbnailUrl, let url = URL(string: address) {
                    AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Color.primary.opacity(0.05) }
                } else {
                    Image(systemName: "shippingbox").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.primary.opacity(0.05))
                }
            }
            .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(substitute.name).font(.callout.weight(.medium))
                    if !substitute.components.isEmpty {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(.yellow)
                            .help("Wymagane komponenty: " + substitute.components.map(\.name).joined(separator: ", "))
                    }
                }
                if !(substitute.brand + substitute.model).isEmpty {
                    Text("\(substitute.brand) \(substitute.model)").font(.caption).foregroundStyle(.secondary)
                }
                Text("Dostępne: \(substitute.available) szt.").font(.caption).foregroundStyle(.green)
            }
            Spacer()
            ProductField(label: "Ilość zamiennika") {
                ProductNumberField(value: Binding(get: { quantity }, set: { quantities[substitute.id] = $0 }), nullable: true).frame(width: 80)
            }
            .frame(width: 110)
            Button(saving ? "Zapisuję…" : "Wybierz") { choose(substitute) }
                .buttonStyle(.borderedProminent).disabled(saving || !valid)
        }
        .padding(10)
        .background((substitute.components.isEmpty ? Color.primary.opacity(0.04) : Color.yellow.opacity(0.06)), in: RoundedRectangle(cornerRadius: 8))
    }

    private func components(_ substitute: OfferSubstitute, quantity: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Wybrany sprzęt nie będzie działać bez poniższych komponentów. Zalecamy ich dodanie.", systemImage: "exclamationmark.triangle")
                .font(.callout).foregroundStyle(.yellow)
            ForEach(substitute.components) { component in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(component.name).font(.callout.weight(.medium))
                        if component.kind == "kit" { Text("ZESTAW").font(.caption2.weight(.semibold)).foregroundStyle(theme.accent) }
                        if component.kind == "cable" { Text("PRZEWÓD").font(.caption2.weight(.semibold)).foregroundStyle(theme.accent) }
                        Text("WYMAGANY").font(.caption2.weight(.semibold)).foregroundStyle(.red)
                    }
                    Text("\(OfferText.number(component.quantity * (component.fixed ? 1 : Double(quantity)))) \(component.meters ? "m" : "szt.") łącznie dla \(quantity) szt. zamiennika")
                        .font(.caption).foregroundStyle(.secondary)
                    if !component.detail.isEmpty { Text(component.detail).font(.caption).foregroundStyle(.secondary) }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func load() async {
        loading = true
        problem = nil
        defer { loading = false }
        do {
            substitutes = try await store.substitutes(offerID, item: item.itemId)
            for substitute in substitutes {
                quantities[substitute.id] = Double(min(substitute.available, max(1, Int(item.required))))
            }
        } catch {
            problem = "Nie udało się pobrać zamienników. Spróbuj ponownie."
        }
    }

    private func choose(_ substitute: OfferSubstitute) {
        guard let value = quantities[substitute.id], value == value.rounded(), value >= 1, value <= Double(substitute.available) else {
            problem = "Podaj pełną liczbę sztuk od 1 do dostępnej ilości."
            return
        }
        if substitute.components.isEmpty {
            Task { await save(substitute, quantity: Int(value), components: false) }
        } else {
            pending = (substitute, Int(value))
        }
    }

    private func save(_ substitute: OfferSubstitute, quantity: Int, components: Bool) async {
        saving = true
        defer { saving = false }
        do {
            let next = try await store.saveSubstitution(offerID, from: item.itemId, to: substitute.id, quantity: quantity,
                                                        addComponents: components, packageID: packageId)
            state.succeed(components ? "Dodano wymagane komponenty. Zapisano zamiennik: \(quantity) szt." : "Zapisano zamiennik: \(quantity) szt.")
            onSaved(next)
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas zapisywania substytucji")
            pending = nil
        }
    }
}
