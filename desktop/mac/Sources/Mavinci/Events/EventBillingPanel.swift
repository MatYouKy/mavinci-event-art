import SwiftUI
import AppKit

// MARK: Rozliczenie i prowizje wydarzenia — strona panelu bocznego karty (obok Przeglądu), natywnie 1:1 z „Rozliczenie
// wydarzenia” (`EventBillingContextCard`) i „Sprzedawcy i prowizje” (`EventCommissionsPanel`) ze Szczegółów CRM: kto rozlicza
// i nabywca faktury, numer PO / zamówienia klienta, opiekunowie rozliczenia, sprzedawca pozyskujący wydarzenie, wspólne
// rozliczenie kilku wydarzeń oraz prowizje (z podsumowania i ręczne) z sumami. Dane z zakładki `billing` (kopia na dysku ze
// skrótem; przy każdym pobraniu finanse / administrator uzupełniają prowizje automatyczne jak w CRM), zapisy czynnościami
// zakładki `billing` tokenem pracownika — te same warunki i komunikaty co w przeglądarce. Edycja w osobnych oknach, żeby
// wąski panel pozostał czytelny.

struct EventBillingData: Decodable, Hashable {
    struct Buyer: Decodable, Hashable { var name: String; var role: Int }
    struct Person: Decodable, Hashable, Identifiable { var id: String; var name: String; var email: String?; var phone: String? }
    struct Referral: Decodable, Hashable { var id: String; var label: String; var description: String; var status: String; var commissionReady: Bool }
    struct Billing: Decodable, Hashable {
        var arrangement: String
        var arrangementLabel: String
        var clientOrganizationId: String?
        var clientName: String?
        var billingOrganizationId: String?
        var billingOrganizationName: String?
        var invoiceBuyer: Buyer?
        var purchaseOrderNumber: String?
        var contacts: [Person]
        var referralSchema: Bool
        var referral: Referral?
        var referralError: String?
    }
    struct SettlementEvent: Decodable, Hashable, Identifiable { var id: String; var name: String; var date: String? }
    struct Settlement: Decodable, Hashable { var groupId: String; var name: String; var primaryEventId: String; var events: [SettlementEvent] }
    struct Totals: Decodable, Hashable { var nominal: Double; var companyCost: Double; var burden: Double }
    /// Gdzie zapisać wypłatę: kontakt (rozliczenia prowizji) albo pracownik.
    struct Target: Decodable, Hashable { var kind: String; var id: String }
    struct Commission: Decodable, Hashable, Identifiable {
        var id: String
        var name: String
        var beneficiaryType: String
        var typeLabel: String
        var paymentMethod: String
        var paymentLabel: String
        var baseDescription: String?
        var automatic: Bool
        var sourceLabel: String?
        var entryKind: String?
        var entryKindLabel: String?
        var rateReason: String?
        var cancelReason: String?
        var autoCancelled: Bool
        var ownerProfit: Bool
        var status: String
        var statusLabel: String
        var calculationType: String
        var rate: Double
        var baseAmount: Double
        var amount: Double
        var companyCost: Double
        var dividendTaxRate: Double
        var waitingForOffer: Bool
        var dueDate: String?
        var paidAt: String?
        var notes: String?
        var salesPartnerId: String?
        var employeeId: String?
        var contactId: String?
        var organizationId: String?
        var settlements: Target?
    }
    struct Commissions: Decodable, Hashable {
        var available: Bool
        var error: String?
        var syncNotice: String?
        var acceptedOfferNet: Double
        var totals: Totals
        var rows: [Commission]
    }
    var canManageCommissions: Bool
    var billing: Billing
    var settlement: Settlement?
    var commissions: Commissions
}

