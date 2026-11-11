import SwiftUI

// MARK: Finanse wydarzenia (1:1 z `EventFinancesTab` i `EventFinancialControls`): sposób rozliczenia i terminy płatności,
// zamknięcie wydarzenia, klient, podsumowanie, rentowność (plan / wykonanie, jakość danych), prowizje i polecenia, faktury,
// koszty i budżet gotówkowy. Wartości liczy serwer tak samo jak CRM. Wystawianie faktur — moduł Faktury (CRM).

struct FinancesTabData: Decodable {
    struct Access: Decodable { var canViewCosts: Bool; var canManageCosts: Bool; var canApproveCosts: Bool; var canPlanCommissions: Bool; var canApproveCommissions: Bool; var isAdmin: Bool }
    struct Client: Decodable { var type: String; var name: String; var nip: String?; var business: Bool; var canInvoice: Bool }
    struct Summary: Decodable { var expectedRevenue: Double; var actualRevenue: Double; var actualCosts: Double; var actualProfit: Double; var invoicesCount: Double; var invoicesPaid: Double; var costsCount: Double; var costsPaid: Double }
    struct Offer: Decodable { var gross: Double; var net: Double; var tax: Double; var taxPercent: Double }
    struct Result: Decodable { var expectedRevenue: Double; var actualRevenue: Double; var plannedTotal: Double; var actualTotal: Double; var plannedProfit: Double; var actualProfit: Double; var plannedMargin: Double; var actualMargin: Double }
    struct CostRow: Decodable, Hashable { var label: String; var planned: Double; var actual: Double; var color: String }
    struct Commission: Decodable, Identifiable, Hashable { var id: String; var type: String; var name: String; var calculation: String; var rate: Double; var amount: Double; var companyCost: Double; var status: String; var automatic: Bool }
    struct Invoice: Decodable, Identifiable, Hashable { var id: String; var number: String; var type: String; var status: String; var issueDate: String?; var gross: Double; var buyer: String; var arrangement: String?; var allocated: Double; var shared: Double }
    struct Cost: Decodable, Identifiable, Hashable { var id: String; var name: String; var description: String?; var amount: Double; var date: String?; var status: String; var category: String?; var color: String?; var subcontractor: String?; var createdBy: String }
    struct Category: Decodable, Identifiable, Hashable { var id: String; var name: String }
    struct Cash: Decodable, Identifiable, Hashable { var id: String; var date: String?; var amount: Double; var description: String; var income: Bool; var confirmed: Bool; var handledBy: String?; var notes: String? }
    struct Milestone: Decodable, Identifiable, Hashable {
        var id: String; var label: String; var type: String; var amount: Double; var dueDate: String?; var dueDays: Int?; var status: String
        var invoiceId: String?; var paidAmount: Double; var paidAt: String?; var notes: String?; var planMode: String?
    }
    struct Closeout: Decodable, Hashable {
        var id: String; var equipment_returned: Bool; var vehicles_returned: Bool; var damages_resolved: Bool; var subcontractors_settled: Bool
        var employee_time_approved: Bool; var client_balance_settled: Bool; var documents_archived: Bool; var completedAt: String?
        func value(_ key: String) -> Bool {
            switch key {
            case "equipment_returned": return equipment_returned
            case "vehicles_returned": return vehicles_returned
            case "damages_resolved": return damages_resolved
            case "subcontractors_settled": return subcontractors_settled
            case "employee_time_approved": return employee_time_approved
            case "client_balance_settled": return client_balance_settled
            default: return documents_archived
            }
        }
    }
    struct Controls: Decodable { var available: Bool; var milestones: [Milestone]; var closeout: Closeout?; var eventDay: String; var eventFinished: Bool; var acceptedTotal: Double?; var budgetError: String? }
    var access: Access; var client: Client?; var summary: Summary?; var offer: Offer?; var source: String; var calcName: String?
    var result: Result; var rows: [CostRow]; var issues: [String]; var commissionsAvailable: Bool; var salesperson: String?; var hasSalesCommission: Bool
    var automaticHint: String; var commissions: [Commission]; var invoices: [Invoice]; var costs: [Cost]; var categories: [Category]; var cash: [Cash]; var controls: Controls
}

enum FinanceText {
    /// `toLocaleString('pl-PL', { minimumFractionDigits: 2 })` + „ zł”.
    static func money(_ value: Double, fraction: Bool = true) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fraction ? 2 : 0
        formatter.maximumFractionDigits = fraction ? 2 : 3
        return (formatter.string(from: NSNumber(value: value)) ?? String(value)) + " zł"
    }
    static func day(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "—" }
        let parts = value.prefix(10).split(separator: "-")
        return parts.count == 3 ? "\(parts[2]).\(parts[1]).\(parts[0])" : value
    }
    static let costStatus: [String: (String, Color)] = [
        "pending": ("Oczekujący", CrmTheme.rgb(0xfacc15)), "approved": ("Zatwierdzony", CrmTheme.rgb(0x60a5fa)),
        "paid": ("Zapłacony", CrmTheme.rgb(0x4ade80)), "rejected": ("Odrzucony", CrmTheme.rgb(0xf87171)),
    ]
    static let beneficiaries = ["salesperson": "Sprzedawca", "hotel": "Hotel / sala", "partner": "Partner", "employee": "Pracownik", "other": "Inny"]
    static let commissionStatus = ["planned": "Planowana", "approved": "Zatwierdzona", "paid": "Wypłacona", "cancelled": "Anulowana"]
    static let milestoneStatus = ["planned": "Planowana", "invoiced": "Faktura wystawiona", "paid": "Opłacona", "overdue": "Po terminie", "waived": "Niewymagana"]
    static let planModes: [(String, String)] = [("advance_balance", "Zaliczka + płatność końcowa"), ("final_only", "Jedna płatność końcowa"), ("earnest_event", "Zadatek + dopłata w dniu uroczystości")]
    static let milestoneTypes: [(String, String)] = [("deposit", "Zaliczka"), ("installment", "Rata"), ("balance", "Płatność końcowa"), ("other", "Inna płatność")]
    static let closeoutItems: [(String, String)] = [
        ("equipment_returned", "Sprzęt został zwrócony i sprawdzony"), ("vehicles_returned", "Pojazdy zostały zdane"), ("damages_resolved", "Szkody i uwagi zostały rozliczone"),
        ("subcontractors_settled", "Podwykonawcy zostali rozliczeni"), ("employee_time_approved", "Czas pracy zespołu został zatwierdzony"),
        ("client_balance_settled", "Saldo klienta jest rozliczone"), ("documents_archived", "Dokumentacja została zamknięta"),
    ]
    static func milestoneColor(_ status: String) -> Color {
        switch status {
        case "paid": return CrmTheme.rgb(0x86efac)
        case "invoiced": return CrmTheme.rgb(0xc4b5fd)
        case "overdue": return CrmTheme.rgb(0xfca5a5)
        case "waived": return Color.secondary
        default: return CrmTheme.rgb(0x93c5fd)
        }
    }
    static func dayString(_ date: Date) -> String { MeetingDates.format(date, "yyyy-MM-dd") }
    static func dayDate(_ text: String) -> Date? {
        let parts = text.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        return MeetingDates.calendar.date(from: components)
    }
}

