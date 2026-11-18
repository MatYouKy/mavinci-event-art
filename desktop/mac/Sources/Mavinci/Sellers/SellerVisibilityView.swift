import SwiftUI

// MARK: Wynagrodzenie w portalu sprzedawcy — przełącznik na karcie sprzedawcy i okno potwierdzenia (`CommissionVisibilityToggle`)
//
// Zakładka „Moje wynagrodzenie”, prognoza wynagrodzenia na pulpicie i kwoty prowizji przy ofertach są w portalu tylko wtedy,
// gdy co najmniej jedna aktywna marka sprzedawcy ma włączony podgląd wynagrodzenia (`commissions_visible`,
// `sellerAnyCommissionsVisible` w `src/lib/seller/portal.ts`). Prowizje naliczają się i są widoczne w CRM niezależnie od tego
// ustawienia. Zmiana — op `visibility` (`set_seller_commission_visibility`, po jednej marce, jak przełącznik marki w CRM): powód
// trafia do historii zmian, przy pokazaniu sprzedawca może dostać powiadomienie w portalu. Uprawnienia sprawdza baza (opiekun
// sprzedawcy, finanse, administrator). Ten sam przełącznik marki — w ustawieniach sprzedawcy (`SellerSettingsView.swift`).

/// Marka, której dotyczy zmiana widoczności wynagrodzenia.
struct SellerVisibilityBrand: Identifiable, Hashable {
    let companyId: String
    let name: String
    var id: String { companyId }
}

/// Zmiana widoczności wynagrodzenia w portalu — jedna marka albo kilka naraz (przełącznik całej zakładki).
struct SellerVisibilityChange: Identifiable {
    let id = UUID()
    let brands: [SellerVisibilityBrand]
    /// Docelowy stan: true — pokaż, false — ukryj.
    let visible: Bool
    /// Po zmianie zakładka „Moje wynagrodzenie” pojawi się w portalu albo z niego zniknie (żadna inna aktywna marka
    /// nie ma widocznego wynagrodzenia).
    let wholeTab: Bool

    var names: String { brands.map(\.name).joined(separator: ", ") }
}

/// Teksty okna i komunikatów (jak `CommissionVisibilityToggle` w CRM, z dopiskiem o całej zakładce).
enum SellerVisibilityText {
    static func title(_ change: SellerVisibilityChange) -> String {
        if change.brands.count == 1 {
            return change.visible ? "Pokazać wynagrodzenie — \(change.names)?" : "Ukryć wynagrodzenie — \(change.names)?"
        }
        return change.visible ? "Pokazać wynagrodzenie w portalu?" : "Ukryć wynagrodzenie w portalu?"
    }

    static func detail(_ change: SellerVisibilityChange) -> String {
        let single = change.brands.count == 1
        var text: String
        if change.visible {
            text = single
                ? "Sprzedawca zobaczy prowizje i dostanie powiadomienie. W portalu pojawią się stawka, naliczenia i historia wypłat tej marki."
                : "Sprzedawca zobaczy prowizje marek: \(change.names). W portalu pojawią się stawki, naliczenia i historia wypłat."
            if change.wholeTab { text += " Pojawi się też zakładka „Moje wynagrodzenie” i prognoza wynagrodzenia na pulpicie." }
        } else {
            text = single
                ? "Sprzedawca przestanie widzieć stawkę, naliczenia i wypłaty tej marki."
                : "Sprzedawca przestanie widzieć stawki, naliczenia i wypłaty marek: \(change.names)."
            if change.wholeTab { text += " Z portalu zniknie zakładka „Moje wynagrodzenie”, prognoza wynagrodzenia na pulpicie i kwoty prowizji przy ofertach." }
            text += " Prowizje nadal będą naliczane i rozliczane w CRM."
        }
        return text
    }

    static func done(_ change: SellerVisibilityChange) -> String {
        let single = change.brands.count == 1
        var text: String
        if change.visible {
            text = single ? "Wynagrodzenie marki \(change.names) jest teraz widoczne w portalu." : "Wynagrodzenie marek \(change.names) jest teraz widoczne w portalu."
        } else {
            text = single ? "Ukryto wynagrodzenie marki \(change.names) w portalu." : "Ukryto wynagrodzenie marek \(change.names) w portalu."
            if change.wholeTab { text += " Sprzedawca nie widzi już zakładki „Moje wynagrodzenie”." }
        }
        return text
    }
}

