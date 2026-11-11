import SwiftUI

// MARK: Podsumowanie wydarzenia (1:1 z `EventSettlementTab`): nagłówek ze stanem i ostrzeżeniami, obieg (wysłanie, zatwierdzenie,
// zwrot, ponowne otwarcie), pozycje przychodów i kosztów netto (wliczenie, rodzaj kosztu, netto, potwierdzenie, notatki, pozycje
// ręczne, faktury kosztowe), wynik, prowizje (sprzedawcy zewnętrzni i stawki), sprzedawca wydarzenia i historia. Liczy baza.

struct SettlementTabData: Decodable {
    var state: String
    var message: String?
    var settlement: Settlement?
}

struct Settlement: Decodable {
    struct Line: Decodable, Identifiable, Hashable {
        var key: String; var line_id: String?; var source_type: String; var source_id: String?; var kind: String; var category: String
        var name: String; var detail: String?; var date: String?; var suggested_net: Double?; var net_amount: Double; var gross_amount: Double?
        var auto_included: Bool; var included: Bool; var needs_confirmation: Bool; var confirmed: Bool; var source_changed: Bool
        var previous_source_net: Double?; var auto: Bool; var auto_note: String?; var note: String?; var updated_at: String?; var updated_by_name: String?
        var editable: [String]
        var id: String { key }
    }
    struct Totals: Decodable, Hashable {
        var revenue_net: Double; var subcontractor_net: Double; var direct_cost_net: Double; var team_net: Double
        var external_commission_lines: Double; var external_commission_auto: Double; var costs_net: Double; var profit_before_external: Double
        var partner_base: Double; var profit_net: Double; var internal_commissions: Double; var internal_commissions_cost: Double
        var profit_after_commissions: Double
        func value(_ key: String) -> Double {
            switch key {
            case "revenue_net": return revenue_net
            case "subcontractor_net": return subcontractor_net
            case "direct_cost_net": return direct_cost_net
            case "team_net": return team_net
            case "external_commission_lines": return external_commission_lines
            case "external_commission_auto": return external_commission_auto
            case "costs_net": return costs_net
            case "profit_before_external": return profit_before_external
            case "partner_base": return partner_base
            case "profit_net": return profit_net
            case "internal_commissions": return internal_commissions
            case "internal_commissions_cost": return internal_commissions_cost
            default: return profit_after_commissions
            }
        }
    }
    struct External: Decodable, Identifiable, Hashable {
        var partner_id: String; var name: String; var source: String; var eligible: Bool; var skip_reason: String?; var rate: Double?
        var rate_reason: String?; var retained: Bool; var base: Double; var amount: Double; var company_cost: Double; var payment_method: String
        var card_rate: Double?; var rate_override: Bool
        var id: String { partner_id }
    }
    struct Internal: Decodable, Identifiable, Hashable {
        var employee_id: String; var name: String; var share_percent: Double; var source: String; var client_owned: Bool; var client_label: String?
        var client_checked_at: String?; var enabled: Bool; var blocked_reason: String?; var rate: Double; var rate_reason: String?
        var retained: Bool; var base: Double; var amount: Double; var company_cost: Double; var payment_method: String; var employer_social_rate: Double?
        var id: String { employee_id }
    }
    struct VersionPerson: Decodable, Hashable { var name: String; var amount: Double; var rate: Double; var share_percent: Double? }
    struct Version: Decodable, Identifiable, Hashable {
        var id: String; var revision: Int; var action: String; var note: String?; var created_at: String; var actor_name: String?
        var totals: [String: Double]?; var `internal`: [VersionPerson]; var external: [VersionPerson]
    }
    struct Commission: Decodable, Identifiable, Hashable {
        var id: String; var beneficiary_name: String; var entry_kind: String; var status: String; var amount: Double; var base_amount: Double?
        var rate: Double?; var company_cost_amount: Double?; var base_description: String?; var rate_reason: String?; var settlement_revision: Int?
        var paid_amount: Double; var offset_amount: Double; var cancel_reason: String?; var manual: Bool
    }
    struct Stamp: Decodable, Hashable { var at: String; var note: String?; var by_name: String? }

    var status: String; var revision: Int; var lines: [Line]; var totals: Totals; var external: [External]; var `internal`: [Internal]
    var issues: [String]; var warnings: [String]; var finished: Bool; var forecast: Bool; var clawback: Bool; var source_key: String
    var stale: Bool; var submitted_stale: Bool; var submitted: Stamp?; var approved: Stamp?; var returned: Stamp?
    var can_edit: Bool; var can_submit: Bool; var can_approve: Bool; var can_return: Bool; var can_reopen: Bool; var can_edit_shares: Bool
    var versions: [Version]; var commissions: [Commission]
}

/// Etykiety i formatowanie jak `eventSettlement.ts` / `settlementUi.ts`.
enum SettlementText {
    static let statuses = ["draft": "Wersja robocza", "submitted": "Czeka na zatwierdzenie", "approved": "Zatwierdzone"]
    static let categories = [
        "revenue": "Przychód", "subcontractor": "Wykonawca zewnętrzny", "direct_cost": "Koszt bezpośredni", "team": "Ekipa",
        "external_commission": "Prowizja / narzut sprzedawcy",
    ]
    static let hints = [
        "revenue": "Liczy się do przychodu netto.",
        "subcontractor": "Zespoły, atrakcje, podwykonawcy, na których nie mamy marży — pomniejsza podstawę prowizji sprzedawców zewnętrznych i zysk.",
        "direct_cost": "Wynajem, zakupy, transport, materiały — pomniejsza zysk (prowizja pracownika).",
        "team": "Wynagrodzenie ekipy za to wydarzenie — pomniejsza zysk.",
        "external_commission": "Prowizja lub narzut sprzedawcy zewnętrznego — pomniejsza zysk.",
    ]
    static let sources = [
        "manual": "Dopisane ręcznie", "invoice": "Faktura sprzedaży", "offer": "Oferta (prognoza)", "cash": "Gotówka", "forecast": "Prognoza",
        "event_cost": "Koszt wydarzenia", "subcontractor_task": "Zlecenie podwykonawcy", "team": "Ewidencja czasu", "markup": "Narzut sprzedawcy",
        "commission": "Prowizja wpisana ręcznie",
    ]
    static let versionActions = ["submitted": "Wysłane do zatwierdzenia", "returned": "Zwrócone do poprawy", "approved": "Zatwierdzone", "reopened": "Otwarte ponownie"]
    static let commissionStatuses = ["planned": "Prognoza", "approved": "Do wypłaty", "paid": "Wypłacona", "cancelled": "Anulowana"]
    static let entryKinds = ["accrual": "Naliczenie", "correction": "Dopłata", "deduction": "Do potrącenia"]
    static let payments = ["cash_dividend": "Gotówka z zysku spółki", "invoice": "Faktura / rachunek", "payroll": "Wynagrodzenie pracownicze", "other": "Inny sposób"]
    static let commissionSources = [
        "sales_share": "Sprzedawca wydarzenia", "seller_portal": "Oferta z portalu sprzedawcy", "event_referral": "Polecenie",
        "billing_contact": "Kontakt rozliczeniowy (hotel / agencja)", "partner_arrangement": "Pośrednik (Ustalenia ze sprzedawcą)", "manual_partner": "Wskazany w podsumowaniu",
    ]
    static let shareSources = [
        "offer_author": "Autor zaakceptowanej oferty", "seller_portal_owner": "Opiekun sprzedawcy z portalu", "inquiry_owner": "Prowadzący zapytanie",
        "event_creator": "Twórca wydarzenia", "manual": "Ustawione przez administratora",
    ]
    static let sections: [(String, String)] = [
        ("revenue", "Przychody netto"), ("subcontractor", "Wykonawcy zewnętrzni"), ("direct_cost", "Koszty bezpośrednie"), ("team", "Ekipa"),
        ("external_commission", "Prowizje i narzuty sprzedawców zewnętrznych"),
    ]
    static let sectionTotals = ["revenue": "revenue_net", "subcontractor": "subcontractor_net", "direct_cost": "direct_cost_net", "team": "team_net", "external_commission": "external_commission_lines"]
    static let totalRows: [(label: String, key: String, strong: Bool)] = [
        ("Przychód netto", "revenue_net", false), ("Wykonawcy zewnętrzni", "subcontractor_net", false), ("Koszty bezpośrednie", "direct_cost_net", false),
        ("Ekipa", "team_net", false), ("Narzuty i ręczne wpisy prowizji", "external_commission_lines", false),
        ("Zysk przed prowizjami sprzedawców", "profit_before_external", false), ("Prowizje sprzedawców zewnętrznych (koszt firmy)", "external_commission_auto", false),
        ("Zysk netto", "profit_net", true), ("Prowizje pracowników (koszt firmy)", "internal_commissions_cost", false),
        ("Zysk po prowizjach", "profit_after_commissions", true),
    ]

