import SwiftUI

// MARK: Panel jednej operacji uzgodnienia: dane z wyciągu, rozliczenie (dokumenty, wypłaty, deklaracje, umowy, zwroty)
// z cofaniem, wyjaśnienie bez faktury, propozycja systemu (zatwierdź / odrzuć / wybierz inny) i ręczne rozliczenie.

struct ReconciliationInspector: View {
    @ObservedObject var store: FinanceBankStore
    let month: BankMonth
    let tx: BankTx
    let open: (ReconSheet) -> Void
    let preview: (String, String) -> Void
    @Environment(\.crmTheme) private var theme

    private var canManage: Bool { month.canManage }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                heading
                if tx.linkCount > 0 { links }
                if let explanation = tx.explanation { explanationView(explanation) }
                if let proposal = tx.proposal {
                    if proposal.kind == "hint" {
                        Label(proposal.reason, systemImage: "questionmark.folder").font(.callout).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        proposalView(proposal)
                    }
                }
                if canManage && tx.isOpen { manual }
                if !canManage {
                    Text("Podgląd — zmiany w rozliczeniu wymagają poziomu „Zarządzanie finansami” tej działalności.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Dane operacji
    private var heading: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(tx.displayName).font(.title3.weight(.semibold)).lineLimit(2).textSelection(.enabled)
                Spacer(minLength: 8)
                Text(tx.signedAmount).font(.title3.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(tx.credit ? CrmTheme.rgb(0x4ade80) : Color.primary).fixedSize()
            }
            HStack(spacing: 8) {
                BankChip(text: BankStatus.label(tx.status), color: BankStatus.color(tx.status))
                if tx.status == "partial" {
                    Text("pozostało \(FinFormat.money(tx.remaining, tx.currency))").font(.caption).foregroundStyle(.secondary)
                }
                Text("\(FinFormat.day(tx.date)) · \(tx.accountKind == "vat" ? "rachunek VAT" : "rachunek bieżący")").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Button { open(.details(tx.id)) } label: { Label("Szczegóły płatności", systemImage: "info.circle") }
                    .buttonStyle(.borderless).font(.caption).fixedSize()
            }
            if tx.unconfirmed {
                Label("Tej operacji nie ma w drugim pliku wyciągu.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
            }
            VStack(alignment: .leading, spacing: 4) {
                field("Tytuł", tx.title ?? "—")
                if let description = tx.sourceDescription { field("Opis z PDF", description) }
                if let account = tx.counterpartyAccount?.nonEmpty { field("Rachunek kontrahenta", BankFormat.account(account)) }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func field(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func section<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol).font(.headline)
            content()
        }
    }

    // MARK: Rozliczenie
    private var links: some View {
        section("Rozliczenie", symbol: "checkmark.seal") {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(tx.allocations) { a in
                    linkRow(symbol: "doc.text", title: "\(a.sourceLabel) \(a.number ?? "dokument")",
                            detail: [a.party, "\(FinFormat.money(a.amount, tx.currency))\(BankFormat.foreign(a.documentAmount, a.documentCurrency, a.rate))", a.method].compactMap { $0 }.joined(separator: " · "),
                            warning: a.open > 0.009 ? "Faktura częściowo opłacona, pozostało \(FinFormat.money(a.open, tx.currency))" : nil,
                            facts: a.facts, reasons: a.reasons,
                            preview: previewAction(a.previewable ? a.source : nil, a.documentId),
                            undo: undoAction("Cofnij dopasowanie", kind: "match", id: a.matchId))
                }
                ForEach(tx.personnel) { p in
                    linkRow(symbol: "person.crop.circle", title: "Wypłata: \(p.recipient)" + (p.contractNumber.map { " (umowa \($0))" } ?? ""),
                            detail: "\(FinFormat.money(p.amount, tx.currency)) · \(p.method)", warning: nil, facts: nil, reasons: p.reasons, preview: nil,
                            undo: undoAction("Odepnij wypłatę", kind: "personnel", id: p.id))
                }
                ForEach(tx.declarations) { d in
                    linkRow(symbol: "building.columns", title: d.label,
                            detail: "\(FinFormat.money(d.amount, tx.currency)) · \(d.method) · \(DeclarationStatus.label(d.status))", warning: nil, facts: nil, reasons: d.reasons, preview: nil,
                            undo: undoAction("Odepnij od deklaracji", kind: "declaration", id: d.paymentId))
                }
                ForEach(tx.contracts) { c in
                    linkRow(symbol: "calendar.badge.clock", title: "Umowa: \(c.title)",
                            detail: "\(c.periodLabel) · \(FinFormat.money(c.amount, tx.currency)) · \(c.method)",
                            warning: c.periodPaid < c.periodAmount - 0.009 ? "Okres opłacony w części: \(FinFormat.money(c.periodPaid, tx.currency)) z \(FinFormat.money(c.periodAmount, tx.currency))" : nil,
                            facts: nil, reasons: c.reasons, preview: nil,
                            undo: undoAction("Odepnij od umowy", kind: "contract", id: c.paymentId))
                }
                ForEach(tx.refunds) { r in
                    let otherRole = r.role == "payment" ? "refund" : "payment"
                    let label = otherRole == "refund" ? "Zwrot" : "Zwrócona płatność"
                    let sign = r.other.direction == "credit" ? "+" : "−"
                    let partial = abs(r.amount - r.other.amount) > 0.009 || abs(r.amount - tx.amount) > 0.009
                    linkRow(symbol: "arrow.uturn.backward", title: "\(label): \(sign)\(FinFormat.money(r.other.amount, r.other.currency)) z \(BankFormat.shortDate(r.other.date, year: month.year))",
                            detail: [r.other.counterparty, r.method].compactMap { $0 }.joined(separator: " · "),
                            warning: partial ? "Para \(FinFormat.money(r.amount, tx.currency))" + (r.role == "payment" && r.amount < tx.amount - 0.009 ? " (zwrot częściowy)" : "") : nil,
                            facts: nil, reasons: r.reasons,
                            preview: nil, details: { open(.details(r.other.id)) },
                            undo: undoAction("Cofnij powiązanie płatności ze zwrotem", kind: "refund", id: r.pairId))
                }
            }
        }
    }

    private func previewAction(_ source: String?, _ id: String?) -> (() -> Void)? {
        guard let source, let id else { return nil }
        return { preview(source, id) }
    }

    private func undoAction(_ title: String, kind: String, id: String) -> (String, () -> Void)? {
        guard canManage else { return nil }
        let store = store
        let tx = tx
        return (title, { Task { await store.undo(tx, kind: kind, id: id) } })
    }

    private func linkRow(symbol: String, title: String, detail: String, warning: String?, facts: String?, reasons: [String],
                         preview: (() -> Void)?, details: (() -> Void)? = nil, undo: (String, () -> Void)?) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol).foregroundStyle(CrmTheme.rgb(0x86efac)).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.callout.weight(.medium)).lineLimit(2)
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                if let warning { Text(warning).font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)) }
                if let facts { Text(facts).font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 4)
            if let preview {
                Button(action: preview) { Image(systemName: "eye") }.buttonStyle(.borderless).help("Podgląd dokumentu")
            }
            if let details {
                Button(action: details) { Image(systemName: "info.circle") }.buttonStyle(.borderless).help("Szczegóły drugiej operacji")
            }
            if let undo {
                Button(action: undo.1) { Image(systemName: "arrow.uturn.backward.circle") }.buttonStyle(.borderless)
                    .foregroundStyle(CrmTheme.rgb(0xfca5a5)).help(undo.0)
            }
        }
        .padding(8)
        .background(CrmTheme.rgb(0x22c55e).opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(CrmTheme.rgb(0x22c55e).opacity(0.18)))
        .help(reasons.joined(separator: "\n"))
    }

    // MARK: Wyjaśnienie bez faktury
    private func explanationView(_ explanation: BankTx.Explanation) -> some View {
        section("Wyjaśnienie bez faktury", symbol: "text.bubble") {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(explanation.label) · \(explanation.automatic ? "reguła automatyczna" : "wyjaśnione ręcznie")").font(.callout.weight(.medium))
                if let note = explanation.note?.nonEmpty { Text(note).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                if canManage {
                    HStack(spacing: 8) {
                        if tx.status == "explained" && explanation.category == "tax_or_zus" && tx.remaining > 0.009 && !tx.credit {
                            Button { open(.declaration(tx)) } label: { Label("Przypisz do deklaracji", systemImage: "link") }
                        }
                        if tx.status != "transfer" {
                            Button { Task { await store.undo(tx, kind: "explanation", id: nil) } } label: { Label("Cofnij wyjaśnienie", systemImage: "arrow.uturn.backward") }
                        }
                    }
                    .controlSize(.small)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CrmTheme.rgb(0x14b8a6).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: Propozycja systemu
    private func proposalView(_ proposal: BankTx.Proposal) -> some View {
        let choose = proposal.kind == "choose"
        let confirmNet = proposal.documents.contains(where: \.confirmNet)
        let acceptTitle = confirmNet
            ? (choose ? "Potwierdź netto i powiąż wybraną" : "Potwierdź netto i powiąż")
            : proposal.isRefund ? (choose ? "Zatwierdź wybraną parę" : "Zatwierdź parę") : (choose ? "Zatwierdź wybrany" : "Zatwierdź")
        return section("Propozycja: \(proposal.ruleLabel)", symbol: "sparkles") {
            VStack(alignment: .leading, spacing: 8) {
                Text(proposal.reason).font(.callout).fixedSize(horizontal: false, vertical: true)
                ForEach(Array(proposal.documents.enumerated()), id: \.offset) { index, doc in
                    proposalDocument(doc, index: index, proposal: proposal)
                }
                if canManage {
                    HStack(spacing: 8) {
                        Button { Task { await store.accept(tx) } } label: { Label(acceptTitle, systemImage: "checkmark") }
                            .buttonStyle(.borderedProminent)
                            .disabled(choose && store.choice[proposal.id] == nil)
                        Button { Task { await store.reject(tx) } } label: { Label("Odrzuć", systemImage: "xmark") }
                        Button {
                            Task {
                                if await store.reject(tx) { open(proposal.isRefund ? .refund(tx) : .picker(tx)) }
                            }
                        } label: { Label(proposal.isRefund ? "Odrzuć i wybierz inną operację" : "Odrzuć i wybierz inny", systemImage: "doc.text.magnifyingglass") }
                        .help(proposal.isRefund ? "Odrzuć tę parę i od razu wybierz właściwą drugą operację (zwrot lub płatność)" : "Odrzuć tę propozycję i od razu wybierz właściwy dokument dla tej płatności")
                    }
                    .controlSize(.small)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CrmTheme.rgb(0xf59e0b).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(CrmTheme.rgb(0xf59e0b).opacity(0.25)))
        }
    }

    private func proposalDocument(_ doc: BankTx.ProposalDoc, index: Int, proposal: BankTx.Proposal) -> some View {
        let choose = proposal.kind == "choose"
        let selected = store.choice[proposal.id] == index
        return HStack(alignment: .top, spacing: 8) {
            if choose {
                Button { store.choice[proposal.id] = index } label: {
                    Image(systemName: selected ? "largecircle.fill.circle" : "circle").foregroundStyle(selected ? theme.accent : Color.secondary)
                }
                .buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(doc.sourceLabel).font(.caption2).padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 4))
                    Text(doc.number ?? "Dokument bez numeru").font(.callout.weight(.medium)).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(FinFormat.money(doc.amount, tx.currency) + BankFormat.foreign(doc.documentAmount, doc.documentCurrency, doc.rate))
                        .font(.callout).monospacedDigit().lineLimit(1).fixedSize()
                }
                if let party = doc.party { Text(party).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                HStack(spacing: 6) {
                    if doc.manual { BankChip(text: "opłacona ręcznie", color: CrmTheme.rgb(0xfcd34d)) }
                    if doc.createsDeclaration { BankChip(text: "deklaracja zostanie założona", color: CrmTheme.rgb(0xfcd34d)) }
                    if let label = doc.periodLabel, doc.source == "contract" {
                        let differs = doc.contractAmount.map { abs($0 - doc.amount) > 0.009 } ?? false
                        BankChip(text: "okres \(label)" + (differs ? " (z \(FinFormat.money(doc.contractAmount ?? 0, tx.currency)))" : ""), color: theme.accent)
                    }
                    if doc.confirmNet { BankChip(text: "netto do potwierdzenia", color: CrmTheme.rgb(0xfcd34d)) }
                    if doc.source == "refund", let id = doc.id {
                        Button("Szczegóły płatności") { open(.details(id)) }.buttonStyle(.link).font(.caption)
                    }
                    if doc.previewable, let id = doc.id {
                        Button("Podgląd") { preview(doc.source, id) }.buttonStyle(.link).font(.caption)
                    }
                }
                if let facts = doc.facts { Text(facts).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                if let hint = doc.hint {
                    Label((doc.suggested ? "Sugerowany: " : "") + hint, systemImage: "info.circle")
                        .font(.caption).foregroundStyle(doc.suggested ? CrmTheme.rgb(0x86efac) : Color.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(6)
        .background(doc.suggested ? CrmTheme.rgb(0x22c55e).opacity(0.07) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { if choose { store.choice[proposal.id] = index } }
    }

    // MARK: Ręczne rozliczenie
    private var manual: some View {
        section("Rozlicz ręcznie", symbol: "hand.point.up.left") {
            VStack(alignment: .leading, spacing: 6) {
                manualButton("Wybierz dokument", detail: "Faktura KSeF, CRM, spoza KSeF albo wypłata — także płatność częściowa", symbol: "doc.text.magnifyingglass") { open(.picker(tx)) }
                manualButton("Wyjaśnij bez faktury", detail: "Opłata bankowa, przelew własny, transfer VAT, ZUS, wynagrodzenie, gotówka…", symbol: "arrow.left.arrow.right") { open(.explain(tx, "other")) }
                if tx.credit && tx.looksLikeCashDeposit {
                    manualButton("Wpłata własna", detail: "Gotówka właściciela we wpłatomacie — nie jest przychodem", symbol: "banknote") { open(.explain(tx, "owner_deposit")) }
                }
                manualButton("Przypisz do umowy stałej", detail: "Najem, leasing, abonament, raty — okres i kwota", symbol: "calendar.badge.clock") { open(.contract(tx)) }
                manualButton("Powiąż ze zwrotem", detail: tx.credit ? "To zwrot wcześniejszej płatności (albo nasza płatność zwrócona klientowi)" : "Sklep lub kontrahent zwrócił pieniądze bez faktury", symbol: "arrow.uturn.backward") { open(.refund(tx)) }
                if !tx.credit {
                    manualButton("Przypisz do deklaracji", detail: "ZUS, PIT-4R, VAT-7, CIT — przelew do urzędu", symbol: "building.columns") { open(.declaration(tx)) }
                }
            }
        }
    }

    private func manualButton(_ title: String, detail: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).frame(width: 20).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.callout.weight(.medium))
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
