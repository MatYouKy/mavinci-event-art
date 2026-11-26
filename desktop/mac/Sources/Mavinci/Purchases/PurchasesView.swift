import SwiftUI

// MARK: Zakupy — 1:1 z `/crm/purchases` (`docs/purchases.md`): „Moje wydatki” (miesiąc: rozliczenie każdej działalności,
// dokumenty, nierozliczone miesiące, „Dodaj zakup”, „Wyślij rozliczenie”) i „Rozliczenia pracowników” (zatwierdzający: lista
// miesięcy pracowników, okno rozliczenia z „Zatwierdź” / „Zwróć do poprawy” / „Cofnij zatwierdzenie”).

private enum PurchaseEditTarget: Identifiable {
    case new
    case document(PurchaseDocument)
    var id: String {
        switch self {
        case .new: return "new"
        case .document(let document): return document.id
        }
    }
    var document: PurchaseDocument? {
        if case .document(let document) = self { return document }
        return nil
    }
}

@MainActor struct PurchasesView: View {
    @ObservedObject var store: PurchasesStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editing: PurchaseEditTarget?
    @State private var submitting: PurchaseMonthCompany?
    @State private var deleting: PurchaseDocument?
    @State private var reviewSelection: String?

    private var month: PurchaseMonth? { store.state?.month }
    private var showTabs: Bool { store.access.record && store.access.approve }
    private var showsReview: Bool { store.tab == .review || month == nil }
    private var canAdd: Bool { !showsReview && month != nil && !store.access.recordCompanies.isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Zakupy")
        .navigationSubtitle(showsReview ? "Rozliczenia pracowników" : PurchaseFormat.monthLabel(store.year, store.month))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { Task { await store.load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(store.loading)
                if canAdd {
                    Button { editing = .new } label: { Label("Dodaj zakup", systemImage: "plus") }.help("Dodaj zakup (⌘N)").keyboardShortcut("n")
                }
            }
        }
        .task(id: state.employee?.id) { await store.load() }
        .sheet(item: $editing) { target in
            PurchaseFormSheet(store: store, document: target.document) { document, created in saved(document, created: created) }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $submitting) { company in
            if let month {
                PurchaseSubmitSheet(store: store, month: month, company: company)
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(item: $store.reviewing) { reviewed in
            PurchaseReviewSheet(store: store, month: reviewed)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usunąć zakup?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { document in
            Button("Usuń", role: .destructive) { Task { await store.delete(document) } }
            Button("Anuluj", role: .cancel) {}
        } message: { document in
            Text(deleteMessage(document))
        }
    }

    // MARK: Nagłówek
    private var header: some View {
        HStack(spacing: 10) {
            if showTabs {
                Picker("Widok", selection: $store.tab) {
                    Text("Moje wydatki").tag(PurchaseTab.mine)
                    Text(store.waiting > 0 ? "Rozliczenia pracowników (\(store.waiting))" : "Rozliczenia pracowników").tag(PurchaseTab.review)
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            if !showsReview, let month {
                HStack(spacing: 2) {
                    Button { store.shift(-1) } label: { Image(systemName: "chevron.left") }.help("Poprzedni miesiąc")
                    Menu {
                        ForEach(1...12, id: \.self) { value in
                            Button(PurchaseFormat.monthName(value)) { store.setPeriod(year: store.year, month: value) }
                                .disabled(store.year * 12 + value > now.year * 12 + now.month)
                        }
                        Divider()
                        ForEach((now.year - 3)...now.year, id: \.self) { value in
                            Button("Rok \(String(value))") { store.setPeriod(year: value, month: value == now.year ? min(store.month, now.month) : store.month) }
                        }
                    } label: {
                        Text(PurchaseFormat.monthLabel(store.year, store.month))
                    }
                    .fixedSize()
                    Button { store.shift(1) } label: { Image(systemName: "chevron.right") }.help("Następny miesiąc").disabled(store.lastMonth)
                }
                if !store.isCurrentMonth {
                    Button("Bieżący miesiąc") { store.setPeriod(year: now.year, month: now.month) }
                }
                Text("Razem: \(PurchaseFormat.totalsText(PurchaseFormat.totals(month.documents)))").foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer()
            if store.loading { ProgressView().controlSize(.small) }
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
    }

    private var now: (year: Int, month: Int) { PurchaseFormat.currentMonth() }

    // MARK: Treść
    @ViewBuilder private var content: some View {
        if let error = store.loadError, store.state == nil {
            ContentUnavailableView {
                Label("Zakupy", systemImage: "cart")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.load() } }
            }
        } else if store.state == nil {
            ProgressView("Wczytywanie zakupów…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if showsReview {
            reviewList
        } else if let month {
            mine(month)
        }
    }

    private func mine(_ month: PurchaseMonth) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let error = store.loadError {
                    Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.callout)
                }
                if !month.pendingMonths.isEmpty { pendingBanner(month.pendingMonths) }
                PurchaseMonthSections(month: month, futureMonth: store.futureMonth,
                                      onOpenFile: { document in Task { await store.openFile(document) } },
                                      onEdit: { document in editing = .document(document) },
                                      onDelete: { document in deleting = document },
                                      onSubmit: { company in submitting = company })
            }
            .padding(16)
        }
    }

    /// Inne miesiące z dokumentami, które nie są wysłane ani zatwierdzone (przypomnienie o rozliczeniu).
    private func pendingBanner(_ pending: [PurchasePendingMonth]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Nierozliczone miesiące:", systemImage: "exclamationmark.triangle").font(.callout.weight(.medium))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), alignment: .leading)], alignment: .leading, spacing: 4) {
                ForEach(pending) { item in
                    Button(pendingText(item)) { store.setPeriod(year: item.year, month: item.month) }.buttonStyle(.link)
                }
            }
        }
        .foregroundStyle(CrmTheme.rgb(0xfcd34d))
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CrmTheme.rgb(0xf59e0b).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(CrmTheme.rgb(0xf59e0b).opacity(0.35)))
    }

    private func pendingText(_ item: PurchasePendingMonth) -> String {
        let returned = PurchaseSettlementStatus(code: item.status) == .returned
        return "\(PurchaseFormat.monthLabel(item.year, item.month)) (\(item.count) dok.\(returned ? ", do poprawy" : ""))"
    }

    @ViewBuilder private var reviewList: some View {
        if let rows = store.reviewRows {
            if rows.isEmpty {
                ContentUnavailableView("Brak zakupów pracowników do rozliczenia", systemImage: "cart")
            } else {
                Table(rows, selection: $reviewSelection) {
                    TableColumn("Pracownik") { row in
                        Text(row.employeeName?.nonEmpty ?? "Pracownik").lineLimit(1)
                    }.width(min: 140, ideal: 200)
                    TableColumn("Miesiąc") { row in
                        Text(PurchaseFormat.monthLabel(row.year, row.month))
                    }.width(min: 110, ideal: 130)
                    TableColumn("Działalność") { row in
                        Text(row.companyName ?? "").lineLimit(1)
                    }.width(min: 120, ideal: 180)
                    TableColumn("Stan") { row in
                        reviewState(row)
                    }.width(min: 170, ideal: 250)
                    TableColumn("Dokumenty") { row in
                        Text(String(row.documents)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                    }.width(min: 70, ideal: 90)
                    TableColumn("Suma (przy wysłaniu)") { row in
                        Text(reviewTotal(row)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                    }.width(min: 120, ideal: 170)
                }
                .contextMenu(forSelectionType: String.self) { ids in
                    if let row = rows.first(where: { ids.contains($0.id) }) {
                        Button("Otwórz rozliczenie") { open(row) }
                    }
                } primaryAction: { ids in
                    if let row = rows.first(where: { ids.contains($0.id) }) { open(row) }
                }
            }
        } else {
            ProgressView("Wczytywanie rozliczeń…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func reviewState(_ row: PurchaseReviewRow) -> some View {
        HStack(spacing: 6) {
            PurchaseStatusBadge(status: row.state)
            if row.state == .submitted, let submitted = row.submittedAt {
                Text("wysłane \(PurchaseFormat.day(submitted))").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func reviewTotal(_ row: PurchaseReviewRow) -> String {
        guard let totals = row.totals else { return "—" }
        return PurchaseFormat.totalsText(totals)
    }

    private func open(_ row: PurchaseReviewRow) {
        Task { await store.openReview(employee: row.employeeId, year: row.year, month: row.month) }
    }

    private func deleteMessage(_ document: PurchaseDocument) -> String {
        let parts = [document.sellerName ?? "", document.number ?? "", PurchaseFormat.day(document.date)].filter { !$0.isEmpty }
        return parts.joined(separator: " · ") + ". Dokument i jego plik znikną" + (document.event != nil ? ", a z eventu zniknie koszt." : ".")
    }

    /// Po zapisie: zakup z innego miesiąca — przejście do jego miesiąca (jak w CRM), inaczej świeży stan.
    private func saved(_ document: PurchaseDocument, created: Bool) {
        let parts = String((document.date ?? "").prefix(10)).split(separator: "-").compactMap { Int($0) }
        if parts.count == 3, parts[0] != store.year || parts[1] != store.month {
            state.succeed("\(created ? "Zakup zapisany" : "Zakup poprawiony") — ma datę \(PurchaseFormat.day(document.date)), jest w miesiącu \(PurchaseFormat.monthLabel(parts[0], parts[1])).")
            store.setPeriod(year: parts[0], month: parts[1])
        } else {
            state.succeed(created ? "Zakup zapisany." : "Zakup poprawiony.")
            Task { await store.load() }
        }
    }
}

// MARK: Miesiąc pracownika (jak `PurchaseMonthView` w CRM)

/// Rozliczenie każdej działalności (stan, sumy, uwagi) z czynnościami — „Wyślij rozliczenie” (własne) albo „Zatwierdź” /
/// „Zwróć do poprawy” (zatwierdzający) — i dokumenty (plik, event, karta / wyciąg).
struct PurchaseMonthSections: View {
    let month: PurchaseMonth
    let futureMonth: Bool
    let onOpenFile: (PurchaseDocument) -> Void
    var onEdit: ((PurchaseDocument) -> Void)? = nil
    var onDelete: ((PurchaseDocument) -> Void)? = nil
    var onSubmit: ((PurchaseMonthCompany) -> Void)? = nil
    var onDecide: ((PurchaseMonthCompany, Bool) -> Void)? = nil
    @Environment(\.crmTheme) private var theme

    private var companies: [PurchaseMonthCompany] {
        month.companies.filter { company in
            company.canRecord || company.canApprove || company.settlement != nil || month.documents.contains { $0.companyId == company.id }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if companies.isEmpty {
                Text("Brak działalności, w których możesz rozliczać zakupy.").foregroundStyle(.secondary)
            }
            ForEach(companies) { company in section(company) }
        }
    }

    private func section(_ company: PurchaseMonthCompany) -> some View {
        let documents = month.documents.filter { $0.companyId == company.id }
        let status = company.status
        let missing = documents.filter { !$0.hasFile }.count
        return GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(company.name).font(.title3).textCase(.uppercase)
                            PurchaseStatusBadge(status: status)
                        }
                        Text(summary(company, documents: documents)).font(.callout).foregroundStyle(.secondary)
                        if let note = company.settlement?.employeeNote?.nonEmpty {
                            Text("Uwaga pracownika: \(note)").font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                        if let note = company.settlement?.decisionNote?.nonEmpty {
                            Text((status == .returned ? "Do poprawy: " : "Uwaga: ") + note)
                                .font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background((status == .returned ? CrmTheme.rgb(0xf59e0b) : Color.secondary).opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    Spacer(minLength: 12)
                    actions(company, documents: documents, missing: missing)
                }
                if month.own && status.editable && missing > 0 {
                    Label("Bez pliku: \(missing) dok. — dodaj zdjęcie albo skan, zanim wyślesz rozliczenie.", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                }
                if documents.isEmpty {
                    Text("Brak zakupów w tym miesiącu.").font(.callout).foregroundStyle(.secondary)
                } else {
                    table(documents, editable: status.editable)
                }
            }
            .padding(6)
        }
    }

    private func summary(_ company: PurchaseMonthCompany, documents: [PurchaseDocument]) -> String {
        var text = "\(documents.count) dok. · razem \(PurchaseFormat.totalsText(PurchaseFormat.totals(documents)))"
        guard let settlement = company.settlement else { return text }
        if let submitted = settlement.submittedAt { text += " · wysłane \(PurchaseFormat.day(submitted))" }
        if let decided = settlement.decidedAt, company.status != .submitted {
            text += " · decyzja \(PurchaseFormat.day(decided))"
            if let name = settlement.decidedByName?.nonEmpty { text += " (\(name))" }
        }
        return text
    }

    @ViewBuilder private func actions(_ company: PurchaseMonthCompany, documents: [PurchaseDocument], missing: Int) -> some View {
        let status = company.status
        HStack(spacing: 8) {
            if month.own, company.canRecord, status.editable, let onSubmit {
                Button { onSubmit(company) } label: {
                    Label(status == .returned ? "Wyślij ponownie" : "Wyślij rozliczenie", systemImage: "paperplane")
                }
                .buttonStyle(.borderedProminent)
                .disabled(futureMonth || documents.isEmpty || missing > 0)
                .help(missing > 0 ? "Dodaj plik do każdego dokumentu." : documents.isEmpty ? "Brak zakupów w tym miesiącu." : "Wyślij rozliczenie miesiąca do zatwierdzenia")
            }
            if !month.own, company.canApprove, company.settlement != nil, let onDecide {
                if status == .submitted {
                    Button { onDecide(company, false) } label: { Label("Zwróć do poprawy", systemImage: "arrow.uturn.backward") }
                    Button { onDecide(company, true) } label: { Label("Zatwierdź", systemImage: "checkmark.circle") }.buttonStyle(.borderedProminent)
                } else if status == .approved {
                    Button { onDecide(company, false) } label: { Label("Cofnij zatwierdzenie", systemImage: "arrow.uturn.backward") }
                }
            }
        }
    }

    // MARK: Dokumenty
    private func table(_ documents: [PurchaseDocument], editable: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("Data").frame(width: 78, alignment: .leading)
                Text("Dokument").frame(maxWidth: .infinity, alignment: .leading)
                Text("Sprzedawca").frame(width: 150, alignment: .leading)
                Text("Event").frame(width: 180, alignment: .leading)
                Text("Zapłata").frame(width: 160, alignment: .leading)
                Text("Brutto").frame(width: 110, alignment: .trailing)
                Color.clear.frame(width: 84, height: 1)
            }
            .font(.caption).foregroundStyle(.secondary).textCase(.uppercase)
            .padding(.vertical, 6)
            ForEach(documents) { document in
                Divider()
                row(document, editable: editable)
            }
        }
    }

    private func row(_ document: PurchaseDocument, editable: Bool) -> some View {
        let canEdit = month.own && editable
        return HStack(alignment: .top, spacing: 12) {
            Text(PurchaseFormat.day(document.date)).monospacedDigit().frame(width: 78, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(PurchaseKind.title(document.kind) + " " + (document.number ?? "")).textSelection(.enabled)
                if let label = document.label?.nonEmpty { Text(label).font(.caption).foregroundStyle(.secondary) }
                if let category = document.categoryName?.nonEmpty { Text(category).font(.caption).foregroundStyle(.tertiary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(document.sellerName ?? "").lineLimit(2)
                if let nip = document.sellerNip?.nonEmpty { Text("NIP \(nip)").font(.caption).foregroundStyle(.tertiary).textSelection(.enabled) }
            }
            .frame(width: 150, alignment: .leading)
            eventCell(document).frame(width: 180, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Label(PurchaseMethod.title(document.paymentMethod), systemImage: "creditcard").foregroundStyle(.secondary)
                Label(document.bankMatched ? "Powiązany z wyciągiem" : "Czeka na wyciąg", systemImage: "building.columns")
                    .foregroundStyle(document.bankMatched ? CrmTheme.rgb(0x6ee7b7) : Color.secondary)
            }
            .font(.caption).frame(width: 160, alignment: .leading)
            Text(PurchaseFormat.money(document.gross, document.currencyCode)).monospacedDigit().frame(width: 110, alignment: .trailing)
            HStack(spacing: 6) {
                if document.hasFile {
                    Button { onOpenFile(document) } label: { Image(systemName: "doc.text") }.help("Plik dokumentu")
                } else {
                    Text("bez pliku").font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                }
                if canEdit, let onEdit {
                    Button { onEdit(document) } label: { Image(systemName: "pencil") }.help("Popraw")
                }
                if canEdit, !document.bankMatched, let onDelete {
                    Button { onDelete(document) } label: { Image(systemName: "trash") }.help("Usuń")
                }
            }
            .buttonStyle(.borderless)
            .frame(width: 84, alignment: .trailing)
        }
        .padding(.vertical, 7)
        .contentShape(Rectangle())
        .contextMenu {
            if document.hasFile { Button("Plik dokumentu") { onOpenFile(document) } }
            if canEdit, let onEdit { Button("Popraw") { onEdit(document) } }
            if canEdit, !document.bankMatched, let onDelete { Button("Usuń", role: .destructive) { onDelete(document) } }
        }
    }

    @ViewBuilder private func eventCell(_ document: PurchaseDocument) -> some View {
        if let event = document.event {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: "calendar").foregroundStyle(theme.accent)
                    Text(event.name ?? "Event").lineLimit(2)
                }
                Text(eventDetails(event)).foregroundStyle(.secondary)
            }
            .font(.caption)
        } else {
            Text("—").foregroundStyle(.tertiary)
        }
    }

    private func eventDetails(_ event: PurchaseEventLink) -> String {
        var parts = [PurchaseFormat.money(event.amount)]
        if let category = event.categoryName?.nonEmpty { parts.append(category) }
        if let status = PurchaseCostStatus.label(event.status) { parts.append(status) }
        return parts.joined(separator: " · ")
    }
}

// MARK: Rozliczenie pracownika (zatwierdzający)

private struct PurchaseDecision: Identifiable {
    let company: PurchaseMonthCompany
    let approve: Bool
    var id: String { company.id + (approve ? ":approve" : ":return") }
}

@MainActor struct PurchaseReviewSheet: View {
    @ObservedObject var store: PurchasesStore
    let month: PurchaseMonth
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var decision: PurchaseDecision?

    /// Po decyzji okno pokazuje świeży stan rozliczenia.
    private var shown: PurchaseMonth { store.reviewing?.id == month.id ? (store.reviewing ?? month) : month }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Zakupy — \(shown.employeeName)", systemImage: "cart").font(.title3.bold())
                Text(PurchaseFormat.monthLabel(shown.year, shown.month)).font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 18).padding(.bottom, 10)
            Divider()
            ScrollView {
                PurchaseMonthSections(month: shown, futureMonth: false,
                                      onOpenFile: { document in Task { await store.openFile(document) } },
                                      onDecide: { company, approve in decision = PurchaseDecision(company: company, approve: approve) })
                    .padding(16)
            }
            HStack {
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(14).crmBar()
        }
        .frame(minWidth: 1020, idealWidth: 1100, minHeight: 520, idealHeight: 700)
        .sheet(item: $decision) { decision in
            PurchaseDecisionSheet(store: store, month: shown, decision: decision)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }
}

@MainActor private struct PurchaseDecisionSheet: View {
    @ObservedObject var store: PurchasesStore
    let month: PurchaseMonth
    let decision: PurchaseDecision
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var working = false
    @State private var problem: String?

    private var title: String {
        decision.approve ? "Zatwierdź rozliczenie" : decision.company.status == .approved ? "Cofnij zatwierdzenie" : "Zwróć do poprawy"
    }
    private var noteMissing: Bool { !decision.approve && note.purchaseTrimmed.isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title2.bold())
                Text("\(month.employeeName) · \(decision.company.name) · \(PurchaseFormat.monthLabel(month.year, month.month))").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                Section {
                    Text(decision.approve
                         ? "Koszty eventów z tych zakupów zostaną oznaczone jako zatwierdzone. Pracownik dostanie powiadomienie."
                         : "Pracownik dostanie powiadomienie z uwagą i będzie mógł poprawić dokumenty, a potem wysłać rozliczenie ponownie.")
                        .fixedSize(horizontal: false, vertical: true)
                }
                Section(decision.approve ? "Uwaga (opcjonalnie)" : "Co trzeba poprawić") {
                    TextEditor(text: $note).font(.body).frame(minHeight: 90)
                }
                if let problem { Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) } }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(decision.approve ? "Zatwierdź" : "Zwróć pracownikowi") { Task { await run() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(working || noteMissing)
            }
            .padding(16)
        }
        .frame(width: 520)
        .overlay { if working { PendingOverlay(text: decision.approve ? "Zatwierdzanie rozliczenia…" : "Zwracanie rozliczenia…") } }
    }

    private func run() async {
        working = true
        defer { working = false }
        if let failure = await store.decide(decision.company, approve: decision.approve, note: note) {
            problem = failure
        } else {
            dismiss()
        }
    }
}