extension SellersStore {
    /// „Pokaż / Ukryj wynagrodzenie w portalu” marek sprzedawcy — po kolei, jak przełącznik każdej marki w CRM; zwraca błąd albo nil.
    /// Po zmianie (także częściowej) odświeża kartę sprzedawcy i kokpit.
    func setCommissionVisibility(partner: String, change: SellerVisibilityChange, reason: String, notify: Bool) async -> String? {
        guard let api, let workspace, workspace.canWrite else { return "Zapis wymaga połączenia z serwerem CRM." }
        let note = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        var done: [String] = []
        var failure: String?
        for brand in change.brands {
            do {
                _ = try await api.post("/sellers", [
                    "op": .string("visibility"), "id": .string(partner), "companyId": .string(brand.companyId), "visible": .bool(change.visible),
                    "reason": .string(note), "notify": .bool(change.visible && notify),
                ])
                done.append(brand.name)
            } catch {
                failure = failureText(error, "Nie udało się zmienić widoczności wynagrodzenia.")
                break
            }
        }
        if !done.isEmpty {
            _ = try? await card(partner)
            await load()
        }
        if let failure {
            let message = done.isEmpty ? failure : failure + " Zmieniono już: " + done.joined(separator: ", ") + "."
            workspace.error = message
            return message
        }
        workspace.succeed(SellerVisibilityText.done(change))
        return nil
    }
}

/// Karta sprzedawcy: „Wynagrodzenie w portalu sprzedawcy” — jeden przełącznik całej zakładki „Moje wynagrodzenie”
/// (wszystkie marki z prowizją naraz) i, przy kilku markach, przełącznik każdej marki.
@MainActor struct SellerPortalPayCard: View {
    let terms: [SellerCardState.Term]
    /// Zmiana do potwierdzenia w oknie `SellerVisibilityDialog`.
    let ask: (SellerVisibilityChange) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    /// Marki, od których zależy zakładka: aktywne z prowizją (albo z włączonym podglądem — portal też je liczy).
    private var brands: [SellerCardState.Term] { terms.filter { $0.active && ($0.commission || $0.commissionsVisible) } }

    var body: some View {
        let brands = self.brands
        let shown = brands.filter(\.commissionsVisible)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: shown.isEmpty ? "eye.slash" : "eye").font(.title3)
                    .foregroundStyle(shown.isEmpty ? Color.secondary : Color.green).frame(width: 24)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Wynagrodzenie w portalu sprzedawcy").font(.headline)
                    Text(verbatim: status(brands, shown: shown)).font(.callout).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 12)
                if !brands.isEmpty {
                    Toggle("Pokaż w portalu", isOn: Binding(get: { !shown.isEmpty }, set: { on in tab(brands, show: on) }))
                        .toggleStyle(.switch)
                        .disabled(!state.canWrite)
                        .help(shown.isEmpty
                              ? "Zakładka „Moje wynagrodzenie” jest ukryta — kliknij, aby pokazać wynagrodzenie"
                              : "Zakładka „Moje wynagrodzenie” jest widoczna — kliknij, aby ukryć wynagrodzenie we wszystkich markach")
                }
            }
            if brands.count > 1 {
                ForEach(brands) { term in row(term, brands: brands) }
            }
            if !brands.isEmpty {
                Text("Prowizje naliczają się i są widoczne tutaj, w CRM, niezależnie od tego ustawienia — zmienia się tylko to, co sprzedawca widzi po zalogowaniu do portalu. Narzut jest widoczny zawsze. Każda zmiana trafia do historii zmian.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func status(_ brands: [SellerCardState.Term], shown: [SellerCardState.Term]) -> String {
        if brands.isEmpty {
            return "Sprzedawca nie ma aktywnej marki z prowizją — portal nie pokazuje zakładki „Moje wynagrodzenie”. Narzut jest widoczny zawsze."
        }
        if shown.isEmpty {
            return "Ukryte — sprzedawca nie widzi zakładki „Moje wynagrodzenie”, prognozy wynagrodzenia ani kwot prowizji przy ofertach."
        }
        if shown.count == brands.count {
            return brands.count == 1
                ? "Widoczne — sprzedawca widzi zakładkę „Moje wynagrodzenie”: stawkę, naliczenia i wypłaty."
                : "Widoczne — sprzedawca widzi zakładkę „Moje wynagrodzenie”: stawki, naliczenia i wypłaty wszystkich marek."
        }
        let hidden = brands.filter { !$0.commissionsVisible }
        return "Widoczne tylko dla marek: \(shown.map(\.name).joined(separator: ", ")). Ukryte: \(hidden.map(\.name).joined(separator: ", "))."
    }

    /// Przełącznik całej zakładki: wyłączenie ukrywa wszystkie widoczne marki, włączenie pokazuje wszystkie ukryte.
    private func tab(_ brands: [SellerCardState.Term], show: Bool) {
        let targets = brands.filter { $0.commissionsVisible != show }
        guard !targets.isEmpty else { return }
        ask(SellerVisibilityChange(brands: targets.map { SellerVisibilityBrand(companyId: $0.companyId, name: $0.name) }, visible: show, wholeTab: true))
    }

    private func row(_ term: SellerCardState.Term, brands: [SellerCardState.Term]) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(term.name).font(.callout)
                Text(verbatim: term.commission ? "Prowizja \(SellerSettingsFormat.rate(term.rate)) od zysku" : "Rozliczenie narzutem — bez prowizji")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(term.commissionsVisible ? "widoczne" : "ukryte").font(.caption)
                .foregroundStyle(term.commissionsVisible ? Color.green : Color.secondary)
            Toggle(isOn: Binding(get: { term.commissionsVisible }, set: { _ in ask(single(term, brands: brands)) })) {
                Text(verbatim: "Pokaż wynagrodzenie marki \(term.name) w portalu")
            }
            .labelsHidden().toggleStyle(.switch).controlSize(.small)
            .disabled(!state.canWrite)
            .help(term.commissionsVisible ? "Wynagrodzenie marki widoczne w portalu — kliknij, aby ukryć" : "Wynagrodzenie marki ukryte w portalu — kliknij, aby pokazać")
        }
        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func single(_ term: SellerCardState.Term, brands: [SellerCardState.Term]) -> SellerVisibilityChange {
        let others = brands.contains { $0.companyId != term.companyId && $0.commissionsVisible }
        return SellerVisibilityChange(brands: [SellerVisibilityBrand(companyId: term.companyId, name: term.name)],
                                      visible: !term.commissionsVisible, wholeTab: !others)
    }
}