/// Odczyty pomocnicze zakładki `billing` (okna edycji) i odpowiedź czynności.
enum EventBillingQuery {
    struct Option: Decodable, Hashable, Identifiable { var id: String; var label: String; var description: String? }
    struct Organizations: Decodable { var organizations: [Option] }
    struct OrgContact: Decodable, Hashable, Identifiable { var id: String; var name: String; var email: String?; var phone: String?; var position: String? }
    struct Contacts: Decodable { var contacts: [OrgContact] }
    struct Seller: Decodable, Hashable, Identifiable { var id: String; var label: String; var description: String; var keywords: String; var status: String; var commissionReady: Bool }
    struct Sellers: Decodable { var available: Bool; var sellers: [Seller] }
    struct Candidate: Decodable, Hashable, Identifiable {
        var id: String; var name: String; var date: String?; var organizationId: String?; var billingOrganizationId: String?; var contactPersonId: String?
    }
    struct Candidates: Decodable { var events: [Candidate] }
    struct Term: Decodable, Hashable { var rate: Double; var paymentMethod: String; var dividendTaxRate: Double }
    struct Partner: Decodable, Hashable, Identifiable {
        var id: String; var label: String; var detail: String; var organizationId: String?; var partnerType: String; var status: String
        var employeeId: String?; var contactId: String?; var term: Term?
    }
    struct Person: Decodable, Hashable, Identifiable { var id: String; var label: String; var detail: String; var organizationId: String? }
    struct OfferCommission: Decodable, Hashable { var partnerId: String; var rate: Double }
    struct CommissionOptions: Decodable {
        var acceptedOfferNet: Double; var offerCommission: OfferCommission?; var partners: [Partner]; var employees: [Person]; var contacts: [Person]; var organizations: [Option]
    }
    struct Reply: Decodable { var ok: Bool?; var message: String?; var commissionId: String?; var created: Bool?; var tone: String? }
}

/// Etykiety i wyliczenia jak w CRM (`eventCommission.ts`, `EventBillingContextCard`).
enum EventBillingText {
    static let arrangements: [(String, String)] = [
        ("direct", "Bezpośrednio przez klienta wydarzenia"), ("hotel", "Przez hotel"), ("agency", "Przez agencję"), ("other", "Przez inną organizację"),
    ]
    static let beneficiaryTypes: [(String, String)] = [
        ("salesperson", "Sprzedawca / osoba polecająca"), ("hotel", "Hotel / sala"), ("partner", "Partner"), ("employee", "Pracownik"), ("other", "Inny beneficjent"),
    ]
    static let paymentMethods: [(String, String)] = [
        ("cash_dividend", "Gotówka z zysku spółki"), ("invoice", "Faktura / rachunek"), ("payroll", "Wynagrodzenie pracownicze"), ("other", "Inny sposób"),
    ]
    static let sources: [(String, String)] = [
        ("partner", "Kartoteka sprzedawców"), ("contact", "Kontakt CRM / osoba z hotelu"), ("employee", "Pracownik CRM"), ("manual", "Osoba spoza bazy"),
    ]
    static let statuses: [(String, String)] = [("planned", "Planowana"), ("approved", "Zatwierdzona"), ("paid", "Wypłacona"), ("cancelled", "Anulowana")]
    static let defaultDividendTax = 19.0

    /// Rozliczenie i prowizje widoczne jak w Szczegółach CRM: `canViewBilling || canViewFinanceValues` i pola rozliczenia w bazie.
    static func available(_ page: EventCardPage) -> Bool {
        let flags = page.flags
        let event = page.event ?? [:]
        return (flags?.canViewBilling == true || flags?.canViewFinanceValues == true)
            && event["billing_arrangement"] != nil && event["billing_organization_id"] != nil
    }
    static let defaultBaseDescription = "Wartość netto zaakceptowanej oferty"

    static func payment(_ method: String) -> String { paymentMethods.first { $0.0 == method }?.1 ?? method }

    /// `formatCommissionMoney` — „1 234,50 zł”.
    static func money(_ value: Double) -> String { FinanceText.money(value) }

    /// Liczba jak w JavaScripcie (`${rate}%`): 10 → „10”, 7.5 → „7.5”.
    static func number(_ value: Double) -> String {
        value.rounded() == value && abs(value) < 1e15 ? String(Int(value)) : String(value)
    }

    /// `roundCommissionMoney`.
    static func roundMoney(_ value: Double) -> Double { ((value + Double.ulpOfOne) * 100).rounded() / 100 }

