import AppKit
import SwiftUI

// MARK: Wszystkie dokumenty (jak CRM: Dokumenty i rozliczenia → „Wszystkie dokumenty”) — jeden rejestr faktur i dokumentów
// kosztowych wybranej działalności za zakres dat: faktury z KSeF (wystawione i otrzymane), faktury CRM i dokumenty spoza KSeF
// (faktury zagraniczne, paragony, polisy, noty…). Filtry: źródło (KSeF / CRM / spoza KSeF), rodzaj (koszty / sprzedaż), stan
// zapłaty i wyszukiwanie — działają od razu, a wiersz stanu pod nimi pokazuje, które są włączone (`FinFilterSummary`).
// Podgląd dokumentu jak w uzgodnieniu (KSeF z XML, faktura CRM — PDF, spoza KSeF — wgrany plik); dodawanie dokumentu spoza
// KSeF (wgranie pliku, odczyt danych) — w CRM. Serwer: `/bridge/native/v1/finance/bank?op=documents` (`documentRegister`).

struct FinDocument: Decodable, Identifiable {
    var source: String
    var documentID: String
    var number: String
    var reference: String?
    var kindLabel: String
    /// `cost` — dokument kosztowy (faktura otrzymana, dokument spoza KSeF), `sales` — sprzedaż.
    var side: String
    var counterparty: String?
    var nip: String?
    var issueDate: String?
    var dueDate: String?
    var gross: Double
    var currency: String
    /// `paid`, `partial`, `overdue`, `unpaid`, `draft`, `cancelled`.
    var state: String
    var stateLabel: String
    var previewable: Bool
    var href: String

    enum CodingKeys: String, CodingKey {
        case source, documentID = "id", number, reference, kindLabel, side, counterparty, nip, issueDate, dueDate, gross, currency, state, stateLabel, previewable, href
    }
    var id: String { "\(source):\(documentID)" }
    var sortDate: String { issueDate ?? "" }
    var sortParty: String { counterparty ?? "" }
    var sortState: String { stateLabel }
    var sortSource: String { FinDocumentText.sourceLabel(source) }
}

struct FinDocumentsReply: Decodable {
    var companyId: String
    var from: String
    var to: String
    var today: String
    var canManage: Bool
    var truncated: Bool
    var documents: [FinDocument]
}

enum FinDocumentText {
    static let sources: [(String, String)] = [("all", "Wszystkie"), ("ksef", "KSeF"), ("invoice", "CRM"), ("external", "Spoza KSeF")]
    static let sides: [(String, String)] = [("all", "Koszty i sprzedaż"), ("cost", "Kosztowe (zakup)"), ("sales", "Sprzedażowe")]
    static let states: [(String, String)] = [("all", "Każdy stan zapłaty"), ("open", "Nieopłacone"), ("overdue", "Po terminie"), ("paid", "Opłacone")]

    static func sourceLabel(_ source: String) -> String { sources.first { $0.0 == source }?.1 ?? source }
    /// Kolory źródeł jak znaczniki w CRM (KSeF — niebieski, CRM — fioletowy, spoza KSeF — bursztynowy).
    static func sourceColor(_ source: String) -> Color {
        switch source {
        case "ksef": return CrmTheme.rgb(0x93c5fd)
        case "invoice": return CrmTheme.rgb(0xc4b5fd)
        default: return CrmTheme.rgb(0xfcd34d)
        }
    }
    static func stateColor(_ state: String) -> Color {
        switch state {
        case "paid": return CrmTheme.rgb(0x4ade80)
        case "partial": return CrmTheme.rgb(0x93c5fd)
        case "overdue": return CrmTheme.rgb(0xf87171)
        case "draft", "cancelled": return .secondary
        default: return CrmTheme.rgb(0xfb923c)
        }
    }
    /// Filtr stanu: „Nieopłacone” obejmuje też częściowo opłacone i po terminie.
    static func matches(_ document: FinDocument, state filter: String) -> Bool {
        switch filter {
        case "open": return ["unpaid", "partial", "overdue"].contains(document.state)
        case "overdue": return document.state == "overdue"
        case "paid": return document.state == "paid"
        default: return true
        }
    }
}

@MainActor struct FinanceDocumentsView: View {
    @ObservedObject var store: FinanceBankStore
    @ObservedObject var finance: FinanceStore
    @EnvironmentObject private var state: Workspace
    @State private var selection: String?
    @State private var sortOrder = [KeyPathComparator(\FinDocument.sortDate, order: .reverse)]
    @State private var preview: BankPreviewItem?