/// „Pokazać / Ukryć wynagrodzenie?” (`CommissionVisibilityToggle`): powód do historii zmian i powiadomienie sprzedawcy.
@MainActor struct SellerVisibilityDialog: View {
    let change: SellerVisibilityChange
    let submit: (_ reason: String, _ notify: Bool) async -> String?
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var notify = true
    @State private var busy = false
    @State private var error: String?
    private var next: Bool { change.visible }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: SellerVisibilityText.title(change)).font(.title3)
            Text(verbatim: SellerVisibilityText.detail(change))
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Powód (opcjonalnie, trafi do historii zmian)").font(.caption).foregroundStyle(.secondary)
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $reason).font(.body).scrollContentBackground(.hidden).frame(height: 72)
                    if reason.isEmpty {
                        Text(next ? "np. Pierwsza oferta zaakceptowana — odsłaniamy wynagrodzenie" : "np. Renegocjacja warunków")
                            .foregroundStyle(.tertiary).padding(.leading, 5).allowsHitTesting(false)
                    }
                }
                .padding(4).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
                .onChange(of: reason) { _, value in if value.count > 500 { reason = String(value.prefix(500)) } }
            }
            if next {
                Toggle(isOn: $notify) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Wyślij sprzedawcy powiadomienie w portalu")
                        Text(change.brands.count > 1
                             ? "Zalecane — sprzedawca dowie się, że może sprawdzić swoje wynagrodzenie (osobne powiadomienie dla każdej marki)."
                             : "Zalecane — sprzedawca dowie się, że może sprawdzić swoje wynagrodzenie.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
            }
            if let error { Text(error).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy)
                Button {
                    Task {
                        busy = true
                        error = nil
                        let failure = await submit(reason, notify)
                        busy = false
                        if let failure { error = failure } else { dismiss() }
                    }
                } label: {
                    HStack(spacing: 6) {
                        if busy { ProgressView().controlSize(.small) } else { Image(systemName: next ? "eye" : "eye.slash") }
                        Text(next ? "Pokaż wynagrodzenie" : "Ukryj wynagrodzenie")
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(busy || !state.canWrite)
            }
        }
        .padding(20).frame(width: 500)
    }
}