    /// `getCommissionAmounts`: kwota dla osoby, koszt spółki (gotówka z zysku ubruttowiona stawką podatku) i narzut.
    static func amounts(calculationType: String, base: Double, rate: Double, fixed: Double, payment: String, tax: Double) -> (nominal: Double, companyCost: Double, burden: Double) {
        let nominal = roundMoney(calculationType == "percent" ? max(0, base) * max(0, rate) / 100 : max(0, fixed))
        let safeTax = min(99.99, max(0, tax))
        let companyCost = roundMoney(payment == "cash_dividend" ? nominal / (1 - safeTax / 100) : nominal)
        return (nominal, companyCost, roundMoney(companyCost - nominal))
    }

    static func date(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        if value.count == 10 { return FinanceText.dayDate(value) }
        return MeetingDates.parse(value)
    }

    /// `toLocaleDateString('pl-PL')` — „5.11.2026”.
    static func day(_ value: String?, empty: String = "Termin nieustalony") -> String {
        date(value).map { MeetingDates.format($0, "d.MM.yyyy") } ?? empty
    }

    static func plural(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
        if count == 1 { return one }
        let tens = count % 100, units = count % 10
        return (2...4).contains(units) && !(12...14).contains(tens) ? few : many
    }

    static func reply(_ data: Data) -> EventBillingQuery.Reply? { try? JSONDecoder().decode(EventBillingQuery.Reply.self, from: data) }

    /// Po zmianie prowizji odświeżane są także już pobrane zakładki, które je pokazują (Finanse, Podsumowanie).
    @MainActor static func reloads(_ store: EventCardStore, _ eventID: String) -> [String] {
        ["billing"] + ["finances", "summary"].filter { store.card(eventID)?.tabs?[$0] != nil }
    }

    /// Rozliczenia prowizji i historia wypłat osoby — w CRM (kontakt: zakładka rozliczeń, pracownik: karta pracownika).
    static func settlementsPath(_ target: EventBillingData.Target) -> String {
        target.kind == "contact" ? "/crm/contacts/\(target.id)?tab=settlements" : "/crm/employees/\(target.id)"
    }

    static let violet = CrmTheme.rgb(0xa78bfa)
    static let amber = CrmTheme.rgb(0xf59e0b)
    static let warning = CrmTheme.rgb(0xf59e0b)
}

// MARK: Strona panelu bocznego