    private var reply: FinDocumentsReply? { store.company.flatMap { store.documentLists[store.documentsKey($0.id)] } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let company = store.company {
                header(company)
                Divider()
                if let reply {
                    content(reply)
                } else if let error = store.documentsError {
                    ContentUnavailableView {
                        Label("Nie udało się wczytać dokumentów", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.loadDocuments(force: true) } }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView("Ładowanie dokumentów…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                ContentUnavailableView("Wybierz działalność", systemImage: "building.2", description: Text("Wybierz działalność w filtrze Finansów u góry."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: loadKey) { await store.loadDocuments() }
        .onChange(of: store.company?.id) { selection = nil }
        .sheet(item: $preview) { item in BankPreviewSheet(item: item, store: store) }
    }

    /// Wczytanie przy zmianie działalności i zakresu dat.
    private var loadKey: String { store.company.map { store.documentsKey($0.id) } ?? "" }

    // MARK: Nagłówek: działalność, zakres dat, odświeżenie, dodanie dokumentu spoza KSeF (CRM)
    private func header(_ company: FinCompany) -> some View {
        HStack(spacing: 10) {
            if store.companies.count > 1 {
                Picker("", selection: Binding(get: { company.id }, set: { store.selectCompany($0) })) {
                    ForEach(store.companies) { Text($0.name).tag($0.id) }
                }
                .labelsHidden().fixedSize()
            } else {
                Text(company.name).font(.headline)
            }
            Spacer()
            DatePicker("Wystawione od", selection: $store.documentsFrom, displayedComponents: .date).fixedSize()
            DatePicker("do", selection: $store.documentsTo, in: store.documentsFrom..., displayedComponents: .date).fixedSize()
            Button { Task { await store.loadDocuments(force: true) } } label: {
                if store.documentsLoading { ProgressView().controlSize(.small) } else { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
            .fixedSize().disabled(store.documentsLoading)
            Button { state.openCRM("/crm/invoices?tab=external&section=external") } label: {
                Label("Dodaj dokument spoza KSeF", systemImage: "plus")
            }
            .fixedSize()
            .help("Wgranie faktury spoza KSeF, paragonu, polisy albo noty z odczytem danych — w CRM (przeglądarka)")
        }
        .controlSize(.small)
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    // MARK: Filtry i lista
    private func visible(_ reply: FinDocumentsReply) -> [FinDocument] {
        let needle = store.documentsSearch.trimmingCharacters(in: .whitespaces).lowercased()
        let numeric = BankFormat.parse(needle)
        return reply.documents.filter { document in
            guard store.documentsSource == "all" || document.source == store.documentsSource else { return false }
            guard store.documentsSide == "all" || document.side == store.documentsSide else { return false }
            guard FinDocumentText.matches(document, state: store.documentsState) else { return false }
            guard !needle.isEmpty else { return true }
            let text = [document.number, document.reference ?? "", document.kindLabel, document.counterparty ?? "", document.nip ?? ""].joined(separator: " ").lowercased()
            if text.contains(needle) { return true }
            guard let numeric else { return false }
            return abs(document.gross - numeric) <= 0.01
        }
        .sorted(using: sortOrder)
    }

    private var chips: [FinFilterChip] {
        var result: [FinFilterChip] = []
        let needle = store.documentsSearch.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { result.append(FinFilterChip(label: "Szukaj: „\(needle)”") { store.documentsSearch = "" }) }
        if store.documentsSource != "all" {
            result.append(FinFilterChip(label: "Źródło: \(FinDocumentText.sourceLabel(store.documentsSource))") { store.documentsSource = "all" })
        }
        if store.documentsSide != "all", let label = FinDocumentText.sides.first(where: { $0.0 == store.documentsSide })?.1 {
            result.append(FinFilterChip(label: "Rodzaj: \(label)") { store.documentsSide = "all" })
        }
        if store.documentsState != "all", let label = FinDocumentText.states.first(where: { $0.0 == store.documentsState })?.1 {
            result.append(FinFilterChip(label: "Zapłata: \(label)") { store.documentsState = "all" })
        }
        return result
    }

    private func clearFilters() {
        store.documentsSearch = ""; store.documentsSource = "all"; store.documentsSide = "all"; store.documentsState = "all"
    }

    private func content(_ reply: FinDocumentsReply) -> some View {
        let rows = visible(reply)
        let all = reply.documents
        let pln = rows.filter { $0.currency.uppercased() == "PLN" && $0.state != "cancelled" && $0.state != "draft" }
        let gross = pln.reduce(0.0) { $0 + $1.gross }
        let foreign = rows.count - pln.count
        return VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    // Źródło — przełącznik z liczbą dokumentów: od razu widać, czy przeglądasz wszystkie, czy tylko KSeF albo spoza KSeF.
                    Picker("", selection: $store.documentsSource) {
                        ForEach(FinDocumentText.sources, id: \.0) { item in
                            let count = item.0 == "all" ? all.count : all.filter { $0.source == item.0 }.count
                            Text("\(item.1) (\(count))").tag(item.0)
                        }
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                    .finFilterActive(store.documentsSource != "all")
                    Picker("", selection: $store.documentsSide) {
                        ForEach(FinDocumentText.sides, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .labelsHidden().fixedSize().finFilterActive(store.documentsSide != "all")
                    Picker("", selection: $store.documentsState) {
                        ForEach(FinDocumentText.states, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .labelsHidden().fixedSize().finFilterActive(store.documentsState != "all")
                    TextField("Szukaj: numer, kontrahent, NIP, kwota", text: $store.documentsSearch).textFieldStyle(.roundedBorder)
                        .finFilterActive(!store.documentsSearch.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .controlSize(.small)
                HStack(spacing: 10) {
                    FinFilterSummary(shown: rows.count, total: all.count, forms: ("dokument", "dokumenty", "dokumentów"), chips: chips) { clearFilters() }
                    Text("Wystawione \(FinFormat.day(reply.from)) – \(FinFormat.day(reply.to)) · brutto PLN: \(FinFormat.money(gross))\(foreign > 0 ? " · w innych walutach: \(foreign)" : "")")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1).fixedSize()
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            if reply.truncated {
                FinBanner(text: "Zakres ma bardzo dużo dokumentów — pokazano po 2000 najnowszych z każdego źródła. Zawęź daty, żeby zobaczyć resztę.")
                    .padding(.horizontal, 16).padding(.bottom, 8)
            }
            Divider()
            Table(rows, selection: $selection, sortOrder: $sortOrder) {
                TableColumn("Źródło", value: \.sortSource) { document in
                    BankChip(text: FinDocumentText.sourceLabel(document.source), color: FinDocumentText.sourceColor(document.source))
                }
                .width(min: 78, ideal: 90, max: 110)
                TableColumn("Dokument", value: \.number) { document in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(document.number).fontWeight(.medium).lineLimit(1)
                        Text([document.kindLabel, document.reference].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    }
                }
                .width(min: 150, ideal: 210)
                TableColumn("Kontrahent", value: \.sortParty) { document in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(document.counterparty ?? "—").lineLimit(1)
                        if let nip = document.nip { Text("NIP \(nip)").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
                .width(min: 150, ideal: 240)
                TableColumn("Data", value: \.sortDate) { document in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(FinFormat.day(document.issueDate)).monospacedDigit()
                        if let due = document.dueDate { Text("termin \(FinFormat.day(due))").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
                .width(min: 84, ideal: 96, max: 120)
                TableColumn("Brutto", value: \.gross) { document in
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(FinFormat.money(document.gross, document.currency)).monospacedDigit()
                        Text(document.side == "cost" ? "koszt" : "sprzedaż").font(.caption2).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 100, ideal: 120, max: 150)
                TableColumn("Zapłata", value: \.sortState) { document in
                    HStack(spacing: 4) {
                        Circle().fill(FinDocumentText.stateColor(document.state)).frame(width: 7, height: 7)
                        Text(document.stateLabel).foregroundStyle(FinDocumentText.stateColor(document.state)).lineLimit(1)
                    }
                }
                .width(min: 110, ideal: 140)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let document = reply.documents.first(where: { $0.id == id }) { menu(document) }
            } primaryAction: { ids in
                if let id = ids.first, let document = reply.documents.first(where: { $0.id == id }) { showDocument(document) }
            }
            .overlay {
                if rows.isEmpty {
                    ContentUnavailableView {
                        Label(all.isEmpty ? "Brak dokumentów w tym zakresie dat" : "Brak dokumentów dla wybranych filtrów", systemImage: "tray")
                    } description: {
                        Text(all.isEmpty ? "Zmień zakres dat albo dodaj dokument spoza KSeF w CRM." : "Włączone filtry: \(chips.map(\.label).joined(separator: ", ")).")
                    } actions: {
                        if !chips.isEmpty { Button("Wyczyść filtry") { clearFilters() } }
                    }
                }
            }
            if let id = selection, let document = reply.documents.first(where: { $0.id == id }) {
                Divider()
                summary(document)
            }
        }
    }

    @ViewBuilder private func menu(_ document: FinDocument) -> some View {
        if document.previewable { Button("Podgląd dokumentu") { showDocument(document) } }
        Button("Otwórz w CRM") { state.openCRM(document.href) }
        Button("Kopiuj numer") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(document.number, forType: .string)
        }
    }

    private func showDocument(_ document: FinDocument) {
        guard document.previewable else {
            state.notice = "Do tego dokumentu nie wgrano pliku — otwórz go w CRM."
            return
        }
        Task { preview = await store.preview(source: document.source, id: document.documentID) }
    }

    private func summary(_ document: FinDocument) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(document.number) · \(document.counterparty ?? "—")").font(.callout.weight(.semibold)).lineLimit(1)
                Text("\(FinDocumentText.sourceLabel(document.source)) · \(document.kindLabel) · \(document.side == "cost" ? "dokument kosztowy" : "sprzedaż") · wystawiony \(FinFormat.day(document.issueDate))\(document.dueDate.map { " · termin \(FinFormat.day($0))" } ?? "") · \(document.stateLabel.lowercased())")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            if document.previewable {
                Button { showDocument(document) } label: { Label("Podgląd", systemImage: "doc.richtext") }
            }
            Button { state.openCRM(document.href) } label: { Label("Otwórz w CRM", systemImage: "safari") }
        }
        .controlSize(.small)
        .padding(.horizontal, 16).padding(.vertical, 10)
    }
}