// MARK: Wysłanie rozliczenia (pracownik)

@MainActor struct PurchaseSubmitSheet: View {
    @ObservedObject var store: PurchasesStore
    let month: PurchaseMonth
    let company: PurchaseMonthCompany
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var working = false
    @State private var problem: String?

    private var documents: [PurchaseDocument] { month.documents.filter { $0.companyId == company.id } }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Wyślij rozliczenie").font(.title2.bold())
                Text("\(company.name) · \(PurchaseFormat.monthLabel(month.year, month.month))").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                Section {
                    Text("\(documents.count) dok. · razem \(PurchaseFormat.totalsText(PurchaseFormat.totals(documents))).")
                    Text("Po wysłaniu dokumentów z tego miesiąca nie da się zmieniać, dopóki osoba z finansów nie zatwierdzi albo nie zwróci rozliczenia.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Section("Uwaga dla finansów (opcjonalnie)") {
                    TextEditor(text: $note).font(.body).frame(minHeight: 80)
                }
                if let problem { Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) } }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Wyślij do zatwierdzenia") { Task { await run() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(working)
            }
            .padding(16)
        }
        .frame(width: 520)
        .overlay { if working { PendingOverlay(text: "Wysyłanie rozliczenia…") } }
    }

    private func run() async {
        working = true
        defer { working = false }
        if let failure = await store.submit(company, month: month, note: note) {
            problem = failure
        } else {
            dismiss()
        }
    }
}