@MainActor struct EventBillingPanel: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let page: EventCardPage
    var navigate: (String) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var sheet: EventBillingSheet?
    @State private var cancellingAutomatic: EventBillingData.Commission?
    @State private var cancellingManual: EventBillingData.Commission?
    @State private var cancelReason = ""

    private var data: EventBillingData? { store.tab(eventID, "billing", as: EventBillingData.self) }
    /// „Edytuj” w rozliczeniu — administrator, autor wydarzenia albo zarządzanie wydarzeniami (jak `canEditEventDetails`).
    private var canEdit: Bool { page.flags?.canEditDetails == true }
    private var loading: Bool { store.tabLoading.contains("\(eventID)|billing") }
    private func canOpenTab(_ tab: String) -> Bool { page.flags?.tabs.contains { $0.id == tab } == true }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let data {
                    billingSection(data)
                    if data.settlement != nil || canEdit { settlementSection(data) }
                    commissionsSection(data)
                } else if let error = store.tabErrors["\(eventID)|billing"] {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error).font(.callout).foregroundStyle(.secondary)
                        Button("Spróbuj ponownie") { reload() }
                    }
                } else {
                    ProgressView("Wczytywanie rozliczenia…").controlSize(.small).frame(maxWidth: .infinity, minHeight: 120)
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: eventID) { await store.loadTab(eventID, "billing") }
        .onChange(of: store.card(eventID)?.hash) { reload() }
        .sheet(item: $sheet) { sheet in sheetView(sheet).warehouseSheetStyle(state) }
        .alert("Anulować prowizję z podsumowania?", isPresented: Binding(get: { cancellingAutomatic != nil }, set: { if !$0 { cancellingAutomatic = nil } })) {
            TextField("Powód anulowania", text: $cancelReason)
            Button("Anuluj prowizję", role: .destructive) {
                if let commission = cancellingAutomatic { cancelAutomatic(commission) }
            }
            Button("Wróć", role: .cancel) { cancellingAutomatic = nil }
        } message: {
            Text("Powód anulowania prowizji dla \(cancellingAutomatic?.name ?? "tej osoby"). Anulowanie jest trwałe — zatwierdzenie podsumowania jej nie przywróci (możesz ją przywrócić ręcznie).")
        }
        .confirmationDialog("Anulować prowizję dla \(cancellingManual?.name ?? "tej osoby")?",
                            isPresented: Binding(get: { cancellingManual != nil }, set: { if !$0 { cancellingManual = nil } }), titleVisibility: .visible) {
            if let commission = cancellingManual {
                Button("Anuluj prowizję", role: .destructive) {
                    Task { await run("commissionCancel", ["id": .string(commission.id)], failure: "Nie udało się anulować prowizji. Odśwież jej status.") }
                }
            }
            Button("Wróć", role: .cancel) { cancellingManual = nil }
        } message: {
            Text("Anulowany wpis zostaje w historii i blokuje ponowne automatyczne naliczenie.")
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("Rozliczenie i prowizje").font(.headline)
            Spacer()
            if loading { ProgressView().controlSize(.small) }
            Button { reload() } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.borderless).disabled(loading)
                .help("Odśwież rozliczenie i prowizje (uzupełnia też prowizje automatyczne)")
        }
    }

    private func reload() { Task { await store.loadTab(eventID, "billing") } }

    @ViewBuilder private func sheetView(_ sheet: EventBillingSheet) -> some View {
        if let data {
            switch sheet {
            case .billing: EventBillingEditSheet(store: store, eventID: eventID, data: data)
            case .settlement: EventSettlementEditSheet(store: store, eventID: eventID, page: page, data: data)
            case .commission(let commission):
                EventCommissionEditSheet(store: store, eventID: eventID, editing: commission, acceptedOfferNet: data.commissions.acceptedOfferNet)
            }
        } else {
            ProgressView().padding(40)
        }
    }

    // MARK: Elementy

    private func section<Content: View>(_ title: String, symbol: String, subtitle: String? = nil, action: (String, () -> Void)? = nil,
                                        actionDisabled: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: symbol).foregroundStyle(theme.accent)
                Text(title).font(.callout.weight(.semibold))
                Spacer(minLength: 4)
                if let action {
                    Button(action.0) { action.1() }.buttonStyle(.link).linkCursor().font(.callout).disabled(actionDisabled)
                }
            }
            if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            content()
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
    }

    private func fact<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.caption2.weight(.medium)).tracking(0.5).foregroundStyle(.tertiary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chip(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(color).background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
    }

    // MARK: Rozliczenie wydarzenia

    private func billingSection(_ data: EventBillingData) -> some View {
        let billing = data.billing
        let direct = billing.arrangement == "direct"
        let payer = direct ? billing.clientName?.nonEmpty ?? "Klient przypisany do wydarzenia"
            : billing.billingOrganizationName?.nonEmpty ?? "Nie wybrano organizacji"
        let edit: (String, () -> Void)? = canEdit ? ("Edytuj…", { sheet = .billing }) : nil
        return section("Rozliczenie wydarzenia", symbol: "doc.text", subtitle: "Określ nabywcę faktur i osoby odpowiedzialne za rozliczenie.",
                       action: edit, actionDisabled: billing.referralError != nil) {
            fact("Rozlicza") {
                Text(payer).font(.callout.weight(.medium)).textSelection(.enabled)
                Text(billing.arrangementLabel).font(.caption).foregroundStyle(.secondary)
                if direct, let buyer = billing.invoiceBuyer {
                    Text("Faktura: \(buyer.name)\(buyer.role == 8 ? " (JST)" : "") — klient jako odbiorca").font(.caption).foregroundStyle(.secondary)
                }
                if !direct && !billing.contacts.isEmpty {
                    Text("Kontakt: " + billing.contacts.map(\.name).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let error = billing.referralError {
                VStack(alignment: .leading, spacing: 4) {
                    Text(error).font(.caption).foregroundStyle(EventBillingText.warning)
                    Button("Odśwież sprzedawców") { reload() }.buttonStyle(.link).linkCursor().font(.caption)
                }
            } else if let referral = billing.referral {
                fact("Sprzedawca pozyskujący wydarzenie") {
                    Text(referral.label).font(.callout).textSelection(.enabled)
                    Text("Prowizja niezależna od nabywcy faktury — szczegóły poniżej.").font(.caption).foregroundStyle(.secondary)
                }
            }
            fact("Numer PO / zamówienia klienta") {
                if let number = billing.purchaseOrderNumber?.nonEmpty {
                    Text(number).font(.callout).textSelection(.enabled)
                } else {
                    Text("Nie podano — pole opcjonalne").font(.callout).foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: Wspólne rozliczenie

    private func settlementSection(_ data: EventBillingData) -> some View {
        let settlement = data.settlement
        let edit: (String, () -> Void)? = canEdit ? (settlement == nil ? "Połącz wydarzenia…" : "Edytuj powiązanie…", { sheet = .settlement }) : nil
        return section("Wspólne rozliczenie", symbol: "link",
                       subtitle: "Połącz osobne realizacje, gdy mają otrzymać jedną fakturę. Timeline, zespół, sprzęt i koszty pozostają oddzielne, a przychód faktury jest przypisywany do każdego wydarzenia.",
                       action: edit) {
            if let settlement {
                fact("Nazwa rozliczenia") { Text(settlement.name).font(.callout.weight(.medium)).textSelection(.enabled) }
                fact("Wydarzenia w rozliczeniu") {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(settlement.events) { item in settlementRow(item, primary: item.id == settlement.primaryEventId) }
                    }
                }
            } else {
                Text("To wydarzenie jest obecnie rozliczane samodzielnie.").font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    private func settlementRow(_ item: EventBillingData.SettlementEvent, primary: Bool) -> some View {
        let current = item.id == eventID
        return HStack(alignment: .top, spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                if current {
                    Text(item.name).font(.callout)
                } else {
                    Button(item.name) { state.showEvent(item.id) }.buttonStyle(.link).linkCursor().font(.callout).help("Otwórz wydarzenie")
                }
                Label(EventBillingText.day(item.date) + (current ? " · aktualne wydarzenie" : ""), systemImage: "calendar")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            if primary { chip("Główne", theme.accent) }
        }
        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Sprzedawcy i prowizje

    @ViewBuilder private func commissionsSection(_ data: EventBillingData) -> some View {
        let commissions = data.commissions
        let add: (String, () -> Void)? = data.canManageCommissions && commissions.available && commissions.error == nil
            ? ("Dodaj osobę…", { sheet = .commission(nil) }) : nil
        section("Sprzedawcy i prowizje", symbol: "person.2", action: add) {
            if !commissions.available {
                Text("Rozszerzony rejestr prowizji będzie dostępny po uruchomieniu najnowszej migracji bazy.").font(.caption).foregroundStyle(EventBillingText.warning)
            } else if let error = commissions.error {
                VStack(alignment: .leading, spacing: 4) {
                    Text(error).font(.caption).foregroundStyle(EventBillingText.warning)
                    Button("Odśwież") { reload() }.buttonStyle(.link).linkCursor().font(.caption)
                }
            } else {
                commissionsContent(data)
            }
        }
    }

    @ViewBuilder private func commissionsContent(_ data: EventBillingData) -> some View {
        let commissions = data.commissions
        Text("Prowizje automatyczne (sprzedawca wydarzenia, polecenie, kontakt rozliczeniowy, pośrednik, sprzedawca z portalu) liczy podsumowanie wydarzenia — kwota, podstawa i stawka zmieniają się tam. Tutaj dodasz sprzedawcę z kartoteki albo wpis ręczny w innych przypadkach.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if canOpenTab("summary") {
            Button("Wyliczenie: zakładka Podsumowanie") { navigate("summary") }.buttonStyle(.link).linkCursor().font(.caption)
        }
        if let notice = commissions.syncNotice?.nonEmpty {
            HStack(alignment: .top, spacing: 6) {
                Text(notice).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button("Odśwież") { reload() }.buttonStyle(.link).linkCursor().font(.caption)
            }
            .padding(8).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        }
        if commissions.rows.contains(where: { $0.status != "cancelled" }) { totals(commissions.totals) }
        Text("Wypłaty częściowe oraz daty i numery przelewów zapiszesz w Rozliczeniach prowizji. Poniżej są kwoty naliczeń, nie saldo pozostałe po wypłatach.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if commissions.rows.isEmpty {
            Label("Brak naliczonych prowizji dla tego wydarzenia.", systemImage: "banknote")
                .font(.caption).foregroundStyle(.secondary)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        }
        ForEach(commissions.rows) { commission in commissionRow(commission, data) }
        Label("Koszt gotówki jest kalkulacją zarządczą: kwota dla osoby jest ubruttawiana podaną stawką podatku od dywidendy. Księgowanie wypłaty nadal wymaga właściwego dokumentu i kwalifikacji księgowej.",
              systemImage: "function")
            .font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
    }

    private func totals(_ totals: EventBillingData.Totals) -> some View {
        VStack(spacing: 4) {
            totalRow("Do wypłaty osobom", totals.nominal, EventBillingText.violet)
            totalRow("Koszt dla spółki", totals.companyCost, EventBillingText.amber)
            totalRow("Narzut wypłat gotówkowych", totals.burden, .primary)
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func totalRow(_ label: String, _ value: Double, _ color: Color) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 6)
            Text(EventBillingText.money(value)).font(.callout.monospacedDigit()).foregroundStyle(color)
        }
    }

    private func commissionRow(_ commission: EventBillingData.Commission, _ data: EventBillingData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(commission.name).font(.callout.weight(.medium)).textSelection(.enabled)
                    Text("\(commission.typeLabel) · \(commission.paymentLabel)").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                if data.canManageCommissions && hasActions(commission) { actionsMenu(commission) }
            }
            if let base = commission.baseDescription?.nonEmpty { Text(base).font(.caption).foregroundStyle(.tertiary) }
            if commission.automatic { automaticBadges(commission) }
            if let reason = commission.rateReason?.nonEmpty { Text(reason).font(.caption).foregroundStyle(.tertiary) }
            if commission.status == "cancelled", let reason = commission.cancelReason?.nonEmpty {
                Text("Powód anulowania: \(reason)").font(.caption).foregroundStyle(.secondary)
            }
            if commission.ownerProfit { ownerProfit }
            amounts(commission)
            statusLine(commission)
            if let notes = commission.notes?.nonEmpty { Text("Notatka: \(notes)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
            if let target = commission.settlements {
                Button { state.openCRM(EventBillingText.settlementsPath(target)) } label: {
                    Label("Rozliczenia prowizji i historia wypłat", systemImage: "banknote")
                }
                .buttonStyle(.link).linkCursor().font(.caption)
                .help("Wypłaty częściowe, daty i numery przelewów — w CRM")
            }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func automaticBadges(_ commission: EventBillingData.Commission) -> some View {
        WrapLine(spacing: 5) {
            chip("Z podsumowania", theme.accent)
            if let source = commission.sourceLabel?.nonEmpty { chip(source, .secondary) }
            if let kind = commission.entryKindLabel?.nonEmpty {
                chip(kind, commission.entryKind == "deduction" ? CrmTheme.rgb(0xf43f5e) : CrmTheme.rgb(0x10b981))
            }
            if canOpenTab("summary") {
                Button("Wyliczenie: zakładka Podsumowanie") { navigate("summary") }.buttonStyle(.link).linkCursor().font(.caption2)
            }
        }
    }

    private var ownerProfit: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Opiekun · prowizja od zysku po kosztach i wynagrodzeniu sprzedawcy, nie od przychodu.").font(.caption).foregroundStyle(theme.accent)
            if canOpenTab("seller-arrangements") {
                Button("Otwórz kalkulację i podstawę prowizji") { navigate("seller-arrangements") }.buttonStyle(.link).linkCursor().font(.caption)
            }
        }
    }

    private func amounts(_ commission: EventBillingData.Commission) -> some View {
        let who = commission.ownerProfit && commission.paymentMethod == "payroll" ? "brutto pracownika" : "dla osoby"
        return VStack(alignment: .leading, spacing: 1) {
            Text(commission.waitingForOffer ? "Kwota: oczekuje na ofertę" : "\(who): \(EventBillingText.money(commission.amount))")
                .font(.callout.monospacedDigit()).foregroundStyle(EventBillingText.violet)
            Text("koszt spółki: \(EventBillingText.money(commission.companyCost))").font(.caption.monospacedDigit()).foregroundStyle(EventBillingText.amber)
        }
    }

    private func statusLine(_ commission: EventBillingData.Commission) -> some View {
        WrapLine(spacing: 6) {
            chip(commission.statusLabel, EventFinancesTab.commissionColor(commission.status))
            if commission.calculationType == "percent" {
                let rate = EventBillingText.number(commission.rate)
                Text(verbatim: commission.waitingForOffer ? "\(rate)% · podstawa netto nieustalona" : "\(rate)% od \(EventBillingText.money(commission.baseAmount)) netto")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if commission.dueDate?.isEmpty == false {
                Text("termin \(EventBillingText.day(commission.dueDate, empty: ""))").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Czynności prowizji (finanse / administrator)

    private func editable(_ commission: EventBillingData.Commission) -> Bool { commission.status != "paid" }

    private func hasActions(_ commission: EventBillingData.Commission) -> Bool {
        guard commission.automatic else { return true }
        let canEdit = editable(commission)
        return (canEdit && commission.status != "cancelled")
            || (canEdit && commission.entryKind == nil && (commission.status == "planned" || commission.status == "approved"))
            || (commission.entryKind == nil && commission.status == "cancelled" && !commission.autoCancelled)
    }

    private func actionsMenu(_ commission: EventBillingData.Commission) -> some View {
        let canEdit = editable(commission)
        return Menu {
            if commission.automatic {
                if canEdit && commission.status != "cancelled" {
                    Button("Termin i notatka…", systemImage: "pencil") { sheet = .commission(commission) }
                }
                if canEdit && commission.entryKind == nil && (commission.status == "planned" || commission.status == "approved") {
                    Button("Anuluj prowizję…", systemImage: "xmark.circle", role: .destructive) { cancelReason = ""; cancellingAutomatic = commission }
                }
                if commission.entryKind == nil && commission.status == "cancelled" && !commission.autoCancelled {
                    Button("Przywróć", systemImage: "arrow.uturn.backward") {
                        Task { await run("commissionRestore", ["id": .string(commission.id)], failure: "Nie udało się przywrócić prowizji. Odśwież dane.") }
                    }
                }
            } else {
                Section("Status") {
                    ForEach(EventBillingText.statuses, id: \.0) { status in
                        Button { setStatus(commission, status.0) } label: {
                            if status.0 == commission.status { Label(statusLabel(status, commission), systemImage: "checkmark") } else { Text(statusLabel(status, commission)) }
                        }
                    }
                }
                .disabled(commission.status == "paid")
                if canEdit && !commission.ownerProfit {
                    Divider()
                    Button("Edytuj…", systemImage: "pencil") { sheet = .commission(commission) }
                }
                if canEdit && commission.status != "cancelled" {
                    Button("Anuluj prowizję…", systemImage: "xmark.circle", role: .destructive) { cancellingManual = commission }
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .help("Czynności prowizji")
    }

    private func statusLabel(_ status: (String, String), _ commission: EventBillingData.Commission) -> String {
        status.0 == "paid" && commission.status != "paid" && commission.settlements != nil ? "Zapisz wypłatę w rozliczeniach…" : status.1
    }

    /// Lista statusu wpisu ręcznego (`handleStatusChange`): wypłatę z osobą w kartotece zapisuje się w rozliczeniach prowizji.
    private func setStatus(_ commission: EventBillingData.Commission, _ status: String) {
        guard status != commission.status else { return }
        if commission.status == "paid" {
            state.notice = "Wypłacona prowizja pozostaje w historii rozliczeń. Nie można cofnąć jej samą zmianą statusu."
            return
        }
        if commission.waitingForOffer && (status == "approved" || status == "paid") {
            state.notice = "Najpierw zaakceptuj ofertę lub zapisz ręcznie podstawę prowizji."
            return
        }
        if status == "paid", let target = commission.settlements {
            state.notice = "Zapisz wypłatę z rzeczywistą kwotą, datą i numerem przelewu w rozliczeniach prowizji."
            state.openCRM(EventBillingText.settlementsPath(target))
            return
        }
        Task { await run("commissionStatus", ["id": .string(commission.id), "status": .string(status)], failure: "Nie udało się zmienić statusu") }
    }

    private func cancelAutomatic(_ commission: EventBillingData.Commission) {
        let reason = cancelReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else { state.notice = "Podaj powód anulowania prowizji."; return }
        Task { await run("commissionCancel", ["id": .string(commission.id), "reason": .string(reason)], failure: "Nie udało się anulować prowizji.") }
    }

    @discardableResult private func run(_ action: String, _ body: [String: JSONValue], failure: String) async -> Bool {
        do {
            let reply = try await store.tabAction(eventID, "billing", action, body, reload: EventBillingText.reloads(store, eventID), success: nil)
            if let message = EventBillingText.reply(reply)?.message?.nonEmpty { state.succeed(message) }
            return true
        } catch {
            state.error = store.failureText(error, failure)
            return false
        }
    }
}

enum EventBillingSheet: Identifiable {
    case billing, settlement, commission(EventBillingData.Commission?)
    var id: String {
        switch self {
        case .billing: return "billing"
        case .settlement: return "settlement"
        case .commission(let commission): return "commission-\(commission?.id ?? "new")"
        }
    }
}

/// Karta „Rozliczenie i prowizje” w Szczegółach — skrót z kopii zakładki i przejście do panelu bocznego.
@MainActor struct EventBillingSummaryCard: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    var open: (() -> Void)?

    var body: some View {
        let data = store.tab(eventID, "billing", as: EventBillingData.self)
        TeamCard(title: "Rozliczenie i prowizje") {
            if let data {
                summary(data)
            } else {
                Text("Kto rozlicza i nabywca faktury, numer PO / zamówienia klienta, wspólne rozliczenie oraz sprzedawcy i prowizje.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            if let open {
                Button("Pokaż w panelu bocznym", systemImage: "sidebar.trailing") { open() }
                    .help("Rozliczenie i prowizje w panelu obok karty — widoczne przy każdej zakładce")
            }
        }
    }

    @ViewBuilder private func summary(_ data: EventBillingData) -> some View {
        let billing = data.billing
        let payer = billing.arrangement == "direct" ? billing.clientName?.nonEmpty ?? "Klient przypisany do wydarzenia"
            : billing.billingOrganizationName?.nonEmpty ?? "Nie wybrano organizacji"
        let active = data.commissions.rows.filter { $0.status != "cancelled" }
        VStack(alignment: .leading, spacing: 4) {
            Label("\(payer) · \(billing.arrangementLabel)", systemImage: "building.2")
            Label("Numer PO: " + (billing.purchaseOrderNumber?.nonEmpty ?? "nie podano"), systemImage: "number")
            if let referral = billing.referral { Label("Pozyskał: \(referral.label)", systemImage: "person.badge.shield.checkmark") }
            if let settlement = data.settlement {
                let count = settlement.events.count
                Label("Wspólne rozliczenie: \(settlement.name) (\(count) \(EventBillingText.plural(count, "wydarzenie", "wydarzenia", "wydarzeń")))", systemImage: "link")
            }
            if data.commissions.available && !active.isEmpty {
                Label("Prowizje: \(active.count) \(EventBillingText.plural(active.count, "pozycja", "pozycje", "pozycji")) · do wypłaty \(EventBillingText.money(data.commissions.totals.nominal))",
                      systemImage: "person.2")
            }
        }
        .font(.callout).foregroundStyle(.secondary)
    }
}