@MainActor struct EventFinancesTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    /// Przejście do innej zakładki tej samej karty (np. „Wyliczenie: zakładka Podsumowanie”).
    var navigate: ((String) -> Void)? = nil
    /// Sekcja zakładki „Rozliczenie” (nil — pełny widok finansów).
    var part: RozliczeniePart? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var showAddCost = false
    @State private var showAddCommission = false
    @State private var deletingCost: FinancesTabData.Cost?
    @State private var cancelling: FinancesTabData.Commission?
    @State private var cancelReason = ""

    private var data: FinancesTabData? { store.tab(eventID, "finances", as: FinancesTabData.self) }

    var body: some View {
        Group {
            if let data {
                if let part { partContent(data, part) } else { content(data) }
            } else if let error = store.tabErrors["\(eventID)|finances"] {
                ContentUnavailableView {
                    Label("Błąd podczas ładowania danych finansowych", systemImage: "banknote")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "finances") } } }
            } else if part != nil {
                ProgressView("Ładowanie danych finansowych...").controlSize(.small).frame(maxWidth: .infinity).padding(20)
            } else {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Ładowanie danych finansowych...").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "finances") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTab(eventID, "finances") } }
        .confirmationDialog("Czy na pewno chcesz usunąć ten koszt?", isPresented: Binding(get: { deletingCost != nil }, set: { if !$0 { deletingCost = nil } }), titleVisibility: .visible) {
            if let cost = deletingCost {
                Button("Usuń", role: .destructive) { Task { await act("deleteCost", ["id": .string(cost.id)], "Koszt został usunięty", "Błąd podczas usuwania kosztu") } }
            }
            Button("Anuluj", role: .cancel) { deletingCost = nil }
        }
        .alert("Anulować prowizję z podsumowania?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } })) {
            TextField("Powód anulowania", text: $cancelReason)
            Button("Anuluj prowizję", role: .destructive) {
                if let commission = cancelling {
                    let reason = cancelReason.trimmingCharacters(in: .whitespacesAndNewlines)
                    Task { await act("commissionStatus", ["id": .string(commission.id), "status": .string("cancelled"), "reason": .string(reason)], nil, "Nie udało się zmienić statusu prowizji") }
                }
            }
            Button("Wróć", role: .cancel) { cancelling = nil }
        } message: {
            Text("Anulowanie jest trwałe — zatwierdzenie podsumowania jej nie przywróci (możesz ją przywrócić ręcznie).")
        }
    }

    @discardableResult func act(_ action: String, _ body: [String: JSONValue], _ success: String?, _ failure: String) async -> Bool {
        do {
            try await store.tabAction(eventID, "finances", action, body, reload: ["finances"], success: success)
            return true
        } catch {
            state.error = store.failureText(error, failure)
            return false
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) { content() }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func chip(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption.weight(.semibold)).padding(.horizontal, 7).padding(.vertical, 3)
            .foregroundStyle(color).background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 5))
    }

    private func content(_ d: FinancesTabData) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if d.controls.available {
                    FinancePaymentsCard(store: store, eventID: eventID, data: d, act: act)
                    if d.controls.eventFinished || d.controls.closeout != nil { FinanceCloseoutCard(data: d, act: act) }
                }
                if let client = d.client { clientBanner(client) }
                if let summary = d.summary {
                    summaryCards(d, summary)
                    profitability(d)
                }
                if d.client?.canInvoice == true { invoices(d) }
                costs(d)
                if d.access.isAdmin && d.client?.type == "individual" { cash(d) }
                lossWarning(d)
            }
            .padding(18)
        }
    }

    @ViewBuilder private func lossWarning(_ d: FinancesTabData) -> some View {
        if let summary = d.summary, summary.actualProfit < 0 {
            Label("Uwaga: Event generuje stratę. Koszty przekraczają przychody o " + FinanceText.money(abs(summary.actualProfit)) + ". Rozważ optymalizację kosztów lub zwiększenie ceny usługi.",
                  systemImage: "exclamationmark.circle")
                .font(.callout).foregroundStyle(CrmTheme.rgb(0xfca5a5)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(CrmTheme.rgb(0xef4444).opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    /// Części finansów w zakładce „Rozliczenie” — w kolejności przepływu pieniędzy, bez powtórzeń z podsumowaniem.
    @ViewBuilder private func partContent(_ d: FinancesTabData, _ part: RozliczeniePart) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            switch part {
            case .revenue:
                if let client = d.client { clientBanner(client) }
                if d.controls.available { FinancePaymentsCard(store: store, eventID: eventID, data: d, act: act) }
                if d.client?.canInvoice == true { invoices(d) }
            case .costs:
                costs(d)
                if d.access.isAdmin && d.client?.type == "individual" { cash(d) }
            case .result:
                lossWarning(d)
                if let summary = d.summary { summaryCards(d, summary) }
                profitability(d, commissions: false)
            case .commissions:
                card { commissionsSection(d) }
            case .closing:
                if d.controls.available && (d.controls.eventFinished || d.controls.closeout != nil) { FinanceCloseoutCard(data: d, act: act) }
            }
        }
    }

    // MARK: Klient i podsumowanie

    private func clientBanner(_ client: FinancesTabData.Client) -> some View {
        let tint: Color = client.business ? CrmTheme.rgb(0x60a5fa) : CrmTheme.rgb(0xfacc15)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: client.business ? "building.2" : "person").foregroundStyle(tint)
                Text(client.business ? "Klient businessowy" : "Klient indywidualny").font(.callout.weight(.semibold))
                chip(client.canInvoice ? "Można wystawiać faktury" : "Brak możliwości fakturowania", client.canInvoice ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171))
            }
            HStack(spacing: 10) {
                Text(client.name).font(.callout)
                if let nip = client.nip { Text("NIP: " + nip).font(.caption).foregroundStyle(.secondary) }
            }
            if !client.business {
                Label("Dla klientów indywidualnych nie można wystawiać faktur VAT. Jeśli klient prowadzi działalność gospodarczą, oznacz go jako klienta businessowego i dodaj NIP.", systemImage: "info.circle")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if client.business && !client.canInvoice {
                Label("Klient nie ma uzupełnionego NIP. Dodaj NIP aby móc wystawiać faktury VAT.", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(CrmTheme.rgb(0xf87171))
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
    }

    private func tile<Content: View>(_ title: String, _ symbol: String, _ color: Color, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol).font(.caption).foregroundStyle(color)
            content()
        }
        .padding(14).frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func summaryCards(_ d: FinancesTabData, _ summary: FinancesTabData.Summary) -> some View {
        let profitColor: Color = d.result.actualProfit >= 0 ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171)
        return HStack(alignment: .top, spacing: 12) {
            tile("Przychód planowany", "chart.line.uptrend.xyaxis", CrmTheme.rgb(0x60a5fa)) {
                if d.source == "calculation", let name = d.calcName { Label("Źródło: kalkulacja „" + name + "”", systemImage: "function").font(.caption2).foregroundStyle(.secondary) }
                if let offer = d.offer {
                    Text(FinanceText.money(offer.gross)).font(.title3.weight(.light))
                    Text("Netto: " + FinanceText.money(offer.net)).font(.caption).foregroundStyle(.secondary)
                    Text("VAT (" + String(Int(offer.taxPercent)) + "%): " + FinanceText.money(offer.tax)).font(.caption).foregroundStyle(.secondary)
                    Text("Brutto: " + FinanceText.money(offer.gross)).font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(FinanceText.money(summary.expectedRevenue)).font(.title3.weight(.light))
                }
                if summary.actualRevenue > 0 { Text("Zapłacono: " + FinanceText.money(summary.actualRevenue)).font(.caption).foregroundStyle(CrmTheme.rgb(0x4ade80)) }
            }
            tile("Koszty faktyczne", "chart.line.downtrend.xyaxis", CrmTheme.rgb(0xf87171)) {
                Text(FinanceText.money(d.result.actualTotal)).font(.title3.weight(.light))
                Text("Plan: " + FinanceText.money(d.result.plannedTotal)).font(.caption).foregroundStyle(.secondary)
            }
            tile("Zysk faktyczny", "dollarsign.circle", profitColor) {
                Text(FinanceText.money(d.result.actualProfit)).font(.title3.weight(.light)).foregroundStyle(profitColor)
                Text("Marża: " + String(format: "%.2f", d.result.actualMargin) + "%").font(.caption).foregroundStyle(.secondary)
            }
            tile("Bilans", "doc.plaintext", theme.accent) {
                if d.client?.canInvoice == true { Text("Faktury: \(Int(summary.invoicesCount)) (\(Int(summary.invoicesPaid)) opłacone)").font(.caption) }
                Text("Koszty: \(Int(summary.costsCount)) (\(Int(summary.costsPaid)) zapłacone)").font(.caption)
            }
        }
    }

    // MARK: Rentowność

    private func profitability(_ d: FinancesTabData, commissions: Bool = true) -> some View {
        let maximum = max(d.rows.map { Swift.max($0.planned, $0.actual) }.max() ?? 1, 1)
        let status: String = d.issues.isEmpty ? "Dane kompletne" : "\(d.issues.count) elementów do uzupełnienia"
        return card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Rentowność wydarzenia", systemImage: "chart.bar").font(.headline)
                    Text("Plan korzysta z zaakceptowanej oferty i kosztów przewidywanych. Wykonanie korzysta z zatwierdzonych kosztów, czasu pracy, zakończonych zleceń podwykonawców i faktycznych wpływów.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                chip(status, d.issues.isEmpty ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xfacc15))
            }
            HStack(spacing: 12) {
                metric("Przychód", FinanceText.money(d.result.expectedRevenue, fraction: false), "Wpływy: " + FinanceText.money(d.result.actualRevenue, fraction: false), Color.primary)
                metric("Wszystkie koszty", FinanceText.money(d.result.plannedTotal, fraction: false), "Poniesione: " + FinanceText.money(d.result.actualTotal, fraction: false), Color.primary)
                metric("Prognozowany wynik", FinanceText.money(d.result.plannedProfit, fraction: false), "Marża " + String(format: "%.1f", d.result.plannedMargin).replacingOccurrences(of: ".", with: ",") + "%",
                       d.result.plannedProfit >= 0 ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171))
                metric("Wynik faktyczny", FinanceText.money(d.result.actualProfit, fraction: false), "Marża " + String(format: "%.1f", d.result.actualMargin).replacingOccurrences(of: ".", with: ",") + "%",
                       d.result.actualProfit >= 0 ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171))
            }
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(d.rows, id: \.label) { row in bar(row, maximum) }
                    HStack(spacing: 14) {
                        Label("Plan", systemImage: "square.fill").foregroundStyle(Color.secondary.opacity(0.5))
                        Label("Wykonanie", systemImage: "square.fill").foregroundStyle(Color.secondary)
                    }
                    .font(.caption2)
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Jakość kalkulacji").font(.callout.weight(.semibold))
                    if d.issues.isEmpty {
                        Text("Najważniejsze źródła kosztów mają kompletne wartości.").font(.caption).foregroundStyle(CrmTheme.rgb(0x4ade80))
                    } else {
                        ForEach(d.issues, id: \.self) { issue in Label(issue, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
                    }
                    Text("Kwoty bez kompletnego źródła są wskazywane jako brak danych. Dzięki temu późniejsza analiza AI otrzyma fakty, a nie wartości domyślne udające rzeczywiste koszty.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(12).frame(width: 320, alignment: .topLeading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
            if commissions { commissionsSection(d) }
        }
    }

    private func metric(_ title: String, _ value: String, _ detail: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.light)).foregroundStyle(color)
            Text(detail).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func bar(_ row: FinancesTabData.CostRow, _ maximum: Double) -> some View {
        let color = CrmTheme.rgb(Int(row.color, radix: 16) ?? 0xd3bb73)
        let planned = row.planned > 0 ? max(row.planned / maximum, 0.02) : 0
        let actual = row.actual > 0 ? max(row.actual / maximum, 0.02) : 0
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(row.label).font(.caption)
                Spacer()
                Text("plan " + FinanceText.money(row.planned, fraction: false) + " · wykonanie " + FinanceText.money(row.actual, fraction: false)).font(.caption2).foregroundStyle(.secondary)
            }
            GeometryReader { geo in
                VStack(alignment: .leading, spacing: 3) {
                    Capsule().fill(color.opacity(0.4)).frame(width: geo.size.width * planned, height: 6)
                    Capsule().fill(color).frame(width: geo.size.width * actual, height: 6)
                }
            }
            .frame(height: 15)
        }
    }

    // MARK: Prowizje i polecenia

    @ViewBuilder private func commissionsSection(_ d: FinancesTabData) -> some View {
        let canAdd = (d.access.isAdmin || d.access.canPlanCommissions) && d.commissionsAvailable
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Prowizje i polecenia").font(.callout.weight(.semibold))
                    Text("Sprzedawcy, hotele, sale, partnerzy i pozostali beneficjenci.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if canAdd { Button { showAddCommission.toggle() } label: { Label("Dodaj prowizję", systemImage: "plus") } }
            }
            if !d.commissionsAvailable {
                Text("Rejestr prowizji będzie dostępny po uruchomieniu migracji `20260831170000_create_event_commissions_for_profitability.sql`.").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
            }
            if showAddCommission && d.commissionsAvailable {
                FinanceCommissionForm(canApprove: d.access.canApproveCommissions) { body in
                    if await act("addCommission", body, "Prowizja została dodana do rentowności wydarzenia", "Nie udało się zapisać prowizji") { showAddCommission = false }
                }
            }
            if !d.hasSalesCommission, let salesperson = d.salesperson {
                HStack {
                    Text(salesperson).font(.callout)
                    Text("autor oferty / sprzedawca").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    chip("uzupełnij prowizję", CrmTheme.rgb(0xfacc15))
                }
                .padding(10).background(CrmTheme.rgb(0xfacc15).opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            }
            ForEach(d.commissions) { commission in commissionRow(commission, d) }
            if d.commissionsAvailable && d.commissions.isEmpty && d.salesperson == nil {
                Text("Brak zarejestrowanych prowizji.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.top, 6)
    }

    private func commissionRow(_ c: FinancesTabData.Commission, _ d: FinancesTabData) -> some View {
        let approve = d.access.isAdmin || d.access.canApproveCommissions
        let rateText: String = c.rate == c.rate.rounded() ? String(Int(c.rate)) : String(c.rate)
        let ratePart: String = c.calculation == "percent" ? rateText + "% · " : ""
        let costPart: String = c.companyCost > c.amount ? " · koszt spółki " + FinanceText.money(c.companyCost, fraction: false) : ""
        let detail: String = ratePart + "dla osoby " + FinanceText.money(c.amount, fraction: false) + costPart
        let kind: String = (FinanceText.beneficiaries[c.type] ?? "Inny") + " · " + (FinanceText.commissionStatus[c.status] ?? "Nie określono")
        return VStack(alignment: .leading, spacing: 4) {
            if c.automatic {
                HStack(spacing: 6) {
                    Text("Z podsumowania wydarzenia · " + d.automaticHint.lowercased() + " ·").font(.caption2).foregroundStyle(.secondary)
                    Button("Wyliczenie: zakładka Podsumowanie") { if let navigate { navigate("summary") } else { state.showEvent(eventID, cardTab: "summary") } }.buttonStyle(.link).font(.caption2)
                    Spacer()
                    if approve && (c.status == "planned" || c.status == "approved") { Button("Anuluj") { cancelReason = ""; cancelling = c }.controlSize(.small) }
                    if approve && c.status == "cancelled" {
                        Button("Przywróć") { Task { await act("commissionStatus", ["id": .string(c.id), "status": .string("planned")], nil, "Nie udało się zmienić statusu prowizji") } }.controlSize(.small)
                    }
                }
            }
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.name).font(.callout.weight(.medium))
                    Text(kind).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(detail).font(.caption).foregroundStyle(.secondary)
                if d.access.isAdmin && !c.automatic {
                    Picker("", selection: Binding(get: { c.status }, set: { value in
                        Task { await act("commissionStatus", ["id": .string(c.id), "status": .string(value)], nil, "Nie udało się zmienić statusu prowizji") }
                    })) {
                        Text("Planowana").tag("planned")
                        Text("Zatwierdzona").tag("approved")
                        Text("Wypłacona").tag("paid")
                    }
                    .labelsHidden().frame(width: 130)
                    Button { Task { await act("deleteCommission", ["id": .string(c.id)], "Prowizja została usunięta", "Nie udało się usunąć prowizji") } } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).foregroundStyle(.red)
                }
                if !d.access.isAdmin && d.access.canPlanCommissions && c.status == "planned" && !c.automatic {
                    Button { Task { await act("deleteCommission", ["id": .string(c.id)], "Prowizja została usunięta", "Nie udało się usunąć prowizji") } } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).foregroundStyle(.red).help("Usuń planowaną prowizję")
                }
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Faktury

    private func invoices(_ d: FinancesTabData) -> some View {
        card {
            HStack {
                Label("Faktury (\(d.invoices.count))", systemImage: "doc.text").font(.headline)
                Spacer()
                if d.invoices.contains(where: { $0.type == "advance" }) {
                    Button { state.openCRM("/crm/events/\(eventID)?tab=finances") } label: { Label("Wystaw fakturę końcową", systemImage: "doc.text") }
                        .help("Kreator faktury końcowej otworzy się w CRM.")
                }
                Button { state.openCRM("/crm/invoices/new?event=\(eventID)") } label: { Label("Wystaw fakturę", systemImage: "plus") }.buttonStyle(.borderedProminent)
            }
            if d.invoices.isEmpty {
                Text("Brak faktur dla tego eventu").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(20)
            } else {
                VStack(spacing: 0) {
                    FinanceListHeader(columns: [("Lp.", 28, .trailing), ("Numer", nil, .leading), ("Typ", 90, .leading), ("Nabywca", 170, .leading),
                                                ("Data", 84, .leading), ("Status", 120, .leading), ("Kwota brutto", 120, .trailing), ("", 28, .center)])
                    ForEach(Array(d.invoices.enumerated()), id: \.element.id) { item in invoiceRow(item.element, item.offset) }
                }
            }
        }
    }

    /// Wiersz faktury jak w natywnej tabeli: Lp., numer, typ, nabywca, data, status (kropka), kwota; dwuklik otwiera fakturę.
    private func invoiceRow(_ invoice: FinancesTabData.Invoice, _ index: Int) -> some View {
        let status = FinanceText.costStatus[invoice.status] ?? FinanceText.costStatus["pending"]!
        let payer: String? = invoice.arrangement == nil || invoice.arrangement == "direct" ? nil
            : (invoice.arrangement == "hotel" ? "Płatność przez hotel" : (invoice.arrangement == "agency" ? "Płatność przez agencję" : "Płatność przez inną organizację"))
        let shared: String? = invoice.shared > 1 ? "Wspólna · \(Int(invoice.shared)) wydarzenia · udział wydarzenia: " + FinanceText.money(invoice.allocated) : nil
        return HStack(spacing: 10) {
            Text("\(index + 1)").monospacedDigit().foregroundStyle(.secondary).frame(width: 28, alignment: .trailing)
            HStack(spacing: 6) {
                Image(systemName: "doc.text").foregroundStyle(.secondary)
                Text(invoice.number).fontWeight(.medium).lineLimit(1)
                if shared != nil { Image(systemName: "square.on.square").font(.caption).foregroundStyle(theme.accent) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .help(shared ?? invoice.number)
            Text(invoice.type).foregroundStyle(.secondary).lineLimit(1).frame(width: 90, alignment: .leading)
            Text(invoice.buyer).lineLimit(1).frame(width: 170, alignment: .leading).help(payer.map { invoice.buyer + " · " + $0 } ?? invoice.buyer)
            Text(FinanceText.day(invoice.issueDate)).monospacedDigit().foregroundStyle(.secondary).frame(width: 84, alignment: .leading)
            EventDotLabel(label: status.0, color: status.1).frame(width: 120, alignment: .leading)
            Text(FinanceText.money(invoice.gross)).monospacedDigit().fontWeight(.medium).frame(width: 120, alignment: .trailing)
            Menu {
                Button("Otwórz fakturę", systemImage: "doc.text.magnifyingglass") { openInvoice(invoice.id) }
            } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().frame(width: 28)
        }
        .font(.callout)
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(index % 2 == 0 ? Color.primary.opacity(0.035) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { openInvoice(invoice.id) }
        .contextMenu { Button("Otwórz fakturę", systemImage: "doc.text.magnifyingglass") { openInvoice(invoice.id) } }
    }

    private func openInvoice(_ id: String) {
        if state.native.meta("invoices") != nil || state.native.records["invoices"] != nil { state.showNative("invoices", focus: id) }
        else { state.openCRM("/crm/invoices/\(id)") }
    }

    // MARK: Koszty

    private func costs(_ d: FinancesTabData) -> some View {
        card {
            HStack {
                Label("Koszty (\(d.costs.count))", systemImage: "doc.plaintext").font(.headline)
                Spacer()
                if d.access.canManageCosts { Button { showAddCost.toggle() } label: { Label("Dodaj koszt", systemImage: "plus") }.buttonStyle(.borderedProminent) }
            }
            if showAddCost {
                FinanceCostForm(categories: d.categories, canApprove: d.access.canApproveCosts) { body in
                    if await act("addCost", body, "Koszt został dodany", "Błąd podczas dodawania kosztu") { showAddCost = false }
                } cancel: { showAddCost = false }
            }
            if d.costs.isEmpty {
                Text(d.access.canViewCosts ? "Brak kosztów dla tego eventu" : "Koszty tego wydarzenia widzi księgowość i opiekun sprzedaży. Marża poniżej może nie uwzględniać wszystkich kosztów.")
                    .font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(20)
            }
            if !d.costs.isEmpty {
                VStack(spacing: 0) {
                    FinanceListHeader(columns: [("Lp.", 28, .trailing), ("Koszt", nil, .leading), ("Kategoria", 140, .leading), ("Data", 84, .leading),
                                                ("Status", 120, .leading), ("Kwota", 110, .trailing), ("", 28, .center)])
                    ForEach(Array(d.costs.enumerated()), id: \.element.id) { item in costRow(item.element, d, item.offset) }
                }
            }
        }
    }

    /// Wiersz kosztu jak w natywnej tabeli: kolor kategorii, nazwa, kategoria, data, status (kropka), kwota; czynności w „…” i pod prawym przyciskiem.
    private func costRow(_ cost: FinancesTabData.Cost, _ d: FinancesTabData, _ index: Int) -> some View {
        let status = FinanceText.costStatus[cost.status] ?? FinanceText.costStatus["pending"]!
        let color = CrmTheme.rgb(Int((cost.color ?? "#d3bb73").replacingOccurrences(of: "#", with: ""), radix: 16) ?? 0xd3bb73)
        var details: [String] = [cost.name]
        if let description = cost.description?.nonEmpty { details.append(description) }
        if let subcontractor = cost.subcontractor { details.append("Podwykonawca: " + subcontractor) }
        details.append("Dodane przez: " + cost.createdBy)
        let tooltip = details.joined(separator: "\n")
        return HStack(spacing: 10) {
            Text("\(index + 1)").monospacedDigit().foregroundStyle(.secondary).frame(width: 28, alignment: .trailing)
            HStack(spacing: 7) {
                Circle().fill(color).frame(width: 8, height: 8)
                Text(cost.name).fontWeight(.medium).lineLimit(1)
                if let subcontractor = cost.subcontractor { Text(subcontractor).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .help(tooltip)
            Text(cost.category ?? "—").foregroundStyle(.secondary).lineLimit(1).frame(width: 140, alignment: .leading)
            Text(FinanceText.day(cost.date)).monospacedDigit().foregroundStyle(.secondary).frame(width: 84, alignment: .leading)
            EventDotLabel(label: status.0, color: status.1).frame(width: 120, alignment: .leading)
            Text(FinanceText.money(cost.amount)).monospacedDigit().fontWeight(.semibold).frame(width: 110, alignment: .trailing)
            Menu { costMenu(cost, d) } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().frame(width: 28)
        }
        .font(.callout)
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(index % 2 == 0 ? Color.primary.opacity(0.035) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .contextMenu { costMenu(cost, d) }
    }

    @ViewBuilder private func costMenu(_ cost: FinancesTabData.Cost, _ d: FinancesTabData) -> some View {
        let canDelete = d.access.canApproveCosts || (d.access.canManageCosts && cost.status == "pending")
        let next: String = cost.status == "pending" ? "approved" : "paid"
        let nextTitle: String = cost.status == "pending" ? "Zatwierdź koszt" : "Oznacz jako zapłacony"
        if d.access.canApproveCosts && cost.status != "paid" {
            Button(nextTitle, systemImage: "checkmark") {
                Task { await act("costStatus", ["id": .string(cost.id), "status": .string(next)], "Status kosztu został zaktualizowany", "Błąd podczas aktualizacji statusu") }
            }
        }
        if canDelete {
            Button("Usuń koszt", systemImage: "trash", role: .destructive) { deletingCost = cost }
        }
        if !canDelete && !(d.access.canApproveCosts && cost.status != "paid") {
            Text("Brak dostępnych czynności")
        }
    }

    // MARK: Budżet gotówkowy

    private func cash(_ d: FinancesTabData) -> some View {
        card {
            HStack {
                Label("Budżet gotówkowy (\(d.cash.count))", systemImage: "dollarsign.circle").font(.headline)
                chip("Tylko dla admina", CrmTheme.rgb(0xfacc15))
                Spacer()
            }
            if let summary = d.summary {
                HStack(spacing: 12) {
                    metric("Budżet z oferty", FinanceText.money(summary.expectedRevenue), "Planowany przychód", Color.primary)
                    metric("Koszty", FinanceText.money(summary.actualCosts), "Poniesione wydatki", Color.primary)
                    metric("Łączny przychód", FinanceText.money(summary.expectedRevenue - summary.actualCosts), "Budżet - Koszty",
                           summary.expectedRevenue - summary.actualCosts >= 0 ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171))
                }
            }
            if d.cash.isEmpty { Text("Brak transakcji gotówkowych").font(.callout).foregroundStyle(.secondary) }
            ForEach(d.cash) { transaction in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text((transaction.income ? "+ " : "- ") + FinanceText.money(transaction.amount)).font(.callout.weight(.medium))
                            .foregroundStyle(transaction.income ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xf87171))
                        chip(transaction.confirmed ? "Potwierdzone" : "Oczekuje", transaction.confirmed ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0xfacc15))
                        Text(FinanceText.day(transaction.date)).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(transaction.description).font(.callout)
                    if let who = transaction.handledBy { Text("Obsłużone przez: " + who).font(.caption).foregroundStyle(.secondary) }
                    if let notes = transaction.notes { Text("Notatka: " + notes).font(.caption).foregroundStyle(.secondary) }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            Label("Budżet gotówkowy jest widoczny tylko dla administratorów i służy do księgowania rozliczeń gotówkowych z klientami indywidualnymi. Transakcje są zapisywane na subkoncie GOTÓWKA.",
                  systemImage: "info.circle").font(.caption).foregroundStyle(.secondary)
        }
    }
}

// MARK: Formularze kosztu i prowizji

@MainActor private struct FinanceCostForm: View {
    let categories: [FinancesTabData.Category]
    let canApprove: Bool
    let save: ([String: JSONValue]) async -> Void
    let cancel: () -> Void
    @State private var name = ""
    @State private var category = ""
    @State private var amount = 0.0
    @State private var date = Date()
    @State private var status = "pending"
    @State private var details = ""
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Nazwa * — np. Paliwo - dojazd do eventu", text: $name).textFieldStyle(.roundedBorder)
                Picker("Kategoria *", selection: $category) {
                    Text("Wybierz kategorię...").tag("")
                    ForEach(categories) { Text($0.name).tag($0.id) }
                }
                .frame(width: 260)
            }
            HStack {
                TextField("Kwota (PLN) *", value: $amount, format: .number).textFieldStyle(.roundedBorder).frame(width: 160)
                DatePicker("Data kosztu", selection: $date, displayedComponents: .date).frame(width: 220)
                if canApprove {
                    Picker("Status", selection: $status) {
                        Text("Oczekujący").tag("pending")
                        Text("Zatwierdzony").tag("approved")
                        Text("Zapłacony").tag("paid")
                    }
                    .frame(width: 200)
                }
            }
            TextField("Opis — dodatkowe informacje...", text: $details, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            HStack {
                Button { Task { await submit() } } label: { Label("Zapisz", systemImage: "checkmark") }.buttonStyle(.borderedProminent).disabled(saving)
                Button { cancel() } label: { Label("Anuluj", systemImage: "xmark") }
            }
        }
        .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func submit() async {
        saving = true
        await save([
            "name": .string(name), "categoryId": .string(category), "amount": .number(amount), "date": .string(FinanceText.dayString(date)),
            "status": .string(status), "description": .string(details), "paymentMethod": .string("transfer"),
        ])
        saving = false
    }
}

@MainActor private struct FinanceCommissionForm: View {
    let canApprove: Bool
    let save: ([String: JSONValue]) async -> Void
    @State private var type = "hotel"
    @State private var name = ""
    @State private var calculation = "percent"
    @State private var value = 0.0
    @State private var saving = false

    var body: some View {
        HStack {
            Picker("", selection: $type) {
                Text("Sprzedawca").tag("salesperson")
                Text("Hotel / sala").tag("hotel")
                Text("Partner").tag("partner")
                Text("Pracownik").tag("employee")
                Text("Inny").tag("other")
            }
            .labelsHidden().frame(width: 140)
            TextField("Nazwa lub osoba", text: $name).textFieldStyle(.roundedBorder)
            Picker("", selection: $calculation) {
                Text("Procent przychodu").tag("percent")
                Text("Stała kwota").tag("fixed")
            }
            .labelsHidden().frame(width: 170)
            TextField(calculation == "percent" ? "Procent" : "Kwota", value: $value, format: .number).textFieldStyle(.roundedBorder).frame(width: 100)
            Button("Zapisz") {
                Task {
                    saving = true
                    await save([
                        "type": .string(type), "name": .string(name), "calculation": .string(calculation),
                        "rate": .number(calculation == "percent" ? value : 0), "amount": .number(calculation == "percent" ? 0 : value), "status": .string("planned"),
                    ])
                    saving = false
                }
            }
            .buttonStyle(.borderedProminent).disabled(saving)
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Sposób rozliczenia (`EventFinancialControls`)

@MainActor private struct FinancePaymentsCard: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let data: FinancesTabData
    let act: (String, [String: JSONValue], String?, String) async -> Bool
    @Environment(\.crmTheme) private var theme
    @State private var planOpen = false
    @State private var planMode = "advance_balance"
    @State private var firstAmount = ""
    @State private var firstPercent = ""
    @State private var firstDate = Date()
    @State private var finalDays = "14"
    @State private var showForm = false
    @State private var label = "Zaliczka"
    @State private var type = "deposit"
    @State private var amount = 0.0
    @State private var due = Date()
    @State private var invoice = ""
    @State private var notes = ""
    @State private var deleting: FinancesTabData.Milestone?

    private var controls: FinancesTabData.Controls { data.controls }
    private var canManage: Bool { data.access.isAdmin }
    private var locked: Bool { controls.milestones.contains { $0.paidAmount > 0 || $0.paidAt != nil || $0.invoiceId != nil || $0.status == "paid" } }
    private var expected: Double { controls.milestones.filter { $0.status != "waived" }.reduce(0) { $0 + $1.amount } }
    private var paid: Double { controls.milestones.reduce(0) { $0 + $1.paidAmount } }
    private var overdue: Double { controls.milestones.filter { $0.status == "overdue" }.reduce(0) { $0 + max($1.amount - $1.paidAmount, 0) } }
    private var currentMode: String? { controls.milestones.first { $0.planMode != nil }?.planMode }
    private var firstValue: Double { Double(firstAmount.replacingOccurrences(of: ",", with: ".")) ?? 0 }

    var body: some View {
        let modeTitle: String = currentMode.flatMap { mode in FinanceText.planModes.first { $0.0 == mode }?.1 } ?? (controls.milestones.isEmpty ? "Ustal sposób rozliczenia" : "Indywidualne terminy płatności")
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Sposób rozliczenia", systemImage: "dollarsign.circle").font(.headline)
                    Text("Ustal, kiedy klient płaci. Wystawienie faktury nie oznacza otrzymania pieniędzy. Kwoty brutto.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if canManage { Button { showForm.toggle() } label: { Label("Dodaj płatność", systemImage: "plus") } }
            }
            Text(modeTitle).font(.callout.weight(.semibold))
            if let total = controls.acceptedTotal { Text("Zaakceptowana kwota: " + FinanceText.money(total) + " brutto").font(.callout) }
            if let error = controls.budgetError { Text(error).font(.caption).foregroundStyle(.red) }
            if controls.acceptedTotal == nil && controls.budgetError == nil {
                Text("Zaakceptuj ofertę lub kalkulację, aby automatycznie wyliczyć płatności.").font(.caption).foregroundStyle(.secondary)
            }
            if let total = controls.acceptedTotal, !controls.milestones.isEmpty, abs(expected - total) > 0.01 {
                Text("Suma zaplanowanych płatności różni się od aktualnej zaakceptowanej kwoty. Sprawdź rozliczenie — zapisane wpłaty nie są zmieniane automatycznie.")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
            }
            if canManage && !planOpen {
                Button(controls.milestones.isEmpty ? "Ustal sposób rozliczenia" : "Zmień sposób rozliczenia") { openPlan() }
                    .disabled(controls.acceptedTotal == nil || locked)
            }
            if canManage && locked {
                Text("Rozliczenie ma już wpłatę lub powiązaną fakturę. Zmiana całego schematu jest zablokowana, aby zachować historię.").font(.caption).foregroundStyle(.secondary)
            }
            if controls.milestones.contains(where: { $0.planMode == "earnest_event" && $0.type == "balance" && $0.dueDate != controls.eventDay }) {
                Text("Termin wydarzenia zmienił się po zapisaniu rozliczenia. Zaktualizuj termin dopłaty.").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
            }
            if planOpen { planEditor }
            if showForm { milestoneForm }
            HStack(spacing: 12) {
                total("Plan", FinanceText.money(expected, fraction: false))
                total("Zapłacono", FinanceText.money(paid, fraction: false))
                total("Po terminie", FinanceText.money(overdue, fraction: false))
            }
            if controls.milestones.isEmpty {
                Text("Nie ustalono sposobu rozliczenia. Nie blokuje to przygotowania wydarzenia.").font(.callout).foregroundStyle(.secondary)
            }
            ForEach(controls.milestones) { item in milestoneRow(item) }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .confirmationDialog("Usunąć ten termin płatności?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let item = deleting { Button("Usuń", role: .destructive) { Task { _ = await act("deleteMilestone", ["id": .string(item.id)], nil, "Nie udało się usunąć płatności") } } }
            Button("Anuluj", role: .cancel) { deleting = nil }
        }
    }

    private func total(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold).monospacedDigit())
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func openPlan() {
        let first = controls.milestones.first { $0.type == "deposit" }
        planMode = currentMode ?? (first != nil ? "advance_balance" : (controls.milestones.isEmpty ? "advance_balance" : "final_only"))
        firstAmount = first.map { String($0.amount) } ?? ""
        firstPercent = ""
        firstDate = first?.dueDate.flatMap { FinanceText.dayDate($0) } ?? Date()
        finalDays = String(controls.milestones.first { $0.type == "balance" }?.dueDays ?? 14)
        planOpen = true
    }

    private var planEditor: some View {
        let total = controls.acceptedTotal ?? 0
        let earnest = planMode == "earnest_event"
        let rest = max(0, ((total - (planMode == "final_only" ? 0 : firstValue)) * 100).rounded() / 100)
        let eventDay: String = controls.eventDay.isEmpty ? "Ustal datę wydarzenia" : FinanceText.day(controls.eventDay)
        return VStack(alignment: .leading, spacing: 8) {
            Picker("Sposób rozliczenia", selection: $planMode) { ForEach(FinanceText.planModes, id: \.0) { Text($0.1).tag($0.0) } }.frame(width: 420)
            if planMode != "final_only" {
                HStack {
                    TextField("Kwota " + (earnest ? "zadatku" : "zaliczki") + " brutto", text: Binding(get: { firstAmount }, set: { firstAmount = $0; firstPercent = "" }))
                        .textFieldStyle(.roundedBorder).frame(width: 200)
                    TextField((earnest ? "Zadatek" : "Zaliczka") + " (%)", text: Binding<String>(get: {
                        if !firstPercent.isEmpty { return firstPercent }
                        guard total > 0, !firstAmount.trimmingCharacters(in: .whitespaces).isEmpty else { return "" }
                        return String((firstValue / total * 100 * 100).rounded() / 100)
                    }, set: { value in
                        firstPercent = value
                        let percent = Double(value.replacingOccurrences(of: ",", with: ".")) ?? 0
                        firstAmount = value.isEmpty || total <= 0 ? "" : String((total * percent / 100 * 100).rounded() / 100)
                    }))
                    .textFieldStyle(.roundedBorder).frame(width: 120).disabled(total <= 0).help("Procent zaakceptowanej kwoty brutto")
                    DatePicker("Termin " + (earnest ? "zadatku" : "zaliczki"), selection: $firstDate, displayedComponents: .date)
                }
                Text("Procent jest liczony od zaakceptowanej kwoty brutto. Zmiana kwoty lub procentu przelicza drugie pole.").font(.caption2).foregroundStyle(.secondary)
            }
            if earnest {
                Text("Dopłata w dniu uroczystości: " + eventDay).font(.callout)
            } else {
                HStack {
                    Text("Termin płatności końcowej — dni od wystawienia faktury")
                    TextField("14", text: $finalDays).textFieldStyle(.roundedBorder).frame(width: 70)
                }
                Text("0 oznacza płatność w dniu wystawienia faktury. Data zostanie wyliczona po powiązaniu wystawionej faktury.").font(.caption2).foregroundStyle(.secondary)
            }
            Text((planMode == "final_only" ? "Do zapłaty" : "Dopłata") + ": " + FinanceText.money(rest) + " brutto").font(.callout.weight(.semibold))
            Text((earnest ? "Dopłata przypada w dniu rozpoczęcia wydarzenia. " : "") + "Wystawiona faktura zostanie powiązana automatycznie, jeśli jej typ i kwota jednoznacznie pasują do płatności. Zapis zastępuje dotychczasowe nieopłacone terminy bez faktur.")
                .font(.caption2).foregroundStyle(.secondary)
            HStack {
                Button("Zapisz rozliczenie") {
                    Task {
                        if await act("setPlan", ["mode": .string(planMode), "firstAmount": .string(firstAmount), "firstDate": .string(FinanceText.dayString(firstDate)), "finalDays": .string(finalDays)],
                                     "Zapisano sposób rozliczenia i terminy płatności.", "Nie udało się zapisać rozliczenia.") { planOpen = false }
                    }
                }
                .buttonStyle(.borderedProminent)
                Button("Anuluj") { planOpen = false }
            }
        }
        .padding(12).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private var milestoneForm: some View {
        HStack {
            TextField("Nazwa", text: $label).textFieldStyle(.roundedBorder).frame(width: 150)
            Picker("", selection: Binding(get: { type }, set: { value in type = value; label = FinanceText.milestoneTypes.first { $0.0 == value }?.1 ?? label })) {
                Text("Zaliczka").tag("deposit")
                Text("Rata").tag("installment")
                Text("Płatność końcowa").tag("balance")
                Text("Inna").tag("other")
            }
            .labelsHidden().frame(width: 150)
            TextField("Kwota", value: $amount, format: .number).textFieldStyle(.roundedBorder).frame(width: 100)
            DatePicker("", selection: $due, displayedComponents: .date).labelsHidden()
            Picker("", selection: $invoice) {
                Text("Bez powiązanej faktury").tag("")
                ForEach(data.invoices) { Text($0.number + " · " + FinanceText.money($0.gross, fraction: false)).tag($0.id) }
            }
            .labelsHidden().frame(width: 190)
            TextField("Uwagi", text: $notes).textFieldStyle(.roundedBorder)
            Button("Zapisz") {
                Task {
                    let body: [String: JSONValue] = ["label": .string(label), "type": .string(type), "amount": .number(amount), "dueDate": .string(FinanceText.dayString(due)),
                                                     "invoiceId": invoice.isEmpty ? JSONValue.null : JSONValue.string(invoice), "notes": .string(notes)]
                    if await act("addMilestone", body, "Dodano termin płatności", "Nie udało się dodać płatności") {
                        showForm = false
                        label = "Zaliczka"
                        type = "deposit"
                        amount = 0
                        invoice = ""
                        notes = ""
                    }
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func milestoneRow(_ item: FinancesTabData.Milestone) -> some View {
        let color = FinanceText.milestoneColor(item.status)
        let dueText: String = (item.dueDays.map { "\($0) dni od wystawienia faktury · " } ?? "") + (item.dueDate.map { FinanceText.day($0) } ?? "Oczekuje na wystawioną fakturę")
        let line: String = "Termin: " + dueText + " · " + FinanceText.money(item.amount, fraction: false) + " · Zapłacono: " + FinanceText.money(item.paidAmount, fraction: false)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "calendar.badge.clock").foregroundStyle(color)
                Text(item.label).font(.callout.weight(.medium))
                Text(FinanceText.milestoneStatus[item.status] ?? item.status).font(.caption.weight(.semibold)).foregroundStyle(color)
                    .padding(.horizontal, 7).padding(.vertical, 2).background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
            }
            Text(line).font(.caption).foregroundStyle(.secondary)
            if let invoiceID = item.invoiceId {
                Button((data.invoices.first { $0.id == invoiceID }?.number ?? "Otwórz fakturę") + " · płatność aktualizowana z finansów") { state.openCRM("/crm/invoices/\(invoiceID)") }
                    .buttonStyle(.link).font(.caption)
            }
            if canManage {
                HStack {
                    if item.dueDays == nil {
                        DatePicker("Termin płatności", selection: Binding(get: { item.dueDate.flatMap { FinanceText.dayDate($0) } ?? Date() }, set: { date in
                            let text = FinanceText.dayString(date)
                            if text != item.dueDate { Task { _ = await act("updateMilestone", ["id": .string(item.id), "change": .string("dueDate"), "value": .string(text)], "Zaktualizowano płatność.", "Nie udało się zapisać terminu") } }
                        }), displayedComponents: .date).disabled(item.status == "paid").frame(width: 230)
                    }
                    Picker("", selection: Binding(get: { item.invoiceId ?? "" }, set: { value in
                        Task { _ = await act("updateMilestone", ["id": .string(item.id), "change": .string("invoice"), "value": value.isEmpty ? JSONValue.null : JSONValue.string(value)], "Zaktualizowano płatność.", "Nie udało się powiązać faktury") }
                    })) {
                        Text("Bez powiązanej faktury").tag("")
                        ForEach(data.invoices) { Text($0.number).tag($0.id) }
                    }
                    .labelsHidden().frame(width: 200)
                    Spacer()
                    if item.invoiceId == nil && !["paid", "waived"].contains(item.status) {
                        Button("Oznacz jako opłaconą") { Task { _ = await act("updateMilestone", ["id": .string(item.id), "change": .string("paid")], "Zaktualizowano płatność.", "Nie udało się zapisać płatności") } }
                    }
                    if item.status != "paid" {
                        Button("Niewymagana") { Task { _ = await act("updateMilestone", ["id": .string(item.id), "change": .string("waived")], "Zaktualizowano płatność.", "Nie udało się zapisać płatności") } }
                    }
                    Button { deleting = item } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red)
                }
                .controlSize(.small)
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    @EnvironmentObject private var state: Workspace
}

// MARK: Zamknięcie wydarzenia

@MainActor private struct FinanceCloseoutCard: View {
    let data: FinancesTabData
    let act: (String, [String: JSONValue], String?, String) async -> Bool
    @Environment(\.crmTheme) private var theme
    @State private var open = false
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { open.toggle() } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Zamknięcie wydarzenia", systemImage: "checkmark.circle").font(.headline)
                        Text("Rozliczenie ludzi, zasobów, dokumentów i wyniku.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: open ? "chevron.up" : "chevron.down")
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                ForEach(FinanceText.closeoutItems, id: \.0) { item in
                    let checked = data.controls.closeout?.value(item.0) ?? false
                    Button {
                        Task {
                            saving = true
                            _ = await act("closeout", ["key": .string(item.0)], nil, "Nie udało się zapisać zamknięcia")
                            saving = false
                        }
                    } label: {
                        HStack {
                            Image(systemName: checked ? "checkmark.square.fill" : "square").foregroundStyle(checked ? theme.accent : Color.secondary)
                            Text(item.1).font(.callout)
                            Spacer()
                        }
                        .padding(8).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).disabled(!data.access.isAdmin || saving)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
                if let completed = data.controls.closeout?.completedAt, let date = MeetingDates.parse(completed) {
                    Text("Wydarzenie zostało operacyjnie zamknięte " + MeetingDates.format(date, "dd.MM.yyyy, HH:mm") + ".").font(.caption).foregroundStyle(CrmTheme.rgb(0x4ade80))
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Nagłówek listy w stylu natywnej tabeli (szerokości kolumn jak w wierszach; `nil` — kolumna elastyczna).
struct FinanceListHeader: View {
    let columns: [(String, CGFloat?, Alignment)]
    var body: some View {
        HStack(spacing: 10) {
            ForEach(Array(columns.enumerated()), id: \.offset) { item in
                if let width = item.element.1 {
                    Text(item.element.0).frame(width: width, alignment: item.element.2)
                } else {
                    Text(item.element.0).frame(maxWidth: .infinity, alignment: item.element.2)
                }
            }
        }
        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        .padding(.horizontal, 8).padding(.vertical, 4)
    }
}