    /// `formatPln`: „12 345,60 zł”, minus typograficzny.
    static func pln(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let rounded = (value * 100).rounded() / 100
        let fixed = String(format: "%.2f", abs(rounded))
        let parts = fixed.split(separator: ".")
        var whole = String(parts[0])
        var grouped = ""
        while whole.count > 3 {
            grouped = " " + String(whole.suffix(3)) + grouped
            whole = String(whole.dropLast(3))
        }
        return (rounded < 0 ? "−" : "") + whole + grouped + "," + String(parts[1]) + " zł"
    }
    /// `formatPercent`: „5%”, „12,5%”.
    static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let rounded = (value * 100).rounded() / 100
        let text = rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
        return text.replacingOccurrences(of: ".", with: ",") + "%"
    }
    /// `formatSettlementDate`: „5 lis 2026” albo „5 lis 2026, 14:30”.
    static func date(_ value: String?, time: Bool = false) -> String {
        guard let value, !value.isEmpty else { return "—" }
        if value.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil {
            let parts = value.split(separator: "-").compactMap { Int($0) }
            var components = DateComponents()
            components.year = parts[0]; components.month = parts[1]; components.day = parts[2]; components.hour = 12
            guard let day = MeetingDates.calendar.date(from: components) else { return "—" }
            return MeetingDates.format(day, "d MMM yyyy")
        }
        guard let parsed = MeetingDates.parse(value) else { return "—" }
        return MeetingDates.format(parsed, time ? "d MMM yyyy, HH:mm" : "d MMM yyyy")
    }
    /// `parseMoneyInput`: „1234,56” albo „1234.56”, nie ujemna, do grosza.
    static func money(_ text: String) -> Double? {
        let clean = text.replacingOccurrences(of: "\\s", with: "", options: .regularExpression).replacingOccurrences(of: "\u{00a0}", with: "").replacingOccurrences(of: ",", with: ".")
        guard clean.range(of: "^\\d{1,9}(?:\\.\\d{1,2})?$", options: .regularExpression) != nil, let value = Double(clean), value >= 0 else { return nil }
        return (value * 100).rounded() / 100
    }
    /// `parsePercentInput`: 0–100, do 0,01.
    static func percentInput(_ text: String) -> Double? {
        let clean = text.replacingOccurrences(of: "[\\s%]", with: "", options: .regularExpression).replacingOccurrences(of: ",", with: ".")
        guard clean.range(of: "^\\d{1,3}(?:\\.\\d{1,2})?$", options: .regularExpression) != nil, let value = Double(clean), value >= 0, value <= 100 else { return nil }
        return (value * 100).rounded() / 100
    }
    static func moneyField(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "" }
        return String(format: "%.2f", max(0, value))
    }
    static func percentField(_ value: Double?) -> String {
        guard let value else { return "" }
        return (value == value.rounded() ? String(Int(value)) : String(value)).replacingOccurrences(of: ".", with: ",")
    }
}

/// Okno potwierdzenia operacji (`SettlementConfirmDialog`): opis, kluczowe kwoty, notatka (wymagana albo opcjonalna) i dodatkowy wybór.
struct SettlementConfirm: Identifiable {
    struct Note { var label: String; var required: Bool; var placeholder: String; var initial: String = "" }
    let id = UUID()
    var title: String
    var description: String?
    var body: String?
    var showTotals = false
    var confirmLabel: String
    var danger = false
    var note: Note?
    var option: (label: String, hint: String)?
    var run: (String, Bool) async -> Bool
}

