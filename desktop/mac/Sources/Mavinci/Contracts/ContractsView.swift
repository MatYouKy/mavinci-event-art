import AppKit
import PDFKit
import SwiftUI

// MARK: Umowy (`/crm/contracts`) — tabela umów z wyszukiwaniem i filtrem statusu, obok karta: dane umowy, PDF w podglądzie,
// pobieranie i druk. Umowa wydarzenia otwiera się (dwuklik, „Otwórz umowę w wydarzeniu”) w zakładce „Umowa” wydarzenia na Macu.

@MainActor struct ContractsView: View {
    @ObservedObject var store: ContractsStore
    @EnvironmentObject private var state: Workspace
    @State private var search = ""
    @State private var filter = "active"
    @State private var sheetID: String?
    @State private var sortOrder = [KeyPathComparator(\ContractListItem.sortCreated, order: .reverse)]

    private var statusCodes: [String] {
        var seen: [String] = []
        for item in store.contracts where !seen.contains(item.status) { seen.append(item.status) }
        return ContractText.statuses.filter { seen.contains($0) } + seen.filter { !ContractText.statuses.contains($0) }
    }

    private var rows: [ContractListItem] {
        let needle = SearchText.fold(search)
        return store.contracts.filter { item in
            if !needle.isEmpty { return SearchText.fold(item.searchText).contains(needle) }
            switch filter {
            case "active": return item.status != "cancelled"
            case "all": return true
            default: return item.status == filter
            }
        }.sorted(using: sortOrder)
    }

    var body: some View {
        GeometryReader { outer in
            let wide = outer.size.width >= 1050
            VStack(spacing: 0) {
                toolbar
                if let problem = store.loadError { MessageBar(text: problem, warning: true) { store.loadError = nil } }
                HStack(alignment: .top, spacing: 0) {
                    table
                    if wide, let item = store.contract(store.selectedContractID) {
                        Divider()
                        ContractDetailPane(store: store, item: item).frame(width: 400).id(item.id)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .onChange(of: store.selectedContractID) { _, next in if !wide, next != nil { sheetID = next } }
        }
        .navigationTitle("Umowy")
        .sheet(item: Binding(get: { sheetID.map(IdentifiedID.init) }, set: { sheetID = $0?.id })) { selected in
            if let item = store.contract(selected.id) {
                VStack(spacing: 0) {
                    ContractDetailPane(store: store, item: item)
                    HStack { Spacer(); Button("Zamknij") { sheetID = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                }
                .frame(minWidth: 460, minHeight: 640)
            }
        }
        .task(id: state.employee?.id) {
            await store.backgroundSync()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            TextField("Szukaj umowy, klienta, wydarzenia", text: $search).textFieldStyle(.roundedBorder).frame(maxWidth: 320)
            Picker("Pokaż", selection: $filter) {
                Text("Bez anulowanych (\(store.contracts.filter { $0.status != "cancelled" }.count))").tag("active")
                Text("Wszystkie (\(store.contracts.count))").tag("all")
                Divider()
                ForEach(statusCodes, id: \.self) { code in
                    Text("\(ContractText.status(code)) (\(store.contracts.filter { $0.status == code }.count))").tag(code)
                }
            }
            .labelsHidden().fixedSize()
            Text("\(rows.count) umów").font(.callout).foregroundStyle(.secondary)
            Spacer()
            if store.syncing { ProgressView().controlSize(.small) }
            Button { state.openHref("/crm/contract-templates") } label: { Label("Szablony umów", systemImage: "doc.richtext") }
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .crmBar()
    }

    private var table: some View {
        Table(rows, selection: $store.selectedContractID, sortOrder: $sortOrder) {
            TableColumn("Numer", value: \.sortNumber) { item in
                Text(item.displayNumber).monospacedDigit().foregroundStyle(.secondary)
            }.width(min: 90, ideal: 130, max: 170)
            TableColumn("Umowa", value: \.title) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title.isEmpty ? "Umowa" : item.title).lineLimit(1)
                    if let client = item.client { Text(client).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }.padding(.vertical, 3)
            }.width(min: 200, ideal: 300)
            TableColumn("Wydarzenie", value: \.sortEvent) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.event?.name ?? "—").lineLimit(1)
                    if let date = item.event?.date { Text(ContractText.day(date)).font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                }
            }.width(min: 160, ideal: 240)
            TableColumn("Status", value: \.status) { item in
                Text(item.statusText).lineLimit(1)
            }.width(min: 130, ideal: 170, max: 230)
            TableColumn("PDF", value: \.pdfState) { item in
                Label(item.pdfState, systemImage: !item.pdf ? "doc" : item.modified && item.status != "cancelled" ? "exclamationmark.triangle" : "doc.richtext")
                    .foregroundStyle(!item.pdf ? Color.secondary : item.modified && item.status != "cancelled" ? Color.orange : Color.primary)
                    .lineLimit(1)
            }.width(min: 100, ideal: 120, max: 150)
            TableColumn("Utworzono", value: \.sortCreated) { item in
                Text(ContractText.day(item.createdAt)).monospacedDigit().foregroundStyle(.secondary)
            }.width(min: 80, ideal: 95, max: 120)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let item = store.contract(id) {
                if let eventId = item.eventId {
                    Button("Otwórz umowę w wydarzeniu") { state.showEvent(eventId, cardTab: "contract") }
                }
                Button("Otwórz w CRM") { state.openCRM(crmHref(item)) }
            }
        } primaryAction: { ids in
            guard let id = ids.first, let item = store.contract(id) else { return }
            if let eventId = item.eventId { state.showEvent(eventId, cardTab: "contract") } else { state.openCRM(crmHref(item)) }
        }
        .overlay {
            if rows.isEmpty {
                if !store.loaded { ProgressView("Ładowanie umów…") }
                else {
                    ContentUnavailableView(store.contracts.isEmpty ? "Brak umów" : "Brak umów w tym widoku", systemImage: "signature",
                                           description: Text(store.contracts.isEmpty ? "Umowy powstają w zakładce „Umowa” wydarzenia." : "Zmień wyszukiwanie lub filtr."))
                }
            }
        }
    }

    private func crmHref(_ item: ContractListItem) -> String {
        item.eventId.map { "/crm/events/\($0)?tab=contract" } ?? "/crm/contracts/\(item.id)"
    }
}

// MARK: Karta umowy

@MainActor struct ContractDetailPane: View {
    @ObservedObject var store: ContractsStore
    let item: ContractListItem
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var pdfData: Data?
    @State private var pdfName = "umowa.pdf"
    @State private var pdfError: String?
    @State private var preview: NativePreview?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        if let number = item.number, !number.isEmpty { Text(number).font(.callout.monospacedDigit()).foregroundStyle(.secondary) }
                        Text(item.statusText).font(.caption.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(theme.accent.opacity(0.14), in: Capsule()).foregroundStyle(theme.accent)
                        Spacer()
                    }
                    Text(item.title.isEmpty ? "Umowa" : item.title).font(.title3.bold()).textSelection(.enabled)
                    if let client = item.client { Text(client).foregroundStyle(.secondary).textSelection(.enabled) }
                }
                HStack(spacing: 8) {
                    if let eventId = item.eventId {
                        Button { state.showEvent(eventId, cardTab: "contract") } label: { Label("Otwórz umowę w wydarzeniu", systemImage: "sparkles") }
                            .buttonStyle(.borderedProminent)
                    } else {
                        Button { state.openCRM("/crm/contracts/\(item.id)") } label: { Label("Otwórz w CRM", systemImage: "safari") }
                    }
                    Spacer()
                }
                details
                pdfBlock
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
        .task(id: "\(item.id)|\(item.pdfAt ?? "")") { await loadPdf() }
    }