@MainActor struct EventSettlementTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    /// Sekcja zakładki „Rozliczenie” (nil — pełny widok podsumowania).
    var part: RozliczeniePart? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var busy: String?
    @State private var confirm: SettlementConfirm?
    @State private var addingInvoice = false
    @State private var invoiceForbidden = false
    @State private var addingSeller = false
    @State private var rateFor: Settlement.External?
    @State private var manualEditor: String?
    @State private var refreshing = false
    @State private var showAllHistory = false

    private var data: SettlementTabData? { store.tab(eventID, "summary", as: SettlementTabData.self) }

    var body: some View {
        Group {
            if let data {
                if let settlement = data.settlement, data.state == "ready" {
                    if let part { partContent(settlement, part) } else { content(settlement) }
                } else if part == nil || part == .closing || part == .result {
                    notice(data)
                }
            } else if let error = store.tabErrors["\(eventID)|summary"] {
                ContentUnavailableView {
                    Label("Nie udało się wczytać podsumowania wydarzenia.", systemImage: "sum")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "summary") } } }
            } else if part != nil {
                ProgressView("Wczytuję podsumowanie wydarzenia…").controlSize(.small).frame(maxWidth: .infinity).padding(20)
            } else {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Wczytuję podsumowanie wydarzenia…").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "summary") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            if busy == nil { Task { await store.loadTab(eventID, "summary") } }
        }
        .sheet(item: $confirm) { request in
            SettlementConfirmSheet(request: request, settlement: data?.settlement, busy: busy != nil) { confirm = nil }
                .environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $addingInvoice) {
            SettlementInvoiceSheet(store: store, eventID: eventID, mutate: mutate, onForbidden: { invoiceForbidden = true })
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $addingSeller) {
            SettlementSellerSheet(store: store, eventID: eventID, mutate: mutate)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $rateFor) { seller in
            SettlementRateSheet(seller: seller, mutate: mutate).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    private func notice(_ data: SettlementTabData) -> some View {
        VStack(spacing: 10) {
            Image(systemName: data.state == "forbidden" ? "lock" : "exclamationmark.triangle").font(.system(size: 36)).foregroundStyle(.secondary)
            Text(data.message ?? (data.state == "forbidden" ? "Podsumowanie wydarzenia widzi osoba z dostępem do kwot tego wydarzenia." : "Nie udało się wczytać podsumowania wydarzenia."))
                .multilineTextAlignment(.center).foregroundStyle(.secondary).frame(maxWidth: 480)
            if data.state == "error" { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "summary") } } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(40)
    }

    /// Zapis przez funkcję bazy zwracającą pełne podsumowanie (`mutate` w `useEventSettlement`).
    func mutate(_ key: String, _ rpc: String, _ params: [String: JSONValue], _ success: String?) async -> Bool {
        guard busy == nil else { return false }
        busy = key
        defer { busy = nil }
        do {
            let reply = try await store.tabAction(eventID, "summary", "write", ["rpc": .string(rpc), "params": .object(params)], reload: [], success: success, pending: "Zapisywanie…")
            if let object = try? JSONSerialization.jsonObject(with: reply) { store.applyTab(eventID, "summary", object) }
            return true
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać zmian. Odśwież podsumowanie.")
            return false
        }
    }

    private func refresh() async {
        refreshing = true
        await store.loadTab(eventID, "summary")
        refreshing = false
    }

    private func content(_ s: Settlement) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(s)
                actionBar(s)
                HStack(alignment: .top, spacing: 16) {
                    lines(s).frame(maxWidth: .infinity, alignment: .topLeading)
                    totals(s).frame(width: 340)
                }
                HStack(alignment: .top, spacing: 16) {
                    commissions(s).frame(maxWidth: .infinity, alignment: .topLeading)
                    if s.can_edit_shares {
                        SettlementSharesEditor(store: store, eventID: eventID, people: s.internal, busy: busy != nil, mutate: mutate).frame(width: 420)
                    }
                }
                history(s)
            }
            .padding(18)
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) { content() }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func chip(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(color).background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 6))
    }

    private func banner(_ text: String, _ symbol: String, _ color: Color) -> some View {
        Label(text, systemImage: symbol).font(.callout).foregroundStyle(color)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Nagłówek

    private func header(_ s: Settlement) -> some View {
        let statusColor: Color = s.status == "approved" ? CrmTheme.rgb(0x6ee7b7) : (s.status == "submitted" ? CrmTheme.rgb(0xfcd34d) : Color.secondary)
        let warnings = s.clawback ? s.warnings.filter { !$0.hasPrefix("Wydarzenie anulowane po zatwierdzeniu") } : s.warnings
        return card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("Podsumowanie wydarzenia").font(.title2.weight(.light))
                        chip(SettlementText.statuses[s.status] ?? s.status, statusColor)
                        if s.revision > 0 { Text("wersja \(s.revision)").font(.caption).foregroundStyle(.secondary) }
                    }
                    Text("Przychody i koszty netto uzupełniają się same. Prowizje liczy baza — tutaj sprawdzasz, poprawiasz pozycje i wysyłasz do zatwierdzenia.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }.help("Odśwież").disabled(refreshing)
            }
            if let submitted = s.submitted { stamp("Wysłane do zatwierdzenia", submitted) }
            if let approved = s.approved { stamp("Zatwierdzone", approved) }
            if let returned = s.returned, s.status == "draft" { stamp("Zwrócone do poprawy", returned) }
            if s.clawback {
                banner("Wydarzenie anulowano po zatwierdzeniu podsumowania. Ponowne zatwierdzenie wyzeruje prowizje: niewypłacone zostaną anulowane, a wypłacone zamienią się w potrącenia.",
                       "exclamationmark.triangle", CrmTheme.rgb(0xf87171))
            }
            if s.stale { banner("Dane zmieniły się po zatwierdzeniu — otwórz ponownie, aby przeliczyć.", "exclamationmark.triangle", CrmTheme.rgb(0xfcd34d)) }
            if s.submitted_stale { banner("Dane zmieniły się po wysłaniu — zwróć do poprawy.", "exclamationmark.triangle", CrmTheme.rgb(0xfcd34d)) }
            if s.forecast {
                banner("Przychód pochodzi z prognozy (oferta lub kalkulacja). Kwoty i prowizje zmienią się po wystawieniu faktury albo potwierdzeniu gotówki — do wysłania potrzebny jest rzeczywisty przychód.",
                       "info.circle", CrmTheme.rgb(0x93c5fd))
            }
            if !s.finished && s.status == "draft" {
                banner("Wydarzenie jeszcze się nie zakończyło — prowizje są prognozą. Podsumowanie wyślesz po zakończeniu.", "info.circle", CrmTheme.rgb(0x93c5fd))
            }
            if !s.issues.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Do uzupełnienia przed wysłaniem", systemImage: "exclamationmark.circle").font(.callout.weight(.semibold))
                    ForEach(s.issues, id: \.self) { issue in Text("• " + issue).font(.callout) }
                }
                .foregroundStyle(CrmTheme.rgb(0xfca5a5)).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(CrmTheme.rgb(0xef4444).opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            if !warnings.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Uwagi").font(.callout.weight(.semibold))
                    ForEach(warnings, id: \.self) { warning in Text("• " + warning).font(.callout) }
                }
                .foregroundStyle(CrmTheme.rgb(0xfcd34d)).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(CrmTheme.rgb(0xf59e0b).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func stamp(_ title: String, _ stamp: Settlement.Stamp) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(SettlementText.date(stamp.at, time: true) + (stamp.by_name.map { " · " + $0 } ?? "")).font(.callout)
            if let note = stamp.note?.nonEmpty { Text(note).font(.callout).foregroundStyle(.secondary) }
        }
    }

    // MARK: Obieg

    @ViewBuilder private func actionBar(_ s: Settlement) -> some View {
        let showHint = s.can_edit && !s.can_submit && s.status == "draft"
        if s.can_submit || s.can_approve || s.can_return || s.can_reopen || showHint {
            card {
                HStack(spacing: 10) {
                    if s.can_submit || showHint {
                        Button { submit(s) } label: { Label("Wyślij do zatwierdzenia", systemImage: "paperplane") }
                            .buttonStyle(.borderedProminent).disabled(busy != nil || !s.can_submit)
                    }
                    if s.can_approve { Button { approve(s) } label: { Label("Zatwierdź", systemImage: "checkmark.circle") }.buttonStyle(.borderedProminent).disabled(busy != nil) }
                    if s.can_return { Button { giveBack() } label: { Label("Zwróć do poprawy", systemImage: "arrow.uturn.backward") }.disabled(busy != nil) }
                    if s.can_reopen { Button { reopen() } label: { Label("Otwórz ponownie", systemImage: "arrow.counterclockwise") }.disabled(busy != nil) }
                    Spacer()
                }
                if showHint { Text("Uzupełnij pozycje z listy „Do uzupełnienia przed wysłaniem”, aby wysłać podsumowanie.").font(.caption).foregroundStyle(.secondary) }
                if s.status == "submitted" && s.can_return && !s.can_approve && !s.submitted_stale {
                    Text("Zatwierdzenie jest niedostępne — sprawdź listę „Do uzupełnienia”.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func submit(_ s: Settlement) {
        let key = s.source_key
        confirm = SettlementConfirm(title: "Wysłać podsumowanie do zatwierdzenia?",
                                    description: "Administrator dostanie powiadomienie. Do czasu decyzji podsumowania nie można zmieniać.",
                                    showTotals: true, confirmLabel: "Wyślij do zatwierdzenia",
                                    note: .init(label: "Notatka dla zatwierdzającego", required: false, placeholder: "Np. koszt transportu potwierdzony z fakturą…")) { note, _ in
            await mutate("submit", "submit_event_settlement", ["p_note": note.isEmpty ? .null : .string(note), "p_expected_source_key": .string(key)],
                         "Podsumowanie wysłane do zatwierdzenia.")
        }
    }

    private func approve(_ s: Settlement) {
        let key = s.source_key
        confirm = SettlementConfirm(title: "Zatwierdzić podsumowanie?",
                                    description: s.clawback ? "Wydarzenie jest anulowane — zatwierdzenie wyzeruje prowizje." : "Prowizje staną się „do wypłaty” z zamrożoną podstawą. Późniejsza zmiana wymaga ponownego otwarcia.",
                                    body: s.clawback ? "Niewypłacone prowizje zostaną anulowane, a wypłacone zamienią się w potrącenia z kolejnych prowizji tych osób." : nil,
                                    showTotals: true, confirmLabel: "Zatwierdź") { _, _ in
            await mutate("approve", "approve_event_settlement", ["p_expected_source_key": .string(key)], "Podsumowanie zatwierdzone — prowizje są do wypłaty.")
        }
    }

    private func giveBack() {
        confirm = SettlementConfirm(title: "Zwrócić podsumowanie do poprawy?", description: "Osoba, która wysłała podsumowanie, dostanie powiadomienie z Twoją uwagą.",
                                    confirmLabel: "Zwróć do poprawy", danger: true,
                                    note: .init(label: "Co trzeba poprawić", required: true, placeholder: "Np. brakuje faktury za nagłośnienie")) { note, _ in
            await mutate("return", "return_event_settlement", ["p_note": .string(note)], "Podsumowanie zwrócone do poprawy.")
        }
    }

    private func reopen() {
        confirm = SettlementConfirm(title: "Otworzyć podsumowanie ponownie?",
                                    description: "Podsumowanie wróci do wersji roboczej. Po ponownym zatwierdzeniu wpisy bez wypłat przyjmą nowe kwoty, a po wypłacie powstanie dopłata albo potrącenie.",
                                    confirmLabel: "Otwórz ponownie", danger: true,
                                    note: .init(label: "Powód ponownego otwarcia", required: true, placeholder: "Np. doszła faktura kosztowa po zatwierdzeniu"),
                                    option: (label: "Przelicz stawki według aktualnych warunków",
                                             hint: "Zwykle zatwierdzona prowizja zachowuje swoją stawkę. Zaznacz, gdy stawka była ustawiona błędnie i została już poprawiona przy pracowniku lub w kartotece sprzedawców. Dotyczy wszystkich osób w wydarzeniu — kogo zmiana obejmie, pokażą ostrzeżenia podsumowania.")) { note, refresh in
            await mutate("reopen", "reopen_event_settlement", ["p_reason": .string(note), "p_refresh_rates": .bool(refresh)],
                         refresh ? "Podsumowanie otwarte ponownie — stawki zostaną przeliczone." : "Podsumowanie otwarte ponownie.")
        }
    }

    // MARK: Pozycje

    /// Pozycje podsumowania w zakładce „Rozliczenie”: przychody, koszty, prowizje (obieg, wynik i historia w swoich sekcjach).
    @ViewBuilder private func partContent(_ s: Settlement, _ part: RozliczeniePart) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            switch part {
            case .revenue:
                lines(s, only: ["revenue"], title: "Przychody netto w podsumowaniu")
            case .costs:
                lines(s, only: ["subcontractor", "direct_cost", "team"], title: "Koszty netto w podsumowaniu")
            case .result:
                totals(s)
            case .commissions:
                commissions(s)
                if s.can_edit_shares {
                    SettlementSharesEditor(store: store, eventID: eventID, people: s.internal, busy: busy != nil, mutate: mutate)
                }
                lines(s, only: ["external_commission"], title: "Narzuty i prowizje sprzedawców zewnętrznych")
            case .closing:
                header(s)
                actionBar(s)
                history(s)
            }
        }
    }

    private func lines(_ s: Settlement, only: Set<String>? = nil, title: String = "Przychody i koszty netto") -> some View {
        card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline)
                    Text("Pozycje z faktur, kosztów, zleceń, ewidencji czasu i prowizji. Wyłączone pozycje zostają widoczne, ale nie liczą się do sum.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if s.can_edit {
                    if !invoiceForbidden {
                        Button { addingInvoice = true } label: { Label("Dodaj fakturę kosztową", systemImage: "doc.badge.plus") }.disabled(busy != nil)
                    }
                    Button { manualEditor = "new" } label: { Label("Dodaj pozycję", systemImage: "plus") }.disabled(busy != nil || manualEditor != nil)
                }
            }
            if s.can_edit && manualEditor == "new" {
                SettlementManualForm(line: nil, busy: busy, save: saveManual) { manualEditor = nil }
            }
            ForEach(SettlementText.sections.filter { only?.contains($0.0) ?? true }, id: \.0) { section in
                let items = s.lines.filter { section.0 == "revenue" ? $0.kind == "revenue" : ($0.kind == "cost" && $0.category == section.0) }
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(section.1).font(.callout.weight(.semibold))
                        Text("\(items.count)").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text(SettlementText.pln(s.totals.value(SettlementText.sectionTotals[section.0] ?? ""))).font(.callout.monospacedDigit())
                    }
                    if items.isEmpty {
                        Text("Brak pozycji.").font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(items) { line in
                        if s.can_edit && manualEditor == line.key {
                            SettlementManualForm(line: line, busy: busy, save: saveManual) { manualEditor = nil }
                        } else {
                            SettlementLineView(line: line, canEdit: s.can_edit, busy: busy, mutate: mutate, ask: { confirm = $0 }, editManual: { manualEditor = line.key })
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    private func saveManual(_ payload: [String: JSONValue], _ edit: Bool) async -> Bool {
        await mutate("manual", "save_event_settlement_line", ["p_line": .object(payload)], edit ? "Pozycja zapisana." : "Pozycja dodana do podsumowania.")
    }

    // MARK: Wynik

    private func totals(_ s: Settlement) -> some View {
        card {
            Text("Wynik wydarzenia").font(.headline)
            if s.forecast { Text("Prognoza — przychód z oferty lub kalkulacji.").font(.caption).foregroundStyle(CrmTheme.rgb(0x93c5fd)) }
            ForEach(SettlementText.totalRows, id: \.label) { row in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.label).font(row.strong ? .callout.weight(.semibold) : .callout)
                        Spacer()
                        Text(SettlementText.pln(s.totals.value(row.key))).font(row.strong ? .callout.weight(.semibold).monospacedDigit() : .callout.monospacedDigit())
                    }
                    if let hint = rowHint(row.key, s.totals) { Text(hint).font(.caption2).foregroundStyle(.secondary) }
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(row.strong ? theme.accent.opacity(0.1) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func rowHint(_ key: String, _ totals: Settlement.Totals) -> String? {
        switch key {
        case "profit_before_external": return "Przychód netto − wykonawcy − koszty bezpośrednie − ekipa − narzuty."
        case "external_commission_auto": return totals.external_commission_auto > 0 ? "Stawka sprzedawcy × zysk netto; wypłata gotówką z zysku razem z podatkiem." : nil
        case "profit_net": return "Od tej kwoty liczą się prowizje sprzedawców zewnętrznych i pracowników."
        case "internal_commissions_cost": return "Kwota dla pracowników: " + SettlementText.pln(totals.internal_commissions)
        default: return nil
        }
    }

    // MARK: Prowizje

    private func amounts(_ amount: Double, _ cost: Double) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(SettlementText.pln(amount)).font(.callout.weight(.semibold).monospacedDigit())
            Text("koszt firmy " + SettlementText.pln(cost)).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func commissions(_ s: Settlement) -> some View {
        card {
            Text("Prowizje").font(.headline)
            Text("Wszystkie prowizje liczymy od zysku netto — po kosztach i po koszcie prowizji sprzedawców zewnętrznych (gotówka z zysku razem z podatkiem). Pracownik: 5%, 10% gdy w dniu akceptacji oferty był opiekunem klienta. Sprzedawca zewnętrzny: % od zysku z jego karty albo ustalony dla tego wydarzenia.")
                .font(.caption).foregroundStyle(.secondary)
            Text("Sprzedawcy wydarzenia (pracownicy)").font(.callout.weight(.semibold)).padding(.top, 4)
            if s.internal.isEmpty { Text("Nie zapisano sprzedawcy wydarzenia.").font(.callout).foregroundStyle(.secondary) }
            ForEach(s.internal) { item in internalRow(item) }
            HStack {
                Text("Sprzedawcy zewnętrzni").font(.callout.weight(.semibold))
                Spacer()
                if s.can_edit { Button { addingSeller = true } label: { Label("Dodaj sprzedawcę", systemImage: "plus") }.disabled(busy != nil) }
            }
            .padding(.top, 4)
            if s.external.isEmpty {
                Text("Brak sprzedawców zewnętrznych w tym wydarzeniu." + (s.can_edit ? " Hotel lub agencja, która sprzedała wydarzenie? Dodaj jej sprzedawcę — prowizja będzie kosztem w podsumowaniu." : ""))
                    .font(.callout).foregroundStyle(.secondary)
            }
            ForEach(s.external) { item in externalRow(item, s) }
            Text("Zapisane prowizje").font(.callout.weight(.semibold)).padding(.top, 4)
            if s.commissions.isEmpty { Text("Brak zapisanych prowizji.").font(.callout).foregroundStyle(.secondary) }
            ForEach(s.commissions) { row in commissionRow(row) }
        }
    }

    private func internalRow(_ item: Settlement.Internal) -> some View {
        let share: String = item.share_percent != 100 ? " · udział " + SettlementText.percent(item.share_percent) : ""
        let method: String = SettlementText.payments[item.payment_method] ?? item.payment_method
        let social: String = item.payment_method == "payroll" && item.employer_social_rate != nil ? " · koszt firmy ze składkami pracodawcy " + SettlementText.percent(item.employer_social_rate) : ""
        let payment: String = method + social
        let label: String = item.client_label.map { " (" + $0 + ")" } ?? ""
        let checked: String = item.client_checked_at.map { " · sprawdzono " + SettlementText.date($0) } ?? ""
        let owned: String = "Klient własny" + label + checked
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(item.name).font(.callout.weight(.medium))
                    chip("udział " + SettlementText.percent(item.share_percent), Color.secondary)
                    if item.client_owned { chip(owned, theme.accent) }
                    if !item.source.isEmpty { Text(SettlementText.shareSources[item.source] ?? item.source).font(.caption).foregroundStyle(.secondary) }
                    if item.retained { chip("Stawka z zatwierdzonego rozliczenia", Color.secondary) }
                }
                Text(SettlementText.percent(item.rate) + " od " + SettlementText.pln(item.base) + share).font(.caption)
                if let reason = item.rate_reason?.nonEmpty { Text(reason).font(.caption).foregroundStyle(.secondary) }
                Text(payment).font(.caption).foregroundStyle(.secondary)
                if !item.enabled { Text(item.blocked_reason ?? "Pracownik nie ma włączonej prowizji od sprzedaży.").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
                else if let blocked = item.blocked_reason?.nonEmpty { Text(blocked).font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
            }
            Spacer()
            amounts(item.amount, item.company_cost)
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func externalRow(_ item: Settlement.External, _ s: Settlement) -> some View {
        let rateTitle: String = item.rate_override ? "Zmień stawkę dla wydarzenia" : "Inna stawka dla wydarzenia"
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.name).font(.callout.weight(.medium))
                    Text(SettlementText.commissionSources[item.source] ?? item.source).font(.caption).foregroundStyle(.secondary)
                    if item.eligible {
                        Text(SettlementText.percent(item.rate ?? 0) + " od " + SettlementText.pln(item.base) + " zysku netto").font(.caption)
                        if let reason = item.rate_reason?.nonEmpty { Text(reason).font(.caption).foregroundStyle(.secondary) }
                        if item.rate_override, let card = item.card_rate { Text("Karta sprzedawcy: " + SettlementText.percent(card)).font(.caption).foregroundStyle(.secondary) }
                        if item.retained { Text("Zmiana warunków w kartotece nie działa wstecz.").font(.caption).foregroundStyle(.secondary) }
                        Text(SettlementText.payments[item.payment_method] ?? item.payment_method).font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text(item.skip_reason ?? "Bez prowizji.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if item.eligible { amounts(item.amount, item.company_cost) }
            }
            if s.can_edit {
                HStack {
                    Button { rateFor = item } label: { Label(rateTitle, systemImage: "pencil") }.disabled(busy != nil)
                    if item.source == "manual_partner" {
                        Button(role: .destructive) { askRemove(item) } label: { Label("Usuń z podsumowania", systemImage: "trash") }.disabled(busy != nil)
                    }
                }
                .controlSize(.small)
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func askRemove(_ item: Settlement.External) {
        confirm = SettlementConfirm(title: "Usunąć \(item.name) z podsumowania?",
                                    description: "Prowizja tego sprzedawcy w wydarzeniu zostanie anulowana z powodem (historia zostaje). Możesz go dodać ponownie.",
                                    confirmLabel: "Usuń z podsumowania", danger: true,
                                    note: .init(label: "Powód", required: true, placeholder: "np. sprzedawca nie brał udziału w sprzedaży")) { note, _ in
            await mutate("seller-remove", "remove_event_settlement_seller", ["p_sales_partner_id": .string(item.partner_id), "p_reason": .string(note)],
                         "Sprzedawca usunięty z podsumowania.")
        }
    }

    private func commissionRow(_ row: Settlement.Commission) -> some View {
        let statusColor: Color = row.status == "paid" ? CrmTheme.rgb(0x6ee7b7) : (row.status == "approved" ? theme.accent : Color.secondary)
        let kindColor: Color = row.entry_kind == "deduction" ? CrmTheme.rgb(0xfca5a5) : CrmTheme.rgb(0x6ee7b7)
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(row.beneficiary_name).font(.callout.weight(.medium))
                    chip(SettlementText.commissionStatuses[row.status] ?? row.status, statusColor)
                    if row.entry_kind != "accrual" { chip(SettlementText.entryKinds[row.entry_kind] ?? row.entry_kind, kindColor) }
                    if row.manual { chip("Wpis ręczny", Color.secondary) }
                    if let revision = row.settlement_revision { Text("wersja \(revision)").font(.caption).foregroundStyle(.secondary) }
                }
                if let description = row.base_description?.nonEmpty { Text(description).font(.caption).foregroundStyle(.secondary) }
                if let rate = row.rate, let base = row.base_amount, row.entry_kind == "accrual" {
                    Text(SettlementText.percent(rate) + " od " + SettlementText.pln(base) + (row.rate_reason.map { " · " + $0 } ?? "")).font(.caption)
                }
                if row.status == "cancelled", let reason = row.cancel_reason?.nonEmpty { Text("Powód anulowania: " + reason).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text((row.entry_kind == "deduction" ? "−" : "") + SettlementText.pln(row.amount)).font(.callout.weight(.semibold).monospacedDigit())
                if row.paid_amount > 0 && row.entry_kind != "deduction" { Text("wypłacono " + SettlementText.pln(row.paid_amount)).font(.caption).foregroundStyle(.secondary) }
                if row.offset_amount > 0 { Text("potrącono " + SettlementText.pln(row.offset_amount)).font(.caption).foregroundStyle(.secondary) }
                if let cost = row.company_cost_amount, cost != row.amount { Text("koszt firmy " + SettlementText.pln(cost)).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Historia

    @ViewBuilder private func history(_ s: Settlement) -> some View {
        if !s.versions.isEmpty {
            let visible = showAllHistory ? s.versions : Array(s.versions.prefix(5))
            card {
                Label("Historia podsumowania", systemImage: "clock.arrow.circlepath").font(.headline)
                ForEach(visible) { version in versionRow(version) }
                if s.versions.count > 5 {
                    Button(showAllHistory ? "Pokaż mniej" : "Pokaż całą historię (\(s.versions.count))") { showAllHistory.toggle() }.buttonStyle(.link)
                }
            }
        }
    }

    private func versionTotals(_ totals: [String: Double]) -> String {
        let parts: [String] = [
            "Przychód netto: " + SettlementText.pln(totals["revenue_net"]), "Koszty: " + SettlementText.pln(totals["costs_net"]),
            "Zysk netto: " + SettlementText.pln(totals["profit_net"]), "Prowizje pracowników: " + SettlementText.pln(totals["internal_commissions"]),
        ]
        return parts.joined(separator: "   ")
    }

    private func versionRow(_ version: Settlement.Version) -> some View {
        let color: Color = version.action == "approved" ? CrmTheme.rgb(0x6ee7b7) : (version.action == "returned" ? CrmTheme.rgb(0xfca5a5) : (version.action == "submitted" ? CrmTheme.rgb(0xfcd34d) : Color.secondary))
        let people = version.internal.map { item -> String in
            let share = (item.share_percent ?? 100) != 100 ? ", udział " + SettlementText.percent(item.share_percent) : ""
            return item.name + ": " + SettlementText.pln(item.amount) + " (" + SettlementText.percent(item.rate) + share + ")"
        } + version.external.map { $0.name + ": " + SettlementText.pln($0.amount) + " (" + SettlementText.percent($0.rate) + ")" }
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                EventDotLabel(label: SettlementText.versionActions[version.action] ?? version.action, color: color).font(.caption.weight(.semibold))
                Text("wersja \(version.revision)").font(.caption).foregroundStyle(.secondary)
                Text("· " + SettlementText.date(version.created_at, time: true)).font(.caption).foregroundStyle(.secondary)
                if let actor = version.actor_name { Text("· " + actor).font(.caption).foregroundStyle(.secondary) }
            }
            if let note = version.note?.nonEmpty { Text(note).font(.callout) }
            if let totals = version.totals {
                Text(versionTotals(totals)).font(.caption).foregroundStyle(.secondary)
            }
            if !people.isEmpty { Text(people.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Pozycja (`SettlementLineRow`)

@MainActor private struct SettlementLineView: View {
    let line: Settlement.Line
    let canEdit: Bool
    let busy: String?
    let mutate: (String, String, [String: JSONValue], String?) async -> Bool
    let ask: (SettlementConfirm) -> Void
    let editManual: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var editingNet = false
    @State private var netText = ""
    @State private var netReason = ""
    @State private var netError = ""
    @State private var editingNote = false
    @State private var noteText = ""

    private var manual: Bool { line.source_type == "manual" }
    private var disabled: Bool { busy != nil }
    private var saving: Bool { busy == "line:" + line.key }
    private func can(_ field: String) -> Bool { canEdit && line.editable.contains(field) }

    /// Zapis pozycji (`save_event_settlement_line`): ręczna — pełne dane, automatyczna — źródło i zmiana.
    private func save(_ patch: [String: JSONValue], _ message: String?) async -> Bool {
        var payload: [String: JSONValue]
        if manual {
            payload = ["source_type": .string("manual"), "line_id": line.line_id.map { JSONValue.string($0) } ?? JSONValue.null, "kind": .string(line.kind),
                       "category": .string(line.category), "name": .string(line.name), "net_amount": .number(line.net_amount), "included": .bool(line.included),
                       "note": .string(line.note ?? "")]
        } else {
            payload = ["source_type": .string(line.source_type), "source_id": line.source_id.map { JSONValue.string($0) } ?? JSONValue.null]
        }
        for (key, value) in patch { payload[key] = value }
        return await mutate("line:" + line.key, "save_event_settlement_line", ["p_line": .object(payload)], message)
    }

    private func toggleIncluded(_ next: Bool) {
        if !next && !manual && line.auto_included {
            ask(SettlementConfirm(title: "Wyłącz pozycję z podsumowania", description: line.name, confirmLabel: "Wyłącz pozycję",
                                  note: .init(label: "Powód wyłączenia", required: true, placeholder: "Np. faktura dotyczy innego wydarzenia", initial: line.note ?? "")) { note, _ in
                await save(["included": .bool(false), "note": .string(note)], "Pozycja wyłączona z podsumowania.")
            })
            return
        }
        if next && !manual && !line.auto_included {
            ask(SettlementConfirm(title: "Wlicz pozycję do podsumowania", description: line.name, body: line.auto_note.map { "System ją pominął: " + $0 },
                                  confirmLabel: "Wlicz pozycję",
                                  note: .init(label: "Powód wliczenia", required: true, placeholder: "Np. faktura końcowa dotyczy innego zakresu", initial: line.note ?? "")) { note, _ in
                await save(["included": .bool(true), "note": .string(note)], "Pozycja wliczona do podsumowania.")
            })
            return
        }
        Task { _ = await save(["included": .bool(next)], next ? "Pozycja wliczona do podsumowania." : "Pozycja wyłączona z podsumowania.") }
    }

    private func changeCategory(_ category: String) {
        let label = SettlementText.categories[category] ?? category
        ask(SettlementConfirm(title: "Zmienić rodzaj kosztu na „\(label)”?", description: line.name, body: SettlementText.hints[category],
                              confirmLabel: "Zmień rodzaj kosztu",
                              note: .init(label: "Powód zmiany rodzaju kosztu", required: true, placeholder: "Np. zespół muzyczny bez naszej marży — wykonawca zewnętrzny", initial: line.note ?? "")) { note, _ in
            await save(["category": .string(category), "note": .string(note)], "Rodzaj kosztu: " + label.lowercased() + ".")
        })
    }

    var body: some View {
        let meta = [line.detail, line.date.map { SettlementText.date($0) }, SettlementText.sources[line.source_type] ?? line.source_type].compactMap { $0 }.filter { !$0.isEmpty }
        let showSuggested = line.auto && line.suggested_net != nil && line.suggested_net != line.net_amount
        let showCategorySwitch = !manual && line.kind == "cost" && can("category") && ["subcontractor", "direct_cost"].contains(line.category)
        let showControls = canEdit && (can("included") || can("net") || can("note") || can("confirm") || showCategorySwitch || (manual && can("delete")))
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(line.name).font(.callout.weight(.medium)).foregroundStyle(line.included ? Color.primary : Color.secondary)
                    if !meta.isEmpty { Text(meta.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
                    if let note = line.auto_note?.nonEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
                    HStack(spacing: 6) {
                        if !line.included { tag("Wyłączone z podsumowania", Color.secondary) }
                        if line.needs_confirmation { tag("Do potwierdzenia netto", CrmTheme.rgb(0xfcd34d)) }
                        if manual && line.kind == "cost" { tag(SettlementText.categories[line.category] ?? line.category, theme.accent) }
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    (Text(SettlementText.pln(line.net_amount)).font(.callout.weight(.semibold).monospacedDigit()) + Text(" netto").font(.caption).foregroundColor(.secondary))
                        .strikethrough(!line.included)
                    if let gross = line.gross_amount { Text("brutto " + SettlementText.pln(gross)).font(.caption).foregroundStyle(.secondary) }
                    if showSuggested { Text("wyliczone: " + SettlementText.pln(line.suggested_net)).font(.caption).foregroundStyle(.secondary).help("Kwota wyliczona z dokumentów przed zmianą") }
                }
            }
            if line.source_changed {
                Text(sourceChanged).font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
            }
            if let note = line.note?.nonEmpty, !editingNote { (Text("Notatka: ").foregroundColor(.secondary) + Text(note)).font(.caption) }
            if let who = line.updated_by_name {
                Text("Zmienione: " + who + (line.updated_at.map { " · " + SettlementText.date($0, time: true) } ?? "")).font(.caption2).foregroundStyle(.secondary)
            }
            if showControls { controls(showCategorySwitch) }
            if showCategorySwitch { Text(SettlementText.hints[line.category] ?? "").font(.caption2).foregroundStyle(.secondary) }
            if editingNet { netForm }
            if editingNote { noteForm }
        }
        .padding(10)
        .background(Color.primary.opacity(line.included ? 0.04 : 0.02), in: RoundedRectangle(cornerRadius: 8))
        .opacity(saving ? 0.6 : 1)
    }

    private var sourceChanged: String {
        let from: String = SettlementText.pln(line.previous_source_net)
        let to: String = SettlementText.pln(line.suggested_net)
        let extra: String = canEdit && !can("confirm") && can("net") ? " Wpisz kwotę ponownie („Zmień netto”) albo przywróć wartości automatyczne." : ""
        return "Kwota źródła zmieniła się z " + from + " na " + to + " — potwierdź ponownie." + extra
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(color).background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
    }

    private func controls(_ showCategorySwitch: Bool) -> some View {
        HStack(spacing: 8) {
            if saving { ProgressView().controlSize(.small) }
            if can("included") {
                Toggle("Wliczona", isOn: Binding(get: { line.included }, set: { toggleIncluded($0) }))
                    .toggleStyle(.switch).controlSize(.mini).disabled(disabled)
                    .help(line.included ? "Wyłącz pozycję z podsumowania" : "Wlicz pozycję do podsumowania")
            }
            if showCategorySwitch {
                Picker("", selection: Binding(get: { line.category }, set: { value in if value != line.category { changeCategory(value) } })) {
                    Text(SettlementText.categories["subcontractor"] ?? "").tag("subcontractor")
                    Text(SettlementText.categories["direct_cost"] ?? "").tag("direct_cost")
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 300).disabled(disabled)
            }
            if line.needs_confirmation && can("confirm") && !editingNet {
                Button { Task { _ = await save(["confirmed": .bool(true)], "Kwota netto potwierdzona.") } } label: { Label("Potwierdź netto", systemImage: "checkmark") }.disabled(disabled)
            }
            if can("net") && !manual && !editingNet {
                Button { netText = SettlementText.moneyField(line.net_amount); netReason = line.note ?? ""; netError = ""; editingNet = true } label: { Label("Zmień netto", systemImage: "pencil") }.disabled(disabled)
            }
            if can("note") && !manual && !editingNote {
                Button { noteText = line.note ?? ""; editingNote = true } label: { Label(line.note == nil ? "Notatka" : "Zmień notatkę", systemImage: "note.text") }.disabled(disabled)
            }
            if manual && can("name") { Button { editManual() } label: { Label("Edytuj", systemImage: "pencil") }.disabled(disabled) }
            if manual && can("delete") {
                Button(role: .destructive) { deleteManual() } label: { Label("Usuń", systemImage: "trash") }.disabled(disabled)
            }
            if !manual && line.line_id != nil && canEdit {
                Button { resetOverride() } label: { Label("Przywróć automatyczne", systemImage: "arrow.counterclockwise") }.disabled(disabled).help("Usuń zmiany tej pozycji")
            }
        }
        .controlSize(.small)
    }

    private func resetOverride() {
        guard let id = line.line_id else { return }
        ask(SettlementConfirm(title: "Przywrócić wartości automatyczne?", description: line.name,
                              body: "Zmiany tej pozycji (wliczenie, rodzaj kosztu, kwota netto, potwierdzenie i notatka) zostaną usunięte — pozycja wróci do wartości z dokumentów.",
                              confirmLabel: "Przywróć") { _, _ in
            await mutate("line:" + line.key, "delete_event_settlement_line", ["p_line_id": .string(id)], "Przywrócono wartości automatyczne.")
        })
    }

    private func deleteManual() {
        guard let id = line.line_id else { return }
        ask(SettlementConfirm(title: "Usunąć pozycję?", description: line.name, body: "Pozycja dopisana ręcznie zniknie z podsumowania.",
                              confirmLabel: "Usuń pozycję", danger: true) { _, _ in
            await mutate("line:" + line.key, "delete_event_settlement_line", ["p_line_id": .string(id)], "Pozycja usunięta.")
        })
    }

    private var netForm: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Kwota netto (zł)", text: $netText).textFieldStyle(.roundedBorder).frame(width: 200)
            Text("Powód zmiany kwoty (wymagany, gdy koszt jest niższy albo przychód wyższy niż w dokumentach)").font(.caption).foregroundStyle(.secondary)
            TextField("Np. faktura brutto 3 690 zł = 3 000 zł netto", text: $netReason, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            HStack {
                Button("Zapisz netto") {
                    guard let value = SettlementText.money(netText) else { netError = "Podaj kwotę netto (nie ujemną), np. 1250,00."; return }
                    Task { if await save(["net_amount": .number(value), "note": .string(netReason.trimmingCharacters(in: .whitespacesAndNewlines))], "Kwota netto zapisana i potwierdzona.") { editingNet = false } }
                }
                .buttonStyle(.borderedProminent).disabled(disabled)
                if let suggested = line.suggested_net, suggested != line.net_amount {
                    Button("Przywróć " + SettlementText.pln(suggested)) {
                        Task { if await save(["net_amount": .number(suggested)], "Przywrócono kwotę wyliczoną.") { editingNet = false } }
                    }
                    .disabled(disabled)
                }
                Button("Anuluj") { editingNet = false }.disabled(disabled)
            }
            if !netError.isEmpty { Text(netError).font(.caption).foregroundStyle(.red) }
            Text("Zapisanie kwoty potwierdza netto tej pozycji.").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(10).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    private var noteForm: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Notatka", text: $noteText, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            HStack {
                Button("Zapisz notatkę") {
                    Task { if await save(["note": .string(noteText.trimmingCharacters(in: .whitespacesAndNewlines))], "Notatka zapisana.") { editingNote = false } }
                }
                .buttonStyle(.borderedProminent).disabled(disabled)
                Button("Anuluj") { editingNote = false }.disabled(disabled)
            }
        }
        .padding(10).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: Pozycja ręczna (`ManualLineForm`)

@MainActor private struct SettlementManualForm: View {
    let line: Settlement.Line?
    let busy: String?
    let save: ([String: JSONValue], Bool) async -> Bool
    let close: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var kind = "cost"
    @State private var category = "direct_cost"
    @State private var name = ""
    @State private var net = ""
    @State private var note = ""
    @State private var error = ""
    @State private var prepared = false

    private static let costCategories = ["subcontractor", "direct_cost", "team", "external_commission"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(line == nil ? "Nowa pozycja" : "Edytuj pozycję dopisaną ręcznie").font(.callout.weight(.semibold))
            Picker("Rodzaj", selection: $kind) {
                Text("Przychód").tag("revenue")
                Text("Koszt").tag("cost")
            }
            .pickerStyle(.segmented).frame(width: 260)
            if kind == "cost" {
                Picker("Rodzaj kosztu", selection: $category) {
                    ForEach(Self.costCategories, id: \.self) { Text(SettlementText.categories[$0] ?? $0).tag($0) }
                }
                .frame(width: 360)
                Text(SettlementText.hints[category] ?? "").font(.caption).foregroundStyle(.secondary)
            }
            TextField(kind == "revenue" ? "Np. dopłata klienta gotówką" : "Np. wynajem namiotu", text: $name).textFieldStyle(.roundedBorder)
            TextField("Kwota netto (zł), np. 0,00", text: $net).textFieldStyle(.roundedBorder).frame(width: 220)
            TextField("Notatka (opcjonalnie)", text: $note, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Anuluj") { close() }.disabled(busy == "manual")
                Button(line == nil ? "Dodaj pozycję" : "Zapisz pozycję") { Task { await submit() } }.buttonStyle(.borderedProminent).disabled(busy != nil)
            }
        }
        .padding(12).background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        .onAppear {
            guard !prepared else { return }
            prepared = true
            if let line {
                kind = line.kind
                if line.kind == "cost" && Self.costCategories.contains(line.category) { category = line.category }
                name = line.name
                net = SettlementText.moneyField(line.net_amount)
                note = line.note ?? ""
            }
        }
    }

    private func submit() async {
        guard busy == nil else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 300 else { error = "Podaj nazwę pozycji (do 300 znaków)."; return }
        guard let value = SettlementText.money(net) else {
            error = "Podaj kwotę netto (nie ujemną) z dokładnością do grosza, np. 1250,00. Korektę przychodu wystawia się fakturą korygującą."
            return
        }
        error = ""
        var payload: [String: JSONValue] = [
            "source_type": .string("manual"), "kind": .string(kind), "category": .string(kind == "revenue" ? "revenue" : category), "name": .string(trimmed),
            "net_amount": .number(value), "included": .bool(line?.included ?? true), "note": .string(note.trimmingCharacters(in: .whitespacesAndNewlines)),
        ]
        if let id = line?.line_id { payload["line_id"] = .string(id) }
        if await save(payload, line != nil) { close() }
    }
}

// MARK: Potwierdzenie (`SettlementConfirmDialog`)

@MainActor private struct SettlementConfirmSheet: View {
    let request: SettlementConfirm
    let settlement: Settlement?
    let busy: Bool
    let close: () -> Void
    @State private var note = ""
    @State private var option = false
    @State private var error = ""
    @State private var running = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(request.title).font(.title3.bold())
            if let description = request.description { Text(description).font(.callout).foregroundStyle(.secondary) }
            if let body = request.body { Text(body).font(.callout) }
            if request.showTotals, let totals = settlement?.totals {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                    GridRow {
                        Text("Przychód netto").foregroundStyle(.secondary)
                        Text(SettlementText.pln(totals.revenue_net))
                    }
                    GridRow {
                        Text("Zysk netto").foregroundStyle(.secondary)
                        Text(SettlementText.pln(totals.profit_net))
                    }
                    GridRow {
                        Text("Prowizje pracowników").foregroundStyle(.secondary)
                        Text(SettlementText.pln(totals.internal_commissions))
                    }
                }
                .font(.callout).padding(10).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            if let field = request.note {
                Text(field.label + (field.required ? " *" : " (opcjonalnie)")).font(.caption.weight(.semibold))
                TextEditor(text: Binding(get: { note }, set: { note = String($0.prefix(2000)); error = "" }))
                    .frame(minHeight: 90).font(.body).scrollContentBackground(.hidden).padding(6)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                Text("\(note.count)/2000").font(.caption2).foregroundStyle(.secondary)
            }
            if let choice = request.option {
                Toggle(isOn: $option) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(choice.label)
                        Text(choice.hint).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if !error.isEmpty { Text(error).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Anuluj") { close() }.keyboardShortcut(.cancelAction).disabled(running)
                Button(running ? "Zapisywanie…" : request.confirmLabel) { Task { await confirm() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).tint(request.danger ? Color.red : nil).disabled(running || busy)
            }
        }
        .padding(20).frame(width: 520)
        .onAppear { note = request.note?.initial ?? "" }
    }

    private func confirm() async {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if let field = request.note, field.required, trimmed.isEmpty { error = "Uzupełnij pole „\(field.label)”."; return }
        running = true
        let ok = await request.run(trimmed, request.option != nil && option)
        running = false
        if ok { close() }
    }
}

// MARK: Stawka sprzedawcy (`SellerRateDialog`)

@MainActor private struct SettlementRateSheet: View {
    let seller: Settlement.External
    let mutate: (String, String, [String: JSONValue], String?) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var rate = ""
    @State private var reason = ""
    @State private var error = ""
    @State private var saving = false

    var body: some View {
        let card: String = seller.card_rate.map { SettlementText.percent($0) + " od zysku" } ?? "brak stawki"
        return VStack(alignment: .leading, spacing: 12) {
            Text("Stawka dla wydarzenia — " + seller.name).font(.title3.bold())
            Text("Karta sprzedawcy: " + card + ". Zmiana dotyczy tylko tego wydarzenia.").font(.callout).foregroundStyle(.secondary)
            TextField("Stawka (% od zysku)", text: $rate).textFieldStyle(.roundedBorder).frame(width: 200)
            TextField("Powód * — np. uzgodnione z hotelem dla tej konferencji", text: $reason).textFieldStyle(.roundedBorder)
            if !error.isEmpty { Text(error).font(.callout).foregroundStyle(.red) }
            HStack {
                if seller.rate_override { Button("Wróć do stawki z karty") { Task { await save(nil) } }.disabled(saving) }
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(saving)
                Button("Zapisz stawkę") {
                    guard let value = SettlementText.percentInput(rate), value > 0 else { error = "Podaj stawkę większą od 0% (najwyżej 100%, do 0,01)."; return }
                    guard reason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 else { error = "Podaj powód stawki dla tego wydarzenia (widoczny w historii prowizji)."; return }
                    error = ""
                    Task { await save(value) }
                }
                .buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(20).frame(width: 480)
        .onAppear { rate = SettlementText.percentField(seller.rate) }
    }

    private func save(_ value: Double?) async {
        saving = true
        defer { saving = false }
        let params: [String: JSONValue] = [
            "p_sales_partner_id": .string(seller.partner_id), "p_rate": value.map { JSONValue.number($0) } ?? JSONValue.null,
            "p_reason": value == nil ? JSONValue.null : JSONValue.string(reason.trimmingCharacters(in: .whitespacesAndNewlines)),
        ]
        if await mutate("seller-rate", "set_event_settlement_seller_rate", params,
                        value == nil ? "Przywrócono stawkę z karty sprzedawcy." : "Stawka dla wydarzenia zapisana — prowizja przeliczona.") { dismiss() }
    }
}

// MARK: Dodaj sprzedawcę (`AddSettlementSellerDialog`)

private struct SellerCandidates: Decodable {
    struct Candidate: Decodable, Identifiable, Hashable {
        var partnerId: String; var name: String; var organization: String?; var rate: Double?; var paymentMethod: String?
        var ready: Bool; var suggestion: String?; var inEvent: Bool
        var id: String { partnerId }
    }
    var error: String?
    var candidates: [Candidate]
}

@MainActor private struct SettlementSellerSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let mutate: (String, String, [String: JSONValue], String?) async -> Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var candidates: [SellerCandidates.Candidate] = []
    @State private var listError = ""
    @State private var loading = false
    @State private var selected: SellerCandidates.Candidate?
    @State private var customRate = false
    @State private var rate = ""
    @State private var reason = ""
    @State private var error = ""
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dodaj sprzedawcę zewnętrznego").font(.title3.bold())
            Text("Prowizja sprzedawcy to % od zysku netto wydarzenia — po kosztach i po koszcie samej prowizji. Sprzedawca zobaczy podsumowanie w portalu, gdy ma widoczne wynagrodzenie.")
                .font(.callout).foregroundStyle(.secondary)
            if let selected { form(selected) } else { picker }
        }
        .padding(20).frame(width: 600, height: 560, alignment: .topLeading)
        .task(id: search) {
            guard selected == nil else { return }
            if !search.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            loading = true
            let reply = try? await store.tabQuery(eventID, "summary", "sellers", ["search": search], as: SellerCandidates.self)
            guard !Task.isCancelled else { return }
            loading = false
            candidates = reply?.candidates ?? []
            listError = reply?.error ?? (reply == nil ? "Nie udało się wczytać sprzedawców." : "")
        }
    }

    private var picker: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Imię, nazwisko albo hotel / agencja…", text: $search).textFieldStyle(.roundedBorder)
            if search.trimmingCharacters(in: .whitespaces).isEmpty {
                Text("Podpowiedzi: osoba kontaktowa, kontakt rozliczeniowy i pracownicy klienta tego wydarzenia.").font(.caption).foregroundStyle(.secondary)
            }
            if !listError.isEmpty { Text(listError).font(.callout).foregroundStyle(.red) }
            if loading && candidates.isEmpty {
                ProgressView("Szukam sprzedawców…")
            } else if candidates.isEmpty && listError.isEmpty {
                Text(search.trimmingCharacters(in: .whitespaces).isEmpty
                     ? "Nikt z osób związanych z wydarzeniem nie jest sprzedawcą. Wyszukaj sprzedawcę albo mianuj kontakt sprzedawcą na jego karcie."
                     : "Brak aktywnych sprzedawców pasujących do wyszukiwania.").font(.callout).foregroundStyle(.secondary)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(candidates) { candidate in candidateRow(candidate) }
                }
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }
            }
        }
    }

    private func candidateRow(_ candidate: SellerCandidates.Candidate) -> some View {
        let blocked = candidate.inEvent || !candidate.ready
        let rateText: String = (candidate.rate ?? 0) > 0 ? SettlementText.percent(candidate.rate) + " od zysku" : "Stawka 0%"
        return VStack(alignment: .leading, spacing: 4) {
            Button {
                selected = candidate
                customRate = false
                rate = SettlementText.percentField(candidate.rate)
                error = ""
            } label: {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(candidate.name + (candidate.organization.map { " · " + $0 } ?? "")).font(.callout.weight(.medium))
                        if let suggestion = candidate.suggestion { Text(suggestion).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        if candidate.inEvent { Text("Już w podsumowaniu").font(.caption).foregroundStyle(.secondary) }
                        else if candidate.ready {
                            Text(rateText).font(.caption)
                            if let method = candidate.paymentMethod { Text(SettlementText.payments[method] ?? method).font(.caption2).foregroundStyle(.secondary) }
                        } else {
                            Text("Brak prowizji dla marki wydarzenia").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                        }
                    }
                }
                .padding(10).contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(blocked)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            if !candidate.ready && !candidate.inEvent {
                HStack(spacing: 4) {
                    Text("Ustaw % od zysku na").font(.caption)
                    Button("karcie sprzedawcy") { state.openCRM("/crm/salespeople?seller=\(candidate.partnerId)&section=settings") }.buttonStyle(.link).font(.caption)
                    Text(", potem wróć tutaj.").font(.caption)
                }
                .foregroundStyle(.secondary)
            }
        }
    }

    private func form(_ candidate: SellerCandidates.Candidate) -> some View {
        let hasCardRate = (candidate.rate ?? 0) > 0
        let needsRate = customRate || !hasCardRate
        let card: String = hasCardRate ? "Karta sprzedawcy: " + SettlementText.percent(candidate.rate) + " od zysku" : "Karta sprzedawcy: stawka 0%"
        return VStack(alignment: .leading, spacing: 10) {
            Button { selected = nil } label: { Label("Wybierz innego sprzedawcę", systemImage: "arrow.left") }.buttonStyle(.link)
            Text(candidate.name + (candidate.organization.map { " · " + $0 } ?? "")).font(.headline)
            Text(card + (candidate.paymentMethod.map { " · " + (SettlementText.payments[$0] ?? $0) } ?? "")).font(.callout).foregroundStyle(.secondary)
            if hasCardRate {
                Toggle(isOn: $customRate) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Inna stawka dla tego wydarzenia")
                        Text("Karta sprzedawcy zostaje bez zmian.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if needsRate {
                TextField("Stawka (% od zysku), np. 10", text: $rate).textFieldStyle(.roundedBorder).frame(width: 220)
                TextField("Powód * — np. uzgodnione z hotelem dla tej konferencji", text: $reason).textFieldStyle(.roundedBorder)
            }
            if !error.isEmpty { Text(error).font(.callout).foregroundStyle(.red) }
            Spacer()
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(saving)
                Button("Dodaj sprzedawcę") { Task { await submit(candidate, needsRate) } }.buttonStyle(.borderedProminent).disabled(saving)
            }
        }
    }

    private func submit(_ candidate: SellerCandidates.Candidate, _ needsRate: Bool) async {
        var value: Double?
        if needsRate {
            guard let parsed = SettlementText.percentInput(rate), parsed > 0 else { error = "Podaj stawkę większą od 0% (najwyżej 100%, do 0,01)."; return }
            guard reason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 else { error = "Podaj powód stawki dla tego wydarzenia (widoczny w historii prowizji)."; return }
            value = parsed
        }
        error = ""
        saving = true
        defer { saving = false }
        let params: [String: JSONValue] = [
            "p_sales_partner_id": .string(candidate.partnerId), "p_rate": value.map { JSONValue.number($0) } ?? JSONValue.null,
            "p_reason": value == nil ? JSONValue.null : JSONValue.string(reason.trimmingCharacters(in: .whitespacesAndNewlines)),
        ]
        if await mutate("seller-add", "add_event_settlement_seller", params, "Sprzedawca dodany do podsumowania — prowizja przeliczona.") { dismiss() }
    }
}

// MARK: Faktura kosztowa (`CostInvoiceLinkDialog`)

private struct InvoiceCandidates: Decodable {
    struct Candidate: Decodable, Identifiable, Hashable {
        var source: String; var id: String; var number: String?; var sellerName: String?; var sellerNip: String?; var issueDate: String?
        var net: Double?; var gross: Double?; var firstItem: String?; var allocated: Double; var remainingGross: Double; var linkedToEvent: Bool
        var key: String { source + ":" + id }
    }
    var forbidden: String?
    var error: String?
    var candidates: [Candidate]
}

@MainActor private struct SettlementInvoiceSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let mutate: (String, String, [String: JSONValue], String?) async -> Bool
    let onForbidden: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var candidates: [InvoiceCandidates.Candidate] = []
    @State private var forbidden = ""
    @State private var listError = ""
    @State private var loading = false
    @State private var selected: InvoiceCandidates.Candidate?
    @State private var part = ""
    @State private var category = "direct_cost"
    @State private var name = ""
    @State private var error = ""
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dodaj fakturę kosztową").font(.title3.bold())
            Text("Faktury kosztowe marki wydarzenia, najbliższe dacie wydarzenia i jeszcze nie w pełni przypisane.").font(.callout).foregroundStyle(.secondary)
            if !forbidden.isEmpty {
                Text(forbidden).font(.callout).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                HStack { Spacer(); Button("Zamknij") { dismiss() } }
            } else if let selected { form(selected) } else { picker }
        }
        .padding(20).frame(width: 640, height: 580, alignment: .topLeading)
        .task(id: search) {
            guard selected == nil else { return }
            if !search.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            loading = true
            let reply = try? await store.tabQuery(eventID, "summary", "invoices", ["search": search], as: InvoiceCandidates.self)
            guard !Task.isCancelled else { return }
            loading = false
            if let message = reply?.forbidden { forbidden = message; onForbidden(); return }
            candidates = reply?.candidates ?? []
            listError = reply?.error ?? (reply == nil ? "Nie udało się wczytać faktur kosztowych." : "")
        }
    }

    private func meta(_ candidate: InvoiceCandidates.Candidate) -> String {
        [candidate.number ?? "bez numeru", SettlementText.date(candidate.issueDate), candidate.source == "ksef" ? "KSeF" : "spoza KSeF"].joined(separator: " · ")
    }

    private var picker: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Numer, sprzedawca, NIP lub pozycja faktury…", text: $search).textFieldStyle(.roundedBorder)
            if !listError.isEmpty { Text(listError).font(.callout).foregroundStyle(.red) }
            if loading && candidates.isEmpty {
                ProgressView("Szukam faktur…")
            } else if candidates.isEmpty && listError.isEmpty {
                Text(search.trimmingCharacters(in: .whitespaces).isEmpty ? "Brak faktur kosztowych do przypisania." : "Brak faktur pasujących do wyszukiwania.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(candidates, id: \.key) { candidate in
                        Button { selected = candidate; error = "" } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text((candidate.sellerName ?? "Sprzedawca nieznany") + (candidate.sellerNip.map { " · NIP " + $0 } ?? "")).font(.callout.weight(.medium))
                                        Text(meta(candidate)).font(.caption).foregroundStyle(.secondary)
                                        if let item = candidate.firstItem { Text(item).font(.caption).foregroundStyle(.secondary) }
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text(SettlementText.pln(candidate.gross) + " brutto").font(.callout)
                                        Text(SettlementText.pln(candidate.net) + " netto").font(.caption).foregroundStyle(.secondary)
                                        if candidate.allocated > 0 { Text("do przypisania: " + SettlementText.pln(candidate.remainingGross)).font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
                                    }
                                }
                                if candidate.linkedToEvent { Text("Część tej faktury jest już przypisana do tego wydarzenia").font(.caption).foregroundStyle(theme.accent) }
                            }
                            .padding(10).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            HStack { Spacer(); Button("Anuluj") { dismiss() } }
        }
    }

    private func form(_ candidate: InvoiceCandidates.Candidate) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { selected = nil } label: { Label("Wybierz inną fakturę", systemImage: "arrow.left") }.buttonStyle(.link).disabled(saving)
            Text((candidate.sellerName ?? "Sprzedawca nieznany") + " · " + (candidate.number ?? "bez numeru")).font(.headline)
            Text(SettlementText.pln(candidate.gross) + " brutto · " + SettlementText.pln(candidate.net) + " netto · " + SettlementText.date(candidate.issueDate)).font(.callout).foregroundStyle(.secondary)
            Text("Pozostało do przypisania: " + SettlementText.pln(candidate.remainingGross) + " brutto").font(.callout)
            Text("Część brutto dla tego wydarzenia (opcjonalnie)").font(.caption.weight(.semibold))
            TextField("Cała pozostała kwota (" + SettlementText.pln(candidate.remainingGross) + ")", text: $part).textFieldStyle(.roundedBorder).frame(width: 300)
            Text("Puste pole = cała pozostała kwota. Netto pozycji wyliczy baza z faktury.").font(.caption).foregroundStyle(.secondary)
            Text("Rodzaj kosztu").font(.caption.weight(.semibold))
            ForEach(["subcontractor", "direct_cost"], id: \.self) { option in
                Button { category = option } label: {
                    HStack(alignment: .top) {
                        Image(systemName: category == option ? "largecircle.fill.circle" : "circle").foregroundStyle(theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(SettlementText.categories[option] ?? option).font(.callout)
                            Text(SettlementText.hints[option] ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background(category == option ? theme.accent.opacity(0.12) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            }
            TextField("Nazwa pozycji (opcjonalnie) — domyślnie: sprzedawca — pozycja — numer faktury", text: $name).textFieldStyle(.roundedBorder)
            if !error.isEmpty { Text(error).font(.callout).foregroundStyle(.red) }
            Spacer()
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(saving)
                Button("Przypisz fakturę") { Task { await submit(candidate) } }.buttonStyle(.borderedProminent).disabled(saving)
            }
        }
    }

    private func submit(_ candidate: InvoiceCandidates.Candidate) async {
        var gross: Double?
        if !part.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let value = SettlementText.money(part), value > 0 else {
                error = "Podaj dodatnią część brutto z dokładnością do grosza albo zostaw puste pole (cała pozostała kwota)."
                return
            }
            gross = value
        }
        error = ""
        saving = true
        defer { saving = false }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let params: [String: JSONValue] = [
            "p_source": .string(candidate.source), "p_invoice_id": .string(candidate.id), "p_gross_amount": gross.map { JSONValue.number($0) } ?? JSONValue.null,
            "p_category": .string(category), "p_name": trimmed.isEmpty ? JSONValue.null : JSONValue.string(trimmed),
        ]
        if await mutate("link-invoice", "link_event_cost_invoice", params, "Faktura kosztowa przypisana do wydarzenia.") { dismiss() }
    }
}

// MARK: Sprzedawca wydarzenia (`SalesSharesEditor`)

private struct ShareEmployees: Decodable { struct Employee: Decodable, Hashable { var id: String; var name: String }; var error: String?; var employees: [Employee] }

@MainActor private struct SettlementSharesEditor: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let people: [Settlement.Internal]
    let busy: Bool
    let mutate: (String, String, [String: JSONValue], String?) async -> Bool
    @Environment(\.crmTheme) private var theme
    @State private var open = false
    @State private var employees: [ShareEmployees.Employee] = []
    @State private var employeesError = ""
    @State private var rows: [Row] = []
    @State private var reason = ""
    @State private var error = ""
    @State private var saving = false

    struct Row: Identifiable, Hashable { let id = UUID(); var employeeID: String; var percent: String; var clientOwned: String; var current: Bool? }

    private var hundredths: Int { rows.reduce(0) { $0 + Int(((SettlementText.percentInput($1.percent) ?? 0) * 100).rounded()) } }
    private var invalidPercent: Bool { rows.contains { (SettlementText.percentInput($0.percent) ?? 0) == 0 } }
    private var sumOk: Bool { rows.isEmpty || (hundredths == 10000 && !invalidPercent) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Sprzedawca wydarzenia", systemImage: "person.crop.circle.badge.checkmark").font(.headline)
                    Text("Zapisuje się przy akceptacji oferty. Możesz zmienić osobę albo podzielić udziały (razem 100%) — zmiana trafia do historii.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if !open { Button("Zmień") { begin() }.disabled(busy) }
            }
            if !open {
                if people.isEmpty { Text("Brak zapisanego sprzedawcy.").font(.callout).foregroundStyle(.secondary) }
                ForEach(people) { item in
                    HStack {
                        Text(item.name).font(.callout)
                        if item.client_owned { Text("klient własny").font(.caption).foregroundStyle(theme.accent) }
                        Spacer()
                        Text(SettlementText.percent(item.share_percent)).font(.callout.monospacedDigit())
                    }
                }
            } else {
                editor
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func name(_ id: String) -> String {
        employees.first { $0.id == id }?.name ?? people.first { $0.employee_id == id }?.name ?? "Pracownik"
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !employeesError.isEmpty { Text(employeesError).font(.caption).foregroundStyle(.red) }
            ForEach($rows) { $row in
                let taken = Set(rows.filter { $0.id != row.id }.map(\.employeeID))
                let currentLabel: String = row.current == true ? "tak" : "nie"
                let keepLabel: String = row.current == nil ? "Wg opiekuna klienta" : "Bez zmian (" + currentLabel + ")"
                HStack {
                    Picker("Pracownik", selection: Binding(get: { row.employeeID }, set: { row.employeeID = $0; row.clientOwned = "keep"; row.current = nil })) {
                        Text("Wybierz…").tag("")
                        if !row.employeeID.isEmpty && !employees.contains(where: { $0.id == row.employeeID }) { Text(name(row.employeeID)).tag(row.employeeID) }
                        ForEach(employees.filter { !taken.contains($0.id) }, id: \.id) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden().frame(width: 170)
                    TextField("Udział (%)", text: $row.percent).textFieldStyle(.roundedBorder).frame(width: 70)
                    Picker("Klient własny", selection: $row.clientOwned) {
                        Text(keepLabel).tag("keep")
                        Text("Tak — 10%").tag("yes")
                        Text("Nie — 5%").tag("no")
                    }
                    .labelsHidden().frame(width: 140)
                    Button { let id = row.id; rows.removeAll { $0.id == id } } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red)
                }
            }
            HStack {
                Button { rows.append(Row(employeeID: "", percent: "", clientOwned: "keep", current: nil)) } label: { Label("Dodaj osobę", systemImage: "plus") }.controlSize(.small)
                Spacer()
                if rows.isEmpty { Text("Bez sprzedawcy").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
                else { Text("Razem: " + SettlementText.percent(Double(hundredths) / 100) + (sumOk ? "" : " — musi być 100%")).font(.caption).foregroundStyle(sumOk ? Color.secondary : Color.red) }
            }
            if rows.isEmpty {
                Text("Zapisanie pustej listy oznacza świadomie wydarzenie bez sprzedawcy — prowizja pracownika nie zostanie naliczona, a system nie przywróci sprzedawcy automatycznie.")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
            }
            TextField("Powód zmiany * — np. sprzedaż prowadzona wspólnie z…", text: $reason, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Anuluj") { open = false }.disabled(saving)
                Button("Zapisz sprzedawcę") { Task { await submit() } }.buttonStyle(.borderedProminent).disabled(busy || saving)
            }
        }
    }

    private func begin() {
        rows = people.map { Row(employeeID: $0.employee_id, percent: SettlementText.percentField($0.share_percent), clientOwned: "keep", current: $0.client_owned) }
        reason = ""
        error = ""
        open = true
        Task {
            let reply = try? await store.tabQuery(eventID, "summary", "employees", as: ShareEmployees.self)
            employees = reply?.employees ?? []
            employeesError = reply?.error ?? (reply == nil ? "Nie udało się wczytać listy pracowników." : "")
        }
    }

    private func submit() async {
        if rows.contains(where: { $0.employeeID.isEmpty }) { error = "Wybierz pracownika w każdym wierszu."; return }
        if Set(rows.map(\.employeeID)).count != rows.count { error = "Każdy pracownik może wystąpić raz."; return }
        if !sumOk { error = "Udziały muszą być większe od zera i dawać razem 100%."; return }
        if reason.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 { error = "Podaj powód zmiany (widoczny w historii)."; return }
        error = ""
        let shares: [JSONValue] = rows.map { row -> JSONValue in
            var item: [String: JSONValue] = ["employee_id": .string(row.employeeID), "share_percent": .number(SettlementText.percentInput(row.percent) ?? 0)]
            if row.clientOwned != "keep" { item["client_owned"] = .bool(row.clientOwned == "yes") }
            return .object(item)
        }
        saving = true
        defer { saving = false }
        if await mutate("shares", "set_event_sales_shares", ["p_shares": .array(shares), "p_reason": .string(reason.trimmingCharacters(in: .whitespacesAndNewlines))],
                        rows.isEmpty ? "Zapisano: wydarzenie bez sprzedawcy." : "Sprzedawca wydarzenia zapisany — prowizje przeliczone.") {
            open = false
        }
    }
}