    private var details: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
            row("Wydarzenie", item.event?.name ?? "—")
            if let date = item.event?.date { row("Data wydarzenia", ContractText.day(date)) }
            row("Szablon", item.template ?? "—")
            row("Wersja", "\(item.version)")
            if let date = item.statusAt { row("Zmiana statusu", ContractText.date(date)) }
            row("Podpis firmy", item.companySigned ? "Potwierdzony" : "Niepotwierdzony")
            if item.locked { row("Dokument", "Zablokowany po podpisaniu") }
            row("Utworzono", ContractText.date(item.createdAt))
        }
        .font(.callout)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary)
            Text(value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var pdfBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("PDF umowy", systemImage: "doc.richtext").font(.headline)
                Spacer()
                if let pdfData {
                    Button { preview = NativePreview(name: pdfName, data: pdfData) } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                        .buttonStyle(.borderless).help("Powiększ")
                    Button { download(pdfData) } label: { Image(systemName: "arrow.down.circle") }
                        .buttonStyle(.borderless).help("Pobierz PDF")
                    Button { if !ContractFiles.print(pdfData) { state.error = "Nie udało się przygotować wydruku." } } label: { Image(systemName: "printer") }
                        .buttonStyle(.borderless).help("Drukuj")
                }
            }
            if !item.pdf {
                Text("PDF nie został jeszcze wygenerowany. Wygenerujesz go w zakładce „Umowa” wydarzenia.").font(.callout).foregroundStyle(.secondary)
            } else {
                Text("Wygenerowano: " + ContractText.date(item.pdfAt)).font(.caption).foregroundStyle(.secondary)
                if item.modified && item.status != "cancelled" {
                    Label("Treść zmieniła się po wygenerowaniu PDF — podgląd pokazuje wcześniejszą wersję.", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
                Group {
                    if let pdfData {
                        NativePDF(data: pdfData)
                    } else if let pdfError {
                        VStack(spacing: 8) {
                            Text(pdfError).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            Button("Spróbuj ponownie") { Task { await loadPdf() } }
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ProgressView("Wczytywanie PDF…").frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(height: 480)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
    }

    private func loadPdf() async {
        pdfData = nil
        pdfError = nil
        guard item.pdf else { return }
        do {
            let file = try await store.pdf(item.id)
            pdfData = file.data
            pdfName = file.name
        } catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { return }
            pdfError = store.failureText(error, "Nie udało się wczytać PDF.")
        }
    }

    private func download(_ data: Data) {
        do {
            let target = try ContractFiles.saveToDownloads(data, name: pdfName)
            state.succeed("Pobrano: \(target.lastPathComponent)")
        } catch {
            state.error = store.failureText(error, "Błąd podczas pobierania PDF")
        }
    }
}
