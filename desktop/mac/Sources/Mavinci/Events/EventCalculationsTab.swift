import AppKit
import PDFKit
import SwiftUI

// MARK: Kalkulacje wydarzenia (1:1 z `EventCalculationsTab`, `CalculationEditor`, `CategorySection`, `AddCalculationItemModal`,
// `ImportFromOfferModal` i `CalculationVehicleTravel`): lista z sumą netto, akceptacja (źródło danych finansowych), duplikowanie,
// PDF; edytor z sekcjami Pozycje / Ludzie / Transport / Pozostałe, sumami netto i brutto, mocą i wagą, kolejnością (przeciąganie),
// importem z oferty i kalkulatorem trasy dla transportu. PDF powstaje na Macu (Chrome) i trafia do Plików → Kalkulacje.
// Wysyłka kalkulacji e-mailem otwiera się w CRM.

struct CalculationsTabData: Decodable {
    struct Calculation: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var notes: String?
        var createdAt: String?
        var updatedAt: String?
        var itemsCount: Int
        var total: Double
        var pdf: String?
        var accepted: Bool
    }
    var calculations: [Calculation]
}

enum CalculationCategory: String, CaseIterable, Identifiable {
    case equipment, staff, transport, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .equipment: return "Pozycje"
        case .staff: return "Ludzie"
        case .transport: return "Transport"
        case .other: return "Pozostałe"
        }
    }
    var symbol: String {
        switch self {
        case .equipment: return "shippingbox"
        case .staff: return "person.2"
        case .transport: return "truck.box"
        case .other: return "ellipsis.circle"
        }
    }
}

struct CalculationLine: Decodable, Identifiable, Equatable {
    var id: String
    var category: String
    var name: String
    var description: String
    var unit: String
    var quantity: Double
    var unitPrice: Double
    var days: Double
    var source: String
    var sourceRef: String?
    var sourceLabel: String?
    var position: Int
    var vat: Double
    var power: Double?
    var weight: Double?
    var thumbnail: String?
    var stock: Double?
    var transportEstimate: JSONValue?

    /// `rowNet` i `rowGross` z `calculations.helper`.
    var net: Double { CalculationMath.round2(quantity * unitPrice * (days == 0 ? 1 : days)) }
    var gross: Double { CalculationMath.round2(net * (1 + vat / 100)) }

    /// Pola zapisu (`serializeItem`).
    var payload: JSONValue {
        var fields: [String: JSONValue] = [
            "id": .string(id), "category": .string(category), "name": .string(name), "description": .string(description),
            "unit": .string(unit), "quantity": .number(quantity), "unitPrice": .number(unitPrice), "days": .number(days),
            "source": .string(source), "vat": .number(vat),
        ]
        fields["sourceRef"] = sourceRef.map { JSONValue.string($0) } ?? JSONValue.null
        fields["power"] = power.map { JSONValue.number($0) } ?? JSONValue.null
        fields["weight"] = weight.map { JSONValue.number($0) } ?? JSONValue.null
        fields["transportEstimate"] = transportEstimate ?? JSONValue.null
        return .object(fields)
    }
}

struct CalculationEditorData: Decodable {
    var id: String
    var name: String
    var notes: String
    var pdf: String?
    var createdAt: String?
    var pdfCurrent: Bool
    var revision: Double?
    var items: [CalculationLine]
}

enum CalculationMath {
    static func round2(_ value: Double) -> Double { (value * 100).rounded() / 100 }

    /// `fmt`: kwota z dwoma miejscami po przecinku (pl-PL).
    static func money(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    }

    /// Liczba do pola edycji i tabeli — bez zbędnych zer, z przecinkiem.
    static func plain(_ value: Double, max: Int = 2) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = max
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    static func parse(_ text: String) -> Double? {
        let clean = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{00a0}", with: "").replacingOccurrences(of: ",", with: ".")
        guard !clean.isEmpty, let value = Double(clean), value.isFinite else { return nil }
        return value
    }

    static func power(_ watts: Double) -> String {
        watts >= 1000 ? String(format: "%.2f kW", watts / 1000) : String(format: "%.0f W", watts)
    }

    static func weight(_ kg: Double) -> String {
        kg >= 1000 ? String(format: "%.2f t", kg / 1000) : String(format: "%.1f kg", kg)
    }

    /// `calculateFuelCost`.
    static func fuelCost(_ distance: Double, _ consumption: Double, _ price: Double) -> Double? {
        guard distance.isFinite, consumption.isFinite, price.isFinite, distance >= 0, consumption > 0, price > 0 else { return nil }
        return ((distance / 100) * consumption * price * 100).rounded() / 100
    }

    static func dateTime(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return value ?? "—" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm:ss")
    }
}

private struct CalculationPdfFile: Decodable { var url: String; var name: String }

enum CalculationPdf {
    /// Zapisany PDF kalkulacji (podpisany adres); `current` — tylko gdy rewizja dokumentu zgadza się z treścią.
    @MainActor static func fetch(_ store: EventCardStore, _ eventID: String, _ calculationID: String, current: Bool) async throws -> (Data, String) {
        var params = ["calculationId": calculationID]
        if current { params["current"] = "1" }
        let file = try await store.tabQuery(eventID, "calculations", "pdf", params, as: CalculationPdfFile.self)
        guard let url = URL(string: file.url) else { throw AppError.invalidResponse }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { throw URLError(.badServerResponse) }
        return (data, file.name)
    }

    @MainActor static func printDocument(_ document: PDFDocument?) throws {
        guard let document, let operation = document.printOperation(for: NSPrintInfo.shared, scalingMode: .pageScaleToFit, autoRotate: true) else {
            throw AppError.invalidResponse
        }
        operation.run()
    }

    static func saveToDownloads(_ data: Data, _ name: String) throws -> URL {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let base = (name as NSString).deletingPathExtension
        var target = folder.appendingPathComponent(name)
        var copy = 1
        while FileManager.default.fileExists(atPath: target.path) {
            target = folder.appendingPathComponent("\(base) (\(copy)).pdf")
            copy += 1
        }
        try data.write(to: target)
        return target
    }
}

// MARK: Lista kalkulacji (`EventCalculationsTab`)

@MainActor struct EventCalculationsTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var openID: String?
    @State private var selectedCalculation: String?
    @State private var deleting: CalculationsTabData.Calculation?
    @State private var accepting: CalculationsTabData.Calculation?
    @State private var preview: NativePreview?

    private var data: CalculationsTabData? { store.tab(eventID, "calculations", as: CalculationsTabData.self) }

    var body: some View {
        Group {
            if let openID {
                CalculationEditorView(store: store, eventID: eventID, calculationID: openID) {
                    self.openID = nil
                    Task { await store.loadTab(eventID, "calculations") }
                }
                .id(openID)
            } else if let data {
                list(data)
            } else if let error = store.tabErrors["\(eventID)|calculations"] {
                ContentUnavailableView {
                    Label("Nie udało się pobrać kalkulacji", systemImage: "function")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "calculations") } } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "calculations") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            if openID == nil { Task { await store.loadTab(eventID, "calculations") } }
        }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
        .confirmationDialog("Usunąć kalkulację?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let calculation = deleting { Button("Usuń", role: .destructive) { Task { await remove(calculation) } } }
            Button("Anuluj", role: .cancel) { state.snack = Snack(kind: .info, text: "Anulowano usuwanie kalkulacji") }
        } message: { Text("Tej operacji nie można cofnąć.") }
        .confirmationDialog(acceptTitle, isPresented: Binding(get: { accepting != nil }, set: { if !$0 { accepting = nil } }), titleVisibility: .visible) {
            if let calculation = accepting {
                Button(calculation.accepted ? "Cofnij" : "Zaakceptuj") { Task { await toggleAccept(calculation) } }
            }
            Button("Anuluj", role: .cancel) { accepting = nil }
        } message: { Text(acceptMessage) }
    }

    private var acceptTitle: String { accepting?.accepted == true ? "Cofnąć akceptację?" : "Zaakceptować kalkulację?" }
    private var acceptMessage: String {
        guard let calculation = accepting else { return "" }
        if calculation.accepted {
            return "Cofnąć akceptację kalkulacji \"\(calculation.name)\"? Źródłem danych finansowych ponownie będzie zaakceptowana oferta."
        }
        return "Oznaczyć \"\(calculation.name)\" jako zaakceptowaną? Stanie się źródłem danych finansowych dla tego wydarzenia."
    }

    @ViewBuilder private func list(_ data: CalculationsTabData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Kalkulacje").font(.title2.weight(.semibold))
                Text(NativeList.count(data.calculations.count, "kalkulacja", "kalkulacje", "kalkulacji") + " · sprzęt, ludzie, transport i inne")
                    .foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Button { Task { await create() } } label: { Label("Stwórz kalkulację", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 18).padding(.top, 12)
            if data.calculations.isEmpty {
                ContentUnavailableView {
                    Label("Brak kalkulacji dla tego wydarzenia", systemImage: "function")
                } description: { Text("Kalkulacja zbiera sprzęt, ludzi, transport i pozostałe koszty.") } actions: {
                    Button("Stwórz kalkulację") { Task { await create() } }
                }
            } else {
                table(data)
            }
        }
    }

    /// Natywna tabela kalkulacji: dwuklik / ↩ otwiera edytor, czynności w menu „…” i pod prawym przyciskiem.
    private func table(_ data: CalculationsTabData) -> some View {
        let lp = NativeList.numbers(data.calculations)
        return Table(data.calculations, selection: $selectedCalculation) {
            TableColumn("") { (calculation: CalculationsTabData.Calculation) in
                Image(systemName: calculation.accepted ? "checkmark.seal.fill" : "function")
                    .foregroundStyle(calculation.accepted ? Color.green : theme.accent).frame(width: 24, height: 24)
            }.width(32)
            TableColumn("Lp.") { (calculation: CalculationsTabData.Calculation) in NativeRowNumber(value: lp[calculation.id]) }.width(36)
            TableColumn("Nazwa") { (calculation: CalculationsTabData.Calculation) in
                Text(calculation.name).fontWeight(.medium).lineLimit(1).help(calculation.notes ?? calculation.name)
            }.width(min: 160, ideal: 320)
            TableColumn("Status") { (calculation: CalculationsTabData.Calculation) in
                EventDotLabel(label: calculation.accepted ? "Zaakceptowana" : "Robocza",
                              color: calculation.accepted ? CrmTheme.rgb(0x4ade80) : CrmTheme.rgb(0x9ca3af))
                    .help(calculation.accepted ? "Zaakceptowana — źródło danych finansowych" : "Nie jest źródłem danych finansowych")
            }.width(min: 100, ideal: 130)
            TableColumn("PDF") { (calculation: CalculationsTabData.Calculation) in
                if calculation.pdf != nil {
                    Image(systemName: "doc.badge.checkmark").foregroundStyle(.green).help("PDF wygenerowany")
                } else {
                    Text("—").foregroundStyle(.tertiary)
                }
            }.width(40)
            TableColumn("Pozycje") { (calculation: CalculationsTabData.Calculation) in
                Text("\(calculation.itemsCount)").monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 56, ideal: 70)
            TableColumn("Suma netto") { (calculation: CalculationsTabData.Calculation) in
                Text(CalculationMath.money(calculation.total) + " PLN").monospacedDigit().fontWeight(.medium).frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 110, ideal: 150)
            TableColumn("Zmodyfikowano") { (calculation: CalculationsTabData.Calculation) in
                Text(CalculationMath.dateTime(calculation.updatedAt)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
            }.width(min: 110, ideal: 150)
            TableColumn("") { (calculation: CalculationsTabData.Calculation) in
                Menu { actions(calculation) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Czynności")
            }.width(30)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let calculation = data.calculations.first(where: { $0.id == id }) { actions(calculation) }
        } primaryAction: { ids in
            if let id = ids.first { openID = id }
        }
    }

    @ViewBuilder private func actions(_ calculation: CalculationsTabData.Calculation) -> some View {
        Button { openID = calculation.id } label: { Label("Edytuj", systemImage: "pencil") }
        Button { Task { await duplicate(calculation) } } label: { Label("Duplikuj", systemImage: "plus.square.on.square") }
        Button { Task { await showPdf(calculation, print: false) } } label: { Label("Pokaż PDF", systemImage: "eye") }
        Button { Task { await showPdf(calculation, print: true) } } label: { Label("Drukuj PDF", systemImage: "printer") }
        Button { send(calculation) } label: { Label("Wyślij", systemImage: "envelope") }
        Divider()
        Button { accepting = calculation } label: {
            Label(calculation.accepted ? "Cofnij akceptację" : "Zaakceptuj", systemImage: calculation.accepted ? "xmark.circle" : "checkmark.circle")
        }
        Button(role: .destructive) { deleting = calculation } label: { Label("Usuń", systemImage: "trash") }
    }

    private func create() async {
        struct Reply: Decodable { var id: String }
        do {
            let reply = try await store.tabAction(eventID, "calculations", "create", [:], reload: ["calculations"], success: nil, pending: "Tworzenie kalkulacji…")
            if let created = try? JSONDecoder().decode(Reply.self, from: reply) { openID = created.id }
        } catch {
            state.error = store.failureText(error, "Nie udało się utworzyć kalkulacji")
        }
    }

    private func duplicate(_ calculation: CalculationsTabData.Calculation) async {
        do {
            try await store.tabAction(eventID, "calculations", "duplicate", ["id": .string(calculation.id)], reload: ["calculations"],
                                      success: "Kalkulacja została zduplikowana", pending: "Duplikuję...")
        } catch {
            state.error = store.failureText(error, "Nie udało się zduplikować kalkulacji")
        }
    }

    private func remove(_ calculation: CalculationsTabData.Calculation) async {
        do {
            try await store.tabAction(eventID, "calculations", "remove", ["id": .string(calculation.id)], reload: ["calculations"], success: nil, pending: "Usuwanie…")
        } catch {
            state.error = store.failureText(error, "Nie udało się usunąć kalkulacji")
        }
    }

    private func toggleAccept(_ calculation: CalculationsTabData.Calculation) async {
        let accepted = !calculation.accepted
        let success: String = accepted ? "Kalkulacja zaakceptowana — dane finansowe zaktualizowane" : "Akceptacja cofnięta — przywrócono dane z oferty"
        do {
            try await store.tabAction(eventID, "calculations", "accept", ["id": .string(calculation.id), "accepted": .bool(accepted)],
                                      reload: ["calculations"], success: success, pending: "Zapisywanie…")
        } catch {
            state.error = store.failureText(error, "Nie udało się zmienić statusu kalkulacji")
        }
    }

    /// „Pokaż PDF” / „Drukuj PDF” — zapisany dokument kalkulacji.
    private func showPdf(_ calculation: CalculationsTabData.Calculation, print: Bool) async {
        guard calculation.pdf != nil else {
            state.snack = Snack(kind: .info, text: "Ta kalkulacja nie ma jeszcze wygenerowanego PDF")
            return
        }
        let fetched: (Data, String)? = await state.withPending("Otwieram PDF...") { () async -> (Data, String)? in
            do {
                return try await CalculationPdf.fetch(store, eventID, calculation.id, current: false)
            } catch {
                state.error = store.failureText(error, "Nie udało się otworzyć PDF")
                return nil
            }
        }
        guard let file = fetched else { return }
        if print {
            do { try CalculationPdf.printDocument(PDFDocument(data: file.0)) } catch { state.error = store.failureText(error, "Nie udało się otworzyć PDF") }
        } else {
            preview = NativePreview(name: file.1, data: file.0)
        }
    }

    private func send(_ calculation: CalculationsTabData.Calculation) {
        guard calculation.pdf != nil else {
            state.snack = Snack(kind: .info, text: "Najpierw wygeneruj PDF kalkulacji")
            return
        }
        state.snack = Snack(kind: .info, text: "Wysyłka kalkulacji e-mailem otworzy się w CRM — otwórz tam kalkulację „\(calculation.name)”.")
        state.openCRM("/crm/events/\(eventID)?tab=calculations")
    }
}

// MARK: Edytor kalkulacji (`CalculationEditor` + `CategorySection`)

struct CalculationItemRequest: Identifiable {
    let id = UUID()
    var category: CalculationCategory
    var editing: CalculationLine?
}

@MainActor struct CalculationEditorView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let calculationID: String
    let onBack: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var loaded = false
    @State private var loadError: String?
    @State private var name = ""
    @State private var notes = ""
    @State private var savedName = ""
    @State private var savedNotes = ""
    @State private var items: [CalculationLine] = []
    @State private var orderChanged = false
    @State private var pdfReady = false
    @State private var saving = false
    @State private var generating = false
    @State private var pdfAction: String?
    @State private var request: CalculationItemRequest?
    @State private var showImport = false
    @State private var deleting = false
    @State private var preview: NativePreview?

    private var working: Bool { saving || generating || pdfAction != nil }
    private var pdfVisible: Bool { pdfReady && !orderChanged }
    private var dirty: Bool { orderChanged || name != savedName || notes != savedNotes }

    var body: some View {
        Group {
            if loaded {
                editor
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać kalkulacji", systemImage: "function")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load(initial: true) } }
                    Button("Wróć do listy kalkulacji") { onBack() }
                }
            } else {
                ProgressView("Wczytywanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { if !loaded { await load(initial: true) } }
        .sheet(item: $request) { request in
            CalculationItemSheet(store: store, eventID: eventID, calculationID: calculationID, category: request.category,
                                 editing: request.editing, existing: items) {
                pdfReady = false
                await load(initial: false)
            }
        }
        .sheet(isPresented: $showImport) {
            CalculationImportSheet(store: store, eventID: eventID, existingRefs: Set(items.compactMap(\.sourceRef))) { picked in
                await importItems(picked)
            }
        }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
        .confirmationDialog("Usunąć kalkulację?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { Task { await deleteCalculation() } }
            Button("Anuluj", role: .cancel) { state.snack = Snack(kind: .info, text: "Anulowano usuwanie kalkulacji") }
        } message: { Text("Tej operacji nie można cofnąć.") }
    }

    private var editor: some View {
        VStack(spacing: 0) {
            header
            List {
                Section {
                    summaryCards
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Przeciągnij pozycję, aby zmienić kolejność w sekcji. Kliknij „Zapisz”, aby ją zachować.")
                        if orderChanged {
                            Text("Kolejność została zmieniona. Po zapisaniu wygeneruj ponownie PDF przed wysyłką.").foregroundStyle(theme.accent)
                        }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(CalculationCategory.allCases) { category in
                    section(category)
                }
                Section("Notatki") {
                    TextEditor(text: Binding(get: { notes }, set: { notes = $0; pdfReady = false }))
                        .font(.callout).frame(minHeight: 64).scrollContentBackground(.hidden)
                        .padding(6).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(alignment: .topLeading) {
                            if notes.isEmpty {
                                Text("Dodatkowe uwagi do kalkulacji...").font(.callout).foregroundStyle(.tertiary).padding(.horizontal, 11).padding(.vertical, 6).allowsHitTesting(false)
                            }
                        }
                        .disabled(working)
                }
                Section { totals }
            }
            .listStyle(.inset)
        }
    }

    // MARK: Nagłówek i akcje

    private var header: some View {
        HStack(spacing: 8) {
            Button { onBack() } label: { Image(systemName: "chevron.left") }.help("Wróć do listy kalkulacji")
            TextField("Nazwa kalkulacji", text: Binding(get: { name }, set: { name = $0; pdfReady = false }))
                .textFieldStyle(.roundedBorder).font(.title3.weight(.light)).frame(maxWidth: 380).disabled(working)
            Spacer()
            Button { showImport = true } label: { Label("Importuj z oferty", systemImage: "square.and.arrow.down") }.disabled(working)
            Button { Task { await generate() } } label: {
                Label(generating ? "Generuję..." : "Generuj PDF", systemImage: "doc.text")
            }
            .disabled(working)
            if pdfVisible {
                Button { Task { await openPdf(download: false) } } label: {
                    Label(pdfAction == "preview" ? "Otwieram PDF…" : "Podgląd PDF", systemImage: "eye")
                }
                .disabled(working)
            }
            Button { Task { await save() } } label: {
                Label(saving ? "Zapisywanie..." : "Zapisz", systemImage: "checkmark")
            }
            .buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command).disabled(working)
            Menu {
                Button { Task { await printCalculation() } } label: { Label("Drukuj", systemImage: "printer") }
                if pdfVisible {
                    Button { Task { await openPdf(download: true) } } label: { Label("Pobierz PDF", systemImage: "arrow.down.circle") }
                }
                Button { sendEmail() } label: { Label("Wyślij email", systemImage: "envelope") }
                Divider()
                Button(role: .destructive) { deleting = true } label: { Label("Usuń kalkulację", systemImage: "trash") }
            } label: { Image(systemName: "ellipsis.circle") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().disabled(working)
        }
        .controlSize(.regular)
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    // MARK: Sumy kategorii i całości

    private func lines(_ category: CalculationCategory) -> [CalculationLine] { items.filter { $0.category == category.rawValue } }

    private var summaryCards: some View {
        HStack(spacing: 10) {
            ForEach(CalculationCategory.allCases) { category in
                VStack(alignment: .leading, spacing: 3) {
                    Label(category.label, systemImage: category.symbol).font(.callout).foregroundStyle(.secondary)
                    Text(categoryNet(category)).font(.title3.weight(.light))
                    Text(categoryGross(category)).font(.callout.weight(.light)).foregroundStyle(theme.accent)
                    Text("\(lines(category).count) pozycji").font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(.vertical, 4)
    }

    private func categoryNet(_ category: CalculationCategory) -> String {
        let total = lines(category).reduce(0.0) { $0 + $1.net }
        return CalculationMath.money(total) + " netto"
    }

    private func categoryGross(_ category: CalculationCategory) -> String {
        let total = lines(category).reduce(0.0) { $0 + $1.gross }
        return CalculationMath.money(total) + " brutto"
    }

    private var totalPower: Double { items.reduce(0.0) { $0 + ($1.power ?? 0) * $1.quantity } }
    private var totalWeight: Double { items.reduce(0.0) { $0 + ($1.weight ?? 0) * $1.quantity } }
    private var grandNet: Double { CalculationMath.round2(items.reduce(0.0) { $0 + $1.net }) }
    private var grandGross: Double { CalculationMath.round2(items.reduce(0.0) { $0 + $1.gross }) }

    private var totals: some View {
        HStack(alignment: .center, spacing: 22) {
            if totalPower > 0 {
                HStack(spacing: 14) {
                    metric("Pobór mocy", CalculationMath.power(totalPower), symbol: "bolt.fill", color: .orange, large: true)
                    metric("1f / 230V", String(format: "%.1f A", CalculationMath.round2(totalPower / 230)), symbol: nil, color: .secondary, large: false)
                    metric("3f / 400V", String(format: "%.1f A", CalculationMath.round2(totalPower / (400 * 1.732))), symbol: nil, color: .secondary, large: false)
                }
            }
            if totalWeight > 0 {
                metric("Waga", CalculationMath.weight(totalWeight), symbol: "scalemass", color: .cyan, large: true)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("NETTO").font(.caption).foregroundStyle(.secondary)
                Text(CalculationMath.money(grandNet) + " PLN").font(.title3.weight(.light))
            }
            VStack(alignment: .trailing, spacing: 2) {
                Text("VAT").font(.caption).foregroundStyle(.secondary)
                Text(CalculationMath.money(CalculationMath.round2(grandGross - grandNet)) + " PLN").font(.title3.weight(.light)).foregroundStyle(.secondary)
            }
            VStack(alignment: .trailing, spacing: 2) {
                Text("BRUTTO").font(.caption).foregroundStyle(theme.accent)
                Text(CalculationMath.money(grandGross) + " PLN").font(.title.weight(.light)).foregroundStyle(theme.accent)
            }
        }
        .padding(12)
        .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    private func metric(_ title: String, _ value: String, symbol: String?, color: Color, large: Bool) -> some View {
        HStack(spacing: 6) {
            if let symbol { Image(systemName: symbol).foregroundStyle(color) }
            VStack(alignment: .leading, spacing: 1) {
                Text(title.uppercased()).font(.caption2).foregroundStyle(.secondary)
                Text(value).font(large ? .title3.weight(.light) : .callout).foregroundStyle(color)
            }
        }
    }

    // MARK: Sekcja kategorii (`CategorySection`)

    @ViewBuilder private func section(_ category: CalculationCategory) -> some View {
        let group = lines(category)
        let transport = category == .transport
        Section {
            if group.isEmpty {
                Text("Brak pozycji").font(.callout).foregroundStyle(.tertiary).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else {
                columns(transport)
            }
            ForEach(group) { line in
                row(line, transport: transport)
            }
            .onMove { from, to in reorder(category, from, to) }
            .moveDisabled(working)
        } header: {
            HStack(spacing: 8) {
                Label(category.label, systemImage: category.symbol).font(.headline)
                Text("(\(group.count))").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button { request = CalculationItemRequest(category: category, editing: nil) } label: { Label("Dodaj", systemImage: "plus") }
                    .controlSize(.small).disabled(working)
            }
            .padding(.top, 6)
        }
    }

    private func columns(_ transport: Bool) -> some View {
        HStack(spacing: 8) {
            Text("Nazwa").frame(minWidth: 160, maxWidth: .infinity, alignment: .leading)
            Text("Opis").frame(width: 150, alignment: .leading)
            Text("Ilość").frame(width: 50, alignment: .leading)
            Text("Jedn.").frame(width: 44, alignment: .leading)
            Text(transport ? "Km" : "Dni").frame(width: 60, alignment: .leading)
            Text(transport ? "Stawka" : "Cena jedn.").frame(width: 84, alignment: .leading)
            Text("VAT %").frame(width: 46, alignment: .leading)
            Text("Netto").frame(width: 90, alignment: .trailing)
            Text("Brutto").frame(width: 90, alignment: .trailing)
            Color.clear.frame(width: 24, height: 1)
        }
        .font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
        .moveDisabled(true)
    }

    private func row(_ line: CalculationLine, transport: Bool) -> some View {
        let fromWarehouse = line.source == "warehouse" && line.sourceRef != nil
        let exceeded = fromWarehouse && line.stock != nil && line.quantity > (line.stock ?? 0)
        let daysText: String = transport ? CalculationMath.plain(line.days) + " km" : CalculationMath.plain(line.days)
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if fromWarehouse {
                        WarehouseThumb(url: line.thumbnail, size: 30)
                            .overlay(alignment: .bottomTrailing) {
                                if exceeded { Image(systemName: "exclamationmark.triangle.fill").font(.caption2).foregroundStyle(.orange) }
                            }
                            .help(stockHelp(line))
                    }
                    Text(line.name.isEmpty ? "—" : line.name).lineLimit(2)
                }
                if line.source == "vehicle", let label = line.sourceLabel {
                    Text("Wewnętrznie: " + label).font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(minWidth: 160, maxWidth: .infinity, alignment: .leading)
            Text(line.description.isEmpty ? "—" : line.description).lineLimit(2).foregroundStyle(.secondary).frame(width: 150, alignment: .leading)
                .help(line.description)
            Text(CalculationMath.plain(line.quantity)).frame(width: 50, alignment: .leading)
            Text(line.unit).frame(width: 44, alignment: .leading)
            Text(daysText).frame(width: 60, alignment: .leading)
            Text(CalculationMath.money(line.unitPrice)).frame(width: 84, alignment: .leading)
            Text(CalculationMath.plain(line.vat) + "%").frame(width: 46, alignment: .leading)
            Text(CalculationMath.money(line.net)).frame(width: 90, alignment: .trailing)
            Text(CalculationMath.money(line.gross)).foregroundStyle(theme.accent).frame(width: 90, alignment: .trailing)
            Menu { lineActions(line) } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().frame(width: 24)
                .disabled(working)
        }
        .font(.callout)
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { if !working { request = CalculationItemRequest(category: CalculationCategory(rawValue: line.category) ?? .other, editing: line) } }
        .contextMenu { lineActions(line) }
    }

    private func stockHelp(_ line: CalculationLine) -> String {
        var parts: [String] = [line.name]
        if let stock = line.stock { parts.append("Stan: \(CalculationMath.plain(stock)) · W kalkulacji: \(CalculationMath.plain(line.quantity))") }
        if let power = line.power, power > 0 { parts.append("Pobór mocy: \(CalculationMath.plain(power)) W") }
        return parts.joined(separator: "\n")
    }

    @ViewBuilder private func lineActions(_ line: CalculationLine) -> some View {
        Button {
            request = CalculationItemRequest(category: CalculationCategory(rawValue: line.category) ?? .other, editing: line)
        } label: { Label("Edytuj", systemImage: "pencil") }
        .disabled(working)
        Button(role: .destructive) { Task { await removeLine(line) } } label: { Label("Usuń", systemImage: "trash") }
            .disabled(working)
    }

    // MARK: Dane i zapis

    private func load(initial: Bool) async {
        do {
            let data = try await store.tabQuery(eventID, "calculations", "editor", ["calculationId": calculationID], as: CalculationEditorData.self)
            if initial || !loaded {
                name = data.name
                notes = data.notes
                savedName = data.name
                savedNotes = data.notes
                pdfReady = data.pdf != nil
                items = data.items
            } else {
                items = merged(data.items)
            }
            loaded = true
            loadError = nil
        } catch {
            if loaded { state.error = store.failureText(error, "Nie udało się odświeżyć kalkulacji") }
            else { loadError = store.failureText(error, "Nie udało się wczytać kalkulacji") }
        }
    }

    /// Po zmianie pozycji zachowuje niezapisaną kolejność z edytora (nowe pozycje trafiają na koniec sekcji).
    private func merged(_ fresh: [CalculationLine]) -> [CalculationLine] {
        guard orderChanged else { return fresh }
        let order = Dictionary(items.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
        let indexed = fresh.enumerated().map { (line: $0.element, rank: order[$0.element.id] ?? (1_000_000 + $0.offset)) }
        return indexed.sorted { $0.rank < $1.rank }.map(\.line)
    }

    /// `reorderItems`: kolejność w obrębie sekcji; zapis przyciskiem „Zapisz”.
    private func reorder(_ category: CalculationCategory, _ from: IndexSet, _ to: Int) {
        guard !working else { return }
        var group = lines(category)
        group.move(fromOffsets: from, toOffset: to)
        var index = 0
        var next: [CalculationLine] = []
        for line in items {
            if line.category == category.rawValue {
                next.append(group[index])
                index += 1
            } else {
                next.append(line)
            }
        }
        guard next.map(\.id) != items.map(\.id) else { return }
        items = next
        orderChanged = true
    }

    /// `handleSave`: nazwa, notatki i wszystkie pozycje w kolejności jednym żądaniem.
    @discardableResult private func save() async -> Bool {
        guard !saving else { return false }
        saving = true
        defer { saving = false }
        let body: [String: JSONValue] = [
            "calculationId": .string(calculationID), "name": .string(name), "notes": .string(notes),
            "orderChanged": .bool(orderChanged), "items": .array(items.map(\.payload)),
        ]
        do {
            try await store.tabAction(eventID, "calculations", "save", body, reload: [], success: "Zapisano kalkulację", pending: "Zapisywanie…")
            orderChanged = false
            pdfReady = false
            savedName = name
            savedNotes = notes
            return true
        } catch {
            state.error = store.failureText(error, "Błąd zapisu")
            return false
        }
    }

    private func removeLine(_ line: CalculationLine) async {
        do {
            try await store.tabAction(eventID, "calculations", "removeItem", ["calculationId": .string(calculationID), "itemId": .string(line.id)],
                                      reload: [], success: nil, pending: "Usuwanie pozycji…")
            items.removeAll { $0.id == line.id }
            pdfReady = false
        } catch {
            state.error = store.failureText(error, "Błąd usuwania pozycji")
        }
    }

    private func importItems(_ picked: [JSONValue]) async -> Bool {
        struct Reply: Decodable { var count: Int }
        do {
            let data = try await store.tabAction(eventID, "calculations", "importItems", ["calculationId": .string(calculationID), "items": .array(picked)],
                                                 reload: [], success: nil, pending: "Importowanie pozycji…")
            let count = (try? JSONDecoder().decode(Reply.self, from: data))?.count ?? picked.count
            if count > 0 { state.succeed("Zaimportowano \(count) pozycji") }
            pdfReady = false
            await load(initial: false)
            return true
        } catch {
            state.error = store.failureText(error, "Błąd dodawania pozycji")
            return false
        }
    }

    private func deleteCalculation() async {
        do {
            try await store.tabAction(eventID, "calculations", "remove", ["id": .string(calculationID)], reload: ["calculations"], success: nil, pending: "Usuwanie…")
            onBack()
        } catch {
            state.error = store.failureText(error, "Nie udało się usunąć kalkulacji")
        }
    }

    // MARK: PDF, wydruk, wysyłka

    /// „Generuj PDF”: zapis, potem dokument z zapisanej rewizji — Chrome na Macu (albo serwer) → Pliki → Kalkulacje.
    private func generate() async {
        guard !items.isEmpty else {
            state.snack = Snack(kind: .info, text: "Kalkulacja nie zawiera pozycji")
            return
        }
        generating = true
        defer { generating = false }
        guard await save() else { return }
        await state.withPending(ChromePdfEngine.available ? "Generuję PDF kalkulacji…" : "Generuję PDF kalkulacji na serwerze…") {
            do {
                let payload = try await store.tabQueryData(eventID, "calculations", "pdfPayload", ["calculationId": calculationID])
                _ = try await state.generateStoredDocument(path: "/bridge/events/calculation-pdf", body: payload)
                pdfReady = true
                state.succeed("PDF kalkulacji zapisany w plikach wydarzenia")
            } catch {
                state.error = store.failureText(error, "Błąd generowania PDF")
            }
        }
    }

    private func openPdf(download: Bool) async {
        guard pdfAction == nil, !saving, !generating else { return }
        pdfAction = download ? "download" : "preview"
        defer { pdfAction = nil }
        let fetched: (Data, String)? = await state.withPending(download ? "Pobieram PDF…" : "Otwieram PDF…") { () async -> (Data, String)? in
            do {
                return try await CalculationPdf.fetch(store, eventID, calculationID, current: true)
            } catch {
                let message = store.failureText(error, "Nie udało się odczytać PDF kalkulacji.")
                if message.contains("zmieniła się") { pdfReady = false }
                state.error = message
                return nil
            }
        }
        guard let file = fetched else { return }
        if download {
            do {
                let target = try CalculationPdf.saveToDownloads(file.0, file.1)
                NSWorkspace.shared.activateFileViewerSelecting([target])
                state.succeed("Pobrano: \(target.lastPathComponent)")
            } catch {
                state.error = store.failureText(error, "Nie udało się pobrać PDF.")
            }
        } else {
            preview = NativePreview(name: file.1, data: file.0)
        }
    }

    /// „Drukuj”: wydruk z zapisanej treści (niezapisane zmiany najpierw się zapisują), bez dodawania pliku do wydarzenia.
    private func printCalculation() async {
        guard pdfAction == nil else { return }
        if dirty { guard await save() else { return } }
        pdfAction = "print"
        defer { pdfAction = nil }
        let printed: URL? = await state.withPending("Przygotowuję wydruk…") { () async -> URL? in
            do {
                return try await state.printDocument(path: "/bridge/events/calculation-pdf", query: ["eventId": eventID, "calculationId": calculationID],
                                                     fallbackName: "kalkulacja.pdf")
            } catch {
                state.error = store.failureText(error, "Nie udało się przygotować wydruku.")
                return nil
            }
        }
        guard let url = printed else { return }
        do { try CalculationPdf.printDocument(PDFDocument(url: url)) } catch { state.error = store.failureText(error, "Nie udało się przygotować wydruku.") }
    }

    private func sendEmail() {
        guard pdfVisible else {
            state.snack = Snack(kind: .info, text: "Najpierw wygeneruj PDF kalkulacji")
            return
        }
        state.snack = Snack(kind: .info, text: "Wysyłka kalkulacji e-mailem otworzy się w CRM — otwórz tam kalkulację „\(name)”.")
        state.openCRM("/crm/events/\(eventID)?tab=calculations")
    }
}

// MARK: Formularz pozycji (`AddCalculationItemModal`)

struct CalculationCatalogOption: Decodable, Identifiable, Equatable {
    var id: String
    var label: String
    var name: String
    var title: String
    var subtitle: String
    var detail: String?
    var price: Double
    var unit: String
    var vat: Double
    var thumbnail: String?
    var stock: Double?
    var power: Double?
    var weight: Double?
    var description: String
    var minimum: Double?
    var people: Double?
    var fuelType: String?
}

private struct CalculationCatalogReply: Decodable { var options: [CalculationCatalogOption] }

@MainActor struct CalculationItemSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let calculationID: String
    let category: CalculationCategory
    let editing: CalculationLine?
    let existing: [CalculationLine]
    let onSaved: () async -> Void
    @Environment(\.crmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var mode: String
    @State private var sourceChanged = false
    @State private var catalogs: [String: [CalculationCatalogOption]] = [:]
    @State private var catalogLoading = false
    @State private var catalogError = ""
    @State private var selected: CalculationCatalogOption?
    @State private var search = ""
    @State private var visibleCount = 30
    @State private var name: String
    @State private var details: String
    @State private var unit: String
    @State private var quantity: String
    @State private var days: String
    @State private var unitPrice: String
    @State private var vat: String
    @State private var power: String
    @State private var estimate: JSONValue?
    @State private var travelBusy = false
    @State private var travelPending = false
    @State private var formError = ""
    @State private var submitting = false

    init(store: EventCardStore, eventID: String, calculationID: String, category: CalculationCategory, editing: CalculationLine?,
         existing: [CalculationLine], onSaved: @escaping () async -> Void) {
        _store = ObservedObject(wrappedValue: store)
        self.eventID = eventID
        self.calculationID = calculationID
        self.category = category
        self.editing = editing
        self.existing = existing
        self.onSaved = onSaved
        var initialMode = category == .equipment ? "warehouse" : "manual"
        var initialSelection: CalculationCatalogOption?
        if let editing {
            initialMode = ["warehouse", "product", "vehicle"].contains(editing.source) ? editing.source : "manual"
            if let ref = editing.sourceRef, editing.source == "warehouse" {
                initialSelection = CalculationCatalogOption(id: ref, label: editing.name, name: editing.name, title: editing.name, subtitle: "", detail: nil,
                                                            price: editing.unitPrice, unit: editing.unit, vat: editing.vat, thumbnail: editing.thumbnail,
                                                            stock: editing.stock ?? 0, power: editing.power, weight: editing.weight, description: "",
                                                            minimum: nil, people: nil, fuelType: nil)
            } else if let ref = editing.sourceRef, editing.source == "product" || editing.source == "vehicle" {
                let label: String = editing.sourceLabel ?? editing.name
                initialSelection = CalculationCatalogOption(id: ref, label: label, name: editing.name, title: label, subtitle: "", detail: nil,
                                                            price: editing.unitPrice, unit: editing.unit, vat: editing.vat, thumbnail: nil, stock: nil,
                                                            power: nil, weight: nil, description: editing.description, minimum: nil, people: nil, fuelType: nil)
            }
        }
        let defaultUnit: String = category == .staff ? "h" : category == .transport ? "auto" : "szt."
        let priceDigits = category == .transport ? 6 : 2
        _mode = State(initialValue: initialMode)
        _selected = State(initialValue: initialSelection)
        _name = State(initialValue: editing?.name ?? "")
        _details = State(initialValue: editing?.description ?? "")
        _unit = State(initialValue: editing?.unit.nonEmpty ?? defaultUnit)
        _quantity = State(initialValue: CalculationMath.plain(editing?.quantity ?? 1))
        _days = State(initialValue: CalculationMath.plain(editing?.days ?? 1))
        _unitPrice = State(initialValue: CalculationMath.plain(editing?.unitPrice ?? 0, max: priceDigits))
        _vat = State(initialValue: CalculationMath.plain(editing?.vat ?? 23))
        _power = State(initialValue: editing?.power.map { CalculationMath.plain($0) } ?? "")
        _estimate = State(initialValue: editing?.transportEstimate)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(editing != nil ? "Edytuj pozycję" : "Dodaj pozycję").font(.title3.weight(.semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(submitting)
            }
            .padding(20)
            ScrollView {
                content.padding(.horizontal, 20).padding(.bottom, 12)
            }
            .disabled(submitting)
            if !formError.isEmpty {
                Text(formError).font(.callout).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.top, 6)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(submitting)
                Button(submitting ? "Zapisuję…" : editing != nil ? "Zapisz zmiany" : "Dodaj pozycję") { Task { await submit() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!canSubmit)
            }
            .padding(20)
        }
        .frame(width: 840, height: 780)
        .task(id: mode) { await loadCatalog() }
        .onChange(of: search) { _, _ in visibleCount = 30 }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            if category == .equipment { modePicker(["warehouse", "manual"]) }
            if category == .staff { modePicker(["manual", "product"]) }
            if category == .transport { modePicker(["manual", "vehicle"]) }
            if mode == "product" || mode == "vehicle" { catalogSection }
            if mode == "warehouse" { warehouseSection }
            if mode == "manual" || selected != nil { formFields }
        }
    }

    private func modeLabel(_ value: String) -> String {
        switch value {
        case "warehouse": return "Z magazynu"
        case "product": return "Usługi personelu z katalogu"
        case "vehicle": return "Pojazdy z bazy"
        default: return "Ręcznie"
        }
    }

    private func modePicker(_ values: [String]) -> some View {
        Picker("", selection: Binding(get: { mode }, set: { switchMode($0) })) {
            ForEach(values, id: \.self) { value in Text(modeLabel(value)).tag(value) }
        }
        .pickerStyle(.segmented).labelsHidden().fixedSize()
    }

    private func switchMode(_ value: String) {
        guard value != mode else { return }
        mode = value
        sourceChanged = true
        selected = nil
        name = ""
        if category == .equipment {
            if value == "warehouse" { details = "" } else { power = "" }
        } else {
            estimate = nil
            travelPending = false
            details = ""
            unitPrice = "0"
            power = ""
            search = ""
        }
    }

    private func loadCatalog() async {
        let current = mode
        guard current != "manual", catalogs[current] == nil else { return }
        catalogLoading = true
        catalogError = ""
        defer { catalogLoading = false }
        do {
            let reply = try await store.tabQuery(eventID, "calculations", "catalog", ["kind": current == "warehouse" ? "equipment" : current], as: CalculationCatalogReply.self)
            catalogs[current] = reply.options
        } catch {
            catalogError = store.failureText(error, "Nie udało się pobrać katalogu. Zamknij formularz i spróbuj ponownie.")
        }
    }

    // MARK: Usługi personelu i pojazdy

    private var catalogMatches: [CalculationCatalogOption] {
        let needle = search.lowercased(with: Locale(identifier: "pl_PL"))
        return (catalogs[mode] ?? []).filter { needle.isEmpty || $0.label.lowercased(with: Locale(identifier: "pl_PL")).contains(needle) }
    }

    @ViewBuilder private var catalogSection: some View {
        if let chosen = selected {
            VStack(alignment: .leading, spacing: 6) {
                Text(selectionText(chosen))
                if mode == "vehicle" {
                    Text("W kalkulacji dla klienta pojawią się wyłącznie nazwa i opis pozycji poniżej. Wybór pojazdu nie rezerwuje go.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button("Zmień") {
                    selected = nil
                    estimate = nil
                    travelPending = false
                    name = ""
                }
                .buttonStyle(.link).linkCursor()
            }
            .font(.callout).padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                TextField(mode == "product" ? "Szukaj usługi personelu…" : "Szukaj pojazdu…", text: $search).textFieldStyle(.roundedBorder)
                Group {
                    if catalogLoading {
                        Text("Wczytuję…").foregroundStyle(.secondary).padding(12)
                    } else if !catalogError.isEmpty {
                        Text(catalogError).foregroundStyle(.orange).padding(12)
                    } else if (catalogs[mode] ?? []).isEmpty {
                        Text(mode == "product"
                             ? "Brak usług. Otwórz kartę produktu → Podstawowe informacje → Edytuj. Zaznacz „Usługa personelu — bez sprzętu” oraz „Produkt aktywny”, a następnie zapisz sekcję."
                             : "Brak dostępnych pojazdów.")
                            .foregroundStyle(.secondary).padding(12)
                    } else {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 0) {
                                ForEach(catalogMatches) { option in
                                    Button { pick(option) } label: { catalogRow(option) }.buttonStyle(.plain)
                                }
                            }
                        }
                        .frame(height: 260)
                    }
                }
                .font(.callout)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func selectionText(_ option: CalculationCatalogOption) -> String {
        let prefix: String = mode == "vehicle" ? "Pojazd — informacja wewnętrzna: " : "Usługa z katalogu: "
        return prefix + option.label
    }

    private func productFacts(_ option: CalculationCatalogOption) -> String {
        let people: String = option.people.map { CalculationMath.plain($0) + " os." } ?? "nie określono"
        let minimum: String = CalculationMath.plain(option.minimum ?? 1)
        return "Obsada: \(people) · Jednostka: \(option.unit) · Min. ilość: \(minimum) \(option.unit)"
    }

    private func catalogRow(_ option: CalculationCatalogOption) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if mode == "product" { WarehouseThumb(url: option.thumbnail, size: 48) }
            VStack(alignment: .leading, spacing: 3) {
                Text(option.label).font(.callout.weight(.medium))
                if mode == "product" {
                    Text(productFacts(option)).font(.caption).foregroundStyle(.secondary)
                    Text(CalculationMath.money(option.price) + " zł netto / " + option.unit).font(.caption).foregroundStyle(theme.accent)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .contentShape(Rectangle())
    }

    private func pick(_ option: CalculationCatalogOption) {
        selected = option
        estimate = nil
        travelPending = false
        sourceChanged = true
        name = option.name
        details = option.description
        unitPrice = CalculationMath.plain(option.price, max: 6)
        unit = option.unit
        vat = CalculationMath.plain(option.vat)
        power = ""
    }

    // MARK: Sprzęt z magazynu

    private func alreadyAdded(_ id: String) -> Double {
        existing.filter { $0.id != editing?.id && $0.source == "warehouse" && $0.sourceRef == id }.reduce(0.0) { $0 + $1.quantity }
    }

    private func remaining(_ option: CalculationCatalogOption) -> Double { max((option.stock ?? 0) - alreadyAdded(option.id), 0) }

    private var equipmentMatches: [CalculationCatalogOption] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased(with: Locale(identifier: "pl_PL"))
        return (catalogs["warehouse"] ?? []).filter { option in
            guard remaining(option) > 0 else { return false }
            if needle.isEmpty { return true }
            let full: String = [option.title, option.subtitle, option.detail ?? ""].joined(separator: " ").lowercased(with: Locale(identifier: "pl_PL"))
            return full.contains(needle)
        }
    }

    @ViewBuilder private var warehouseSection: some View {
        if let chosen = selected {
            HStack(spacing: 10) {
                WarehouseThumb(url: chosen.thumbnail, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(chosen.subtitle.nonEmpty ?? chosen.label).font(.callout.weight(.medium)).lineLimit(1)
                    HStack(spacing: 8) {
                        Text(chosen.title)
                        if let watts = chosen.power, watts > 0 {
                            Label(CalculationMath.plain(watts) + "W", systemImage: "bolt.fill").foregroundStyle(.orange)
                        }
                        Text("Stan: " + CalculationMath.plain(chosen.stock ?? 0)).foregroundStyle(.tertiary)
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Zmień") {
                    selected = nil
                    name = ""
                    power = ""
                    unitPrice = "0"
                }
                .buttonStyle(.link).linkCursor()
            }
            .padding(10)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Szukaj sprzętu...", text: $search).textFieldStyle(.roundedBorder)
                equipmentList
            }
        }
    }

    private var equipmentList: some View {
        let all = equipmentMatches
        let shown = Array(all.prefix(visibleCount))
        return VStack(spacing: 0) {
            if catalogLoading {
                Text("Wczytywanie...").foregroundStyle(.secondary).padding(24)
            } else if !catalogError.isEmpty {
                Text(catalogError).foregroundStyle(.orange).padding(24)
            } else if all.isEmpty {
                Text("Brak wyników").foregroundStyle(.secondary).padding(24)
            } else {
                HStack(spacing: 10) {
                    Text("").frame(width: 44)
                    Text("Nazwa / marka / model").frame(maxWidth: .infinity, alignment: .leading)
                    Text("Cena rentalna").frame(width: 100, alignment: .trailing)
                    Text("Pobór prądu").frame(width: 90, alignment: .trailing)
                    Text("Stan").frame(width: 100, alignment: .trailing)
                }
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                .padding(.horizontal, 10).padding(.vertical, 6)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(shown) { option in
                            Button { pickEquipment(option) } label: { equipmentRow(option) }.buttonStyle(.plain)
                        }
                        if visibleCount < all.count {
                            Button("Pokaż więcej (\(min(visibleCount, all.count)) / \(all.count))") { visibleCount += 30 }
                                .controlSize(.small).padding(10)
                        }
                    }
                }
                .frame(height: 380)
            }
        }
        .font(.callout)
        .frame(maxWidth: .infinity)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func equipmentRow(_ option: CalculationCatalogOption) -> some View {
        let added = alreadyAdded(option.id)
        let left = remaining(option)
        let priceText: String = option.price > 0 ? String(format: "%.2f zł", option.price) : "—"
        return HStack(spacing: 10) {
            WarehouseThumb(url: option.thumbnail, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(option.title).font(.callout.weight(.medium))
                Text(option.subtitle.nonEmpty ?? "—").font(.caption).foregroundStyle(.secondary)
                if let detail = option.detail {
                    Text(detail).font(.caption2).foregroundStyle(theme.accent)
                        .padding(.horizontal, 6).padding(.vertical, 1).background(theme.accent.opacity(0.12), in: Capsule())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(priceText).foregroundStyle(theme.accent).frame(width: 100, alignment: .trailing)
            Group {
                if let watts = option.power, watts > 0 {
                    Label(CalculationMath.power(watts), systemImage: "bolt.fill").foregroundStyle(.orange)
                } else {
                    Text("—").foregroundStyle(.tertiary)
                }
            }
            .frame(width: 90, alignment: .trailing)
            VStack(alignment: .trailing, spacing: 1) {
                Text("Stan: " + CalculationMath.plain(option.stock ?? 0)).foregroundStyle((option.stock ?? 0) > 0 ? Color.green : Color.red)
                Text("Pozostało: " + CalculationMath.plain(left)).foregroundStyle(left > 0 ? Color.green : Color.red)
                if added > 0 { Text("Dodano: " + CalculationMath.plain(added)).foregroundStyle(theme.accent) }
            }
            .font(.caption)
            .frame(width: 100, alignment: .trailing)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private func pickEquipment(_ option: CalculationCatalogOption) {
        var chosen = option
        chosen.stock = remaining(option)
        selected = chosen
        sourceChanged = true
        name = option.label
        unitPrice = CalculationMath.plain(option.price)
        power = option.power.map { CalculationMath.plain($0) } ?? ""
    }

    // MARK: Pola pozycji

    private var stockExceeded: Bool {
        guard mode == "warehouse", let chosen = selected, let amount = CalculationMath.parse(quantity) else { return false }
        return amount > (chosen.stock ?? 0)
    }

    private var vehicleFuelType: String? {
        guard mode == "vehicle", let chosen = selected else { return nil }
        return chosen.fuelType ?? catalogs["vehicle"]?.first { $0.id == chosen.id }?.fuelType
    }

    private func field<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var formFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            field("Nazwa") { TextField("Nazwa pozycji...", text: $name).textFieldStyle(.roundedBorder) }
            field("Opis") {
                TextEditor(text: $details).font(.body).frame(height: 90).scrollContentBackground(.hidden)
                    .padding(4).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
                    .overlay(alignment: .topLeading) {
                        if details.isEmpty {
                            Text("Opcjonalny opis...").foregroundStyle(.tertiary).padding(.horizontal, 9).padding(.vertical, 4).allowsHitTesting(false)
                        }
                    }
            }
            if category == .transport {
                CalculationTravelPanel(store: store, eventID: eventID, calculationID: calculationID,
                                       vehicleID: mode == "vehicle" ? selected?.id ?? "" : "", vehicleFuelType: vehicleFuelType,
                                       initial: sourceChanged ? nil : editing?.transportEstimate,
                                       days: $days, unitPrice: $unitPrice, estimate: $estimate, busy: $travelBusy, pending: $travelPending)
                    .id(selected?.id ?? "manual-transport")
                if travelPending {
                    Button("Użyj ręcznie wpisanego dystansu i stawki poniżej") {
                        travelPending = false
                        estimate = nil
                    }
                    .buttonStyle(.link).linkCursor().disabled(travelBusy)
                }
            }
            HStack(alignment: .bottom, spacing: 12) {
                field(category == .transport ? "Ilość aut" : "Ilość") {
                    if stockExceeded, let stock = selected?.stock {
                        Label("Przekroczono stan (\(CalculationMath.plain(stock)) dostępne)", systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange)
                    }
                    TextField("", text: $quantity).textFieldStyle(.roundedBorder)
                }
                field("Jednostka") { TextField("", text: $unit).textFieldStyle(.roundedBorder) }
                field(category == .transport ? "Odległość (km)" : "Dni") {
                    TextField("", text: Binding(get: { days }, set: { value in
                        days = value
                        if category == .transport {
                            estimate = nil
                            travelPending = false
                        }
                    }))
                    .textFieldStyle(.roundedBorder).disabled(travelBusy)
                }
                field("VAT %") { TextField("", text: $vat).textFieldStyle(.roundedBorder) }
            }
            HStack(alignment: .top, spacing: 12) {
                field(category == .transport ? "Stawka za km (netto)" : "Cena jednostkowa (netto)") {
                    TextField("", text: Binding(get: { unitPrice }, set: { value in
                        unitPrice = value
                        if category == .transport {
                            estimate = nil
                            travelPending = false
                        }
                    }))
                    .textFieldStyle(.roundedBorder).disabled(travelBusy)
                }
                if category == .equipment || category == .other {
                    field("Pobór mocy (W)") { TextField("np. 575", text: $power).textFieldStyle(.roundedBorder) }
                } else {
                    Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
                }
            }
            if (CalculationMath.parse(unitPrice) ?? 0) > 0 { preview }
        }
    }

    /// Podgląd sumy pozycji (ilość × cena × dni / km).
    private var preview: some View {
        let amount = CalculationMath.parse(quantity) ?? 0
        let price = CalculationMath.parse(unitPrice) ?? 0
        let span = CalculationMath.parse(days) ?? 0
        let rate = CalculationMath.parse(vat) ?? 0
        let net = amount * price * (span == 0 ? 1 : span)
        let gross = net * (1 + rate / 100)
        let formula: String = category == .transport
            ? "\(CalculationMath.plain(amount)) aut x \(CalculationMath.plain(price, max: 6)) zł/km x \(CalculationMath.plain(span)) km"
            : "\(CalculationMath.plain(amount)) x \(String(format: "%.2f", price)) x \(CalculationMath.plain(span)) dni"
        return HStack {
            Text(formula).font(.callout).foregroundStyle(.secondary)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(CalculationMath.money(net) + " PLN netto").font(.callout)
                Text(CalculationMath.money(gross) + " PLN brutto").font(.caption).foregroundStyle(theme.accent)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }

    private var canSubmit: Bool {
        if submitting || travelBusy || travelPending { return false }
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
        if mode == "warehouse" && selected == nil { return false }
        if (mode == "product" || mode == "vehicle") && selected == nil { return false }
        return true
    }

    private func submit() async {
        guard !submitting, !travelBusy, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if travelPending {
            formError = "Zastosuj wynik kalkulatora lub wybierz ręczną stawkę transportu."
            return
        }
        let parsedQuantity = CalculationMath.parse(quantity)
        let parsedDays = CalculationMath.parse(days)
        let parsedPrice = CalculationMath.parse(unitPrice)
        let parsedVat = CalculationMath.parse(vat)
        guard let amount = parsedQuantity, let span = parsedDays, let price = parsedPrice, let rate = parsedVat, amount > 0, span > 0, price >= 0, rate >= 0, rate <= 100,
              !unit.trimmingCharacters(in: .whitespaces).isEmpty else {
            formError = "Uzupełnij poprawną ilość, jednostkę, dni / kilometry, cenę i VAT."
            return
        }
        guard canSubmit else { return }
        let source: String = selected != nil ? (mode == "warehouse" ? "warehouse" : mode) : ((!sourceChanged ? editing?.source : nil) ?? "manual")
        let sourceRef: String? = selected?.id ?? (!sourceChanged ? editing?.sourceRef : nil)
        let weight: Double? = (mode == "warehouse" ? selected?.weight : nil) ?? (!sourceChanged ? editing?.weight : nil)
        var item: [String: JSONValue] = [
            "category": .string(category.rawValue), "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
            "description": .string(details.trimmingCharacters(in: .whitespacesAndNewlines)), "unit": .string(unit),
            "quantity": .number(amount), "unitPrice": .number(price), "days": .number(span), "source": .string(source), "vat": .number(rate),
        ]
        item["id"] = editing.map { JSONValue.string($0.id) } ?? JSONValue.null
        item["sourceRef"] = sourceRef.map { JSONValue.string($0) } ?? JSONValue.null
        item["power"] = CalculationMath.parse(power).map { JSONValue.number($0) } ?? JSONValue.null
        item["weight"] = weight.map { JSONValue.number($0) } ?? JSONValue.null
        item["transportEstimate"] = category == .transport ? (estimate ?? JSONValue.null) : JSONValue.null
        submitting = true
        formError = ""
        defer { submitting = false }
        do {
            try await store.tabAction(eventID, "calculations", "saveItem", ["calculationId": .string(calculationID), "item": .object(item)],
                                      reload: [], success: nil, pending: editing != nil ? "Zapisywanie pozycji…" : "Dodawanie pozycji…")
            await onSaved()
            dismiss()
        } catch {
            formError = store.failureText(error, "Nie udało się zapisać pozycji.")
        }
    }
}

// MARK: Trasa i koszt paliwa dla transportu (`CalculationVehicleTravel` + `VehicleTravelCalculator`)

private let calculationTravelOrigin = "Marcina Kasprzaka 15/66, Olsztyn, Polska"
private let calculationFuelTypes: [(id: String, label: String)] = [
    ("benzyna95", "Benzyna 95"), ("benzyna98", "Benzyna 98"), ("diesel", "Olej napędowy"), ("LPG", "LPG"),
]

private struct CalculationTravelContext: Decodable {
    struct Place: Decodable { var label: String; var locationId: String?; var source: String }
    var origin: String
    var destination: Place?
}

private struct CalculationConsumption: Decodable { var value: Double?; var source: String?; var error: String? }

@MainActor struct CalculationTravelPanel: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let calculationID: String
    let vehicleID: String
    let vehicleFuelType: String?
    let initial: JSONValue?
    @Binding var days: String
    @Binding var unitPrice: String
    @Binding var estimate: JSONValue?
    @Binding var busy: Bool
    @Binding var pending: Bool
    @Environment(\.crmTheme) private var theme

    @State private var prepared = false
    @State private var origin = "Marcina Kasprzaka 15/66, Olsztyn, Polska"
    @State private var destination = ""
    @State private var manual = false
    @State private var suggested: CalculationTravelContext.Place?
    @State private var contextError = ""
    @State private var fuelVat = "23"
    @State private var route: JSONValue?
    @State private var routeDirty = false
    @State private var message = ""
    @State private var roundTrip = true
    @State private var initialFuelType: String?
    @State private var fuelOverride: String?
    @State private var manualPrices: [String: String] = [:]
    @State private var manualConsumption: String?
    @State private var consumptionInfo: CalculationConsumption?
    @State private var quote: JSONValue?
    @State private var quoteError = ""
    @State private var priceLoading = false
    @State private var priceRefresh = 0
    @State private var routeLoading = false
    @State private var routeError = ""

    private var fuelType: String { fuelOverride ?? vehicleFuelType?.nonEmpty ?? initialFuelType ?? "diesel" }
    private var isLiquid: Bool { calculationFuelTypes.contains { $0.id == fuelType } }
    private var quotePrices: [String: JSONValue] { quote?.object["prices"]?.object ?? [:] }
    private var quotedPrice: Double? {
        if case .number(let value)? = quotePrices[fuelType] { return value }
        return nil
    }
    private var price: String { manualPrices[fuelType] ?? quotedPrice.map { CalculationMath.plain($0, max: 3) } ?? "" }
    private var consumption: String { manualConsumption ?? consumptionInfo?.value.map { CalculationMath.plain($0) } ?? "" }
    private var distance: String { routeDirty ? "" : days }
    private var cost: Double? {
        guard isLiquid, !distance.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return CalculationMath.fuelCost(CalculationMath.parse(distance) ?? .nan, CalculationMath.parse(consumption) ?? 0, CalculationMath.parse(price) ?? 0)
    }
    private var routeKm: Double? {
        if case .number(let value)? = route?.object["distanceKm"] { return value }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Trasa i koszt paliwa").font(.headline)
            field("Miejsce startu") {
                TextField("", text: Binding(get: { origin }, set: { origin = $0; invalidateRoute() })).textFieldStyle(.roundedBorder).disabled(routeLoading)
            }
            Text(targetText).font(.caption).foregroundStyle(.secondary)
            field("Miejsce docelowe") {
                TextField("Nazwa obiektu, ulica, numer i miasto", text: Binding(get: { destination }, set: { value in
                    manual = true
                    destination = String(value.prefix(500))
                    invalidateRoute()
                }))
                .textFieldStyle(.roundedBorder).disabled(routeLoading)
            }
            if let suggested {
                HStack(spacing: 6) {
                    Text(suggestionText(suggested))
                    if manual {
                        Button("Użyj tej lokalizacji") {
                            manual = false
                            destination = suggested.label
                            invalidateRoute()
                        }
                        .buttonStyle(.link).linkCursor().disabled(routeLoading)
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            if !contextError.isEmpty { Text(contextError).font(.caption).foregroundStyle(.orange) }
            field("VAT w cenie paliwa (%)") {
                TextField("", text: Binding(get: { fuelVat }, set: { value in
                    fuelVat = value
                    pending = true
                    message = "Zmieniono VAT paliwa. Zastosuj koszt ponownie."
                }))
                .textFieldStyle(.roundedBorder).frame(maxWidth: 180).disabled(routeLoading)
            }
            Toggle("Uwzględnij powrót do miejsca startu", isOn: Binding(get: { roundTrip }, set: { roundTrip = $0; invalidateRoute() }))
                .disabled(routeLoading)
            HStack(alignment: .top, spacing: 12) {
                field("Paliwo") {
                    Picker("", selection: Binding(get: { fuelType }, set: { fuelOverride = $0; settingsChanged() })) {
                        ForEach(calculationFuelTypes, id: \.id) { option in Text(option.label).tag(option.id) }
                        Text("Elektryczny").tag("elektryczny")
                        Text("Inne").tag("other")
                        if !isLiquid && !["elektryczny", "other"].contains(fuelType) { Text(fuelType).tag(fuelType) }
                    }
                    .labelsHidden().disabled(routeLoading)
                }
                field("Średnie spalanie (l/100 km)") {
                    TextField("Uzupełnij spalanie", text: Binding(get: { consumption }, set: { manualConsumption = $0; settingsChanged() }))
                        .textFieldStyle(.roundedBorder).disabled(!isLiquid || routeLoading)
                }
                field("Cena paliwa (zł/l)") {
                    TextField(priceLoading ? "Pobieranie…" : "Uzupełnij cenę", text: Binding(get: { isLiquid ? price : "" }, set: { manualPrices[fuelType] = $0; settingsChanged() }))
                        .textFieldStyle(.roundedBorder).disabled(!isLiquid || routeLoading)
                }
            }
            if isLiquid {
                Text(consumptionText).font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text(priceText).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Pobierz cenę") {
                        manualPrices[fuelType] = nil
                        priceRefresh += 1
                        settingsChanged()
                    }
                    .controlSize(.small).disabled(priceLoading || routeLoading)
                }
                if !quoteError.isEmpty { Text(quoteError).font(.caption).foregroundStyle(.orange) }
            } else {
                Text("Dla tego napędu uzupełnij koszt energii lub paliwa ręcznie w polu kosztu poniżej.").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Button(routeLoading ? "Obliczanie trasy…" : "Oblicz trasę i koszt") { Task { await calculateRoute() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(routeLoading || origin.trimmingCharacters(in: .whitespaces).isEmpty || destination.trimmingCharacters(in: .whitespaces).isEmpty)
                if let cost {
                    Button("Zastosuj koszt: " + String(format: "%.2f", cost) + " zł") { apply(distanceKm: nil, newRoute: nil) }.disabled(routeLoading)
                }
            }
            .controlSize(.small)
            if !routeError.isEmpty { Text(routeError).font(.callout).foregroundStyle(.red) }
            if let route, let km = routeKm, CalculationMath.parse(distance) == km { routeSummary(route, km) }
            Text("Koszt = łączny dystans × spalanie / 100 × cena litra. Po korekcie spalania lub ceny kliknij „Zastosuj koszt”. Dystans i stawkę zapiszesz razem z pozycją kalkulacji. Przeliczenie brutto na netto pokazano poniżej.")
                .font(.caption2).foregroundStyle(.secondary)
            Text("Cena AutoCentrum jest brutto. Stawka paliwowa netto/km = spalanie ÷ 100 × cena litra brutto ÷ (1 + VAT paliwa ÷ 100). Obejmuje samo paliwo. Opłaty drogowe, wynajem i pracę kierowcy wyceń osobno lub uwzględnij we własnej stawce.")
                .font(.caption).foregroundStyle(.secondary)
            if !message.isEmpty { Text(message).font(.caption).foregroundStyle(theme.accent) }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .onAppear { prepare() }
        .onDisappear { busy = false }
        .task { await loadContext() }
        .task(id: vehicleID) { await loadConsumption() }
        .task(id: priceRefresh) { await loadQuote() }
    }

    private func field<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var targetText: String {
        let target: String = destination.isEmpty ? "Wpisz miejsce docelowe poniżej." : destination
        return "Cel realizacji: " + target
    }

    private func suggestionText(_ place: CalculationTravelContext.Place) -> String {
        let origin: String = place.source == "inquiry" ? "zapytania" : "wydarzenia"
        return "Lokalizacja z " + origin + ": " + place.label
    }

    private var consumptionText: String {
        if manualConsumption != nil { return "Spalanie zapisane dla tej kalkulacji lub wpisane ręcznie." }
        if consumptionInfo?.source == "vehicle" { return "Średnie spalanie z karty auta. Możesz je skorygować dla tego przejazdu, np. przy jeździe z przyczepą." }
        if consumptionInfo?.value != nil { return "Spalanie z tankowań z ostatnich 90 dni, ważone przejechanym dystansem. Możesz je skorygować, np. dla jazdy z przyczepą." }
        if let error = consumptionInfo?.error { return error }
        return "Uzupełnij średnie spalanie na karcie auta lub wpisz je dla tego przejazdu."
    }

    private var priceText: String {
        if manualPrices[fuelType] != nil { return "Cena wpisana ręcznie." }
        if quotedPrice != nil, let quote {
            let updated = quote.object["sourceUpdated"]?.text ?? ""
            let fetchedRaw = quote.object["fetchedAt"]?.text ?? ""
            let fetched: String = MeetingDates.parse(fetchedRaw).map { $0.formatted(date: .numeric, time: .shortened) } ?? fetchedRaw
            return "Średnia krajowa: AutoCentrum.pl. Aktualizacja źródła: \(updated) w chwili pobrania (\(fetched))."
        }
        return priceLoading ? "Pobieranie cen paliw…" : "Brak ceny dla wybranego paliwa — wpisz ją ręcznie."
    }

    private func routeSummary(_ route: JSONValue, _ km: Double) -> some View {
        let fields = route.object
        let outbound = fields["outbound"]?.object ?? [:]
        let inbound = fields["inbound"]?.object ?? [:]
        let start: String = outbound["startAddress"]?.text.nonEmpty ?? origin
        let end: String = outbound["endAddress"]?.text.nonEmpty ?? destination
        let outboundKm = String(format: "%.1f", (outbound["distanceMeters"]?.number ?? 0) / 1000)
        let minutes = Int(fields["travelMinutes"]?.number ?? 0)
        var line = "Dojazd: \(outboundKm) km · \(minutes) min"
        if !inbound.isEmpty {
            let back = String(format: "%.1f", (inbound["distanceMeters"]?.number ?? 0) / 1000)
            let backMinutes = Int(ceil((inbound["durationSeconds"]?.number ?? 0) / 60))
            line += " · Powrót: \(back) km · \(backMinutes) min"
        }
        line += " · Łącznie: " + String(format: "%.1f", km) + " km"
        return VStack(alignment: .leading, spacing: 3) {
            Text("\(start) → \(end)").font(.caption)
            Text(line).font(.caption)
            Button("Google Maps — zobacz dojazd") {
                var components = URLComponents(string: "https://www.google.com/maps/dir/")
                components?.queryItems = [URLQueryItem(name: "api", value: "1"), URLQueryItem(name: "origin", value: start),
                                          URLQueryItem(name: "destination", value: end), URLQueryItem(name: "travelmode", value: "driving")]
                if let url = components?.url { NSWorkspace.shared.open(url) }
            }
            .buttonStyle(.link).linkCursor().font(.caption)
        }
        .foregroundStyle(.secondary)
    }

    /// Stan początkowy z zapisanego szacunku pozycji (`transport_estimate`).
    private func prepare() {
        guard !prepared else { return }
        prepared = true
        let snapshot = initial?.object ?? [:]
        origin = snapshot["origin"]?.text.nonEmpty ?? calculationTravelOrigin
        let savedDestination = snapshot["destination"]?.text ?? ""
        destination = savedDestination
        manual = !savedDestination.isEmpty
        if case .number(let value)? = snapshot["fuel_vat_percent"] { fuelVat = CalculationMath.plain(value) }
        if let saved = snapshot["route"], !saved.object.isEmpty {
            route = saved
            if case .bool(let value)? = saved.object["round_trip"] { roundTrip = value }
        }
        let fuel = snapshot["fuel"]?.object ?? [:]
        let savedType = fuel["fuel_type"]?.text.nonEmpty
        initialFuelType = savedType
        if case .number(let value)? = fuel["price"], fuel["price_source"]?.text != "autocentrum" {
            manualPrices[savedType ?? "diesel"] = CalculationMath.plain(value, max: 3)
        }
        if case .number(let value)? = fuel["consumption"] { manualConsumption = CalculationMath.plain(value) }
        if let savedQuote = fuel["quote"], !savedQuote.object.isEmpty { quote = savedQuote }
    }

    private func invalidateRoute() {
        routeDirty = true
        route = nil
        pending = true
        message = "Cel lub kierunek zmienił się. Oblicz trasę ponownie."
    }

    private func settingsChanged() {
        pending = true
        message = "Ustawienia paliwa zmieniły się. Kliknij „Zastosuj koszt”."
    }

    private func fuelSnapshot(price: Double, consumption: Double) -> JSONValue {
        let manualPrice = manualPrices[fuelType] != nil
        return .object([
            "fuel_type": .string(fuelType),
            "price": price > 0 ? JSONValue.number(price) : JSONValue.null,
            "consumption": consumption > 0 ? JSONValue.number(consumption) : JSONValue.null,
            "price_source": .string(manualPrice ? "manual" : "autocentrum"),
            "quote": manualPrice ? JSONValue.null : (quote ?? JSONValue.null),
        ])
    }

    /// `apply` z `CalculationVehicleTravel`: dystans → pole km, stawka netto/km z ceny brutto paliwa i VAT, zapis szacunku.
    private func apply(distanceKm: Double?, newRoute: JSONValue?) {
        let km: Double = distanceKm ?? CalculationMath.parse(days) ?? .nan
        let nextRoute: JSONValue? = newRoute ?? route
        if let newRoute {
            route = newRoute
            routeDirty = false
        }
        if let distanceKm { days = CalculationMath.plain(distanceKm, max: 1) }
        let fuelPrice = CalculationMath.parse(price) ?? 0
        let fuelConsumption = CalculationMath.parse(consumption) ?? 0
        let vat = CalculationMath.parse(fuelVat) ?? -1
        guard fuelPrice > 0, fuelConsumption > 0, km.isFinite, km > 0, vat >= 0, vat <= 100 else {
            pending = true
            message = "Uzupełnij spalanie, cenę paliwa i VAT paliwa, a następnie zastosuj koszt."
            return
        }
        let rate = ((fuelConsumption / 100 * fuelPrice / (1 + vat / 100)) * 1_000_000).rounded() / 1_000_000
        unitPrice = CalculationMath.plain(rate, max: 6)
        estimate = .object([
            "version": .number(1), "origin": .string(origin), "destination": .string(destination),
            "fuel": fuelSnapshot(price: fuelPrice, consumption: fuelConsumption), "fuel_vat_percent": .number(vat),
            "distance_km": .number(km), "rate_net_per_km": .number(rate),
            "fuel_cost_gross": .number((km * fuelConsumption / 100 * fuelPrice * 100).rounded() / 100),
            "route": nextRoute ?? JSONValue.null, "applied_at": .string(MeetingDates.iso(Date())),
        ])
        pending = false
        message = "Zastosowano \(CalculationMath.plain(km)) km i \(CalculationMath.plain(rate, max: 6)) zł netto/km. Liczba aut jest mnożona w pozycji kalkulacji."
    }

    private func loadContext() async {
        do {
            let reply = try await store.tabQuery(eventID, "calculations", "travel", ["calculationId": calculationID, "action": "destination"], as: CalculationTravelContext.self)
            suggested = reply.destination
            if !manual { destination = reply.destination?.label ?? "" }
        } catch {
            contextError = store.failureText(error, "Wpisz cel ręcznie.")
        }
    }

    private func loadConsumption() async {
        guard !vehicleID.isEmpty else { consumptionInfo = nil; return }
        consumptionInfo = try? await store.tabQuery(eventID, "logistics", "consumption", ["vehicleId": vehicleID], as: CalculationConsumption.self)
    }

    private func loadQuote() async {
        priceLoading = true
        quoteError = ""
        defer { priceLoading = false }
        do {
            quote = try await store.tabQuery(eventID, "logistics", "fuel", as: JSONValue.self)
        } catch {
            quote = nil
            quoteError = store.failureText(error, "Wpisz cenę paliwa ręcznie.")
        }
    }

    private func calculateRoute() async {
        guard !routeLoading else { return }
        routeLoading = true
        busy = true
        routeError = ""
        defer {
            routeLoading = false
            busy = false
        }
        var params: [String: String] = ["calculationId": calculationID, "action": "route", "origin": origin, "roundTrip": roundTrip ? "1" : "0"]
        if manual { params["destination"] = destination }
        do {
            let reply = try await store.tabQuery(eventID, "calculations", "travel", params, as: JSONValue.self)
            guard case .number(let km)? = reply.object["distanceKm"] else { throw AppError.invalidResponse }
            apply(distanceKm: km, newRoute: reply)
        } catch {
            routeError = store.failureText(error, "Nie udało się obliczyć trasy.")
        }
    }
}

// MARK: Import z oferty (`ImportFromOfferModal`)

private struct CalculationImportSources: Decodable {
    struct Product: Decodable, Identifiable {
        var ref: String
        var name: String
        var description: String
        var quantity: Double
        var unit: String
        var unitPrice: Double
        var total: Double
        var offerName: String
        var categoryName: String?
        var category: String
        var vat: Double
        var id: String { ref }
    }
    struct Equipment: Decodable, Identifiable {
        var ref: String
        var name: String
        var quantity: Double
        var rentalPrice: Double
        var productName: String
        var offerName: String
        var isKit: Bool
        var isRental: Bool
        var id: String { ref }
    }
    struct Staff: Decodable, Identifiable {
        var ref: String
        var role: String
        var quantity: Double
        var hourlyRate: Double
        var estimatedHours: Double
        var productName: String
        var offerName: String
        var id: String { ref }
    }
    struct Vehicle: Decodable, Identifiable {
        var ref: String
        var vehicleName: String
        var role: String
        var driverName: String?
        var estimatedDistance: Double?
        var fuelCost: Double?
        var tollCost: Double?
        var id: String { ref }
    }
    var products: [Product]
    var equipment: [Equipment]
    var staff: [Staff]
    var vehicles: [Vehicle]
}

@MainActor struct CalculationImportSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let existingRefs: Set<String>
    let onImport: ([JSONValue]) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var mode = "products"
    @State private var sources: CalculationImportSources?
    @State private var loadError = ""
    @State private var categories: [String: String] = [:]
    @State private var pickedProducts: Set<String> = []
    @State private var pickedEquipment: Set<String> = []
    @State private var pickedStaff: Set<String> = []
    @State private var pickedVehicles: Set<String> = []
    @State private var importing = false

    private var totalSelected: Int {
        switch mode {
        case "products": return pickedProducts.count
        case "contents": return pickedEquipment.count + pickedStaff.count
        default: return pickedVehicles.count
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Importuj z oferty").font(.title3.weight(.light))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction).disabled(importing)
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
            Picker("", selection: $mode) {
                Label("Produkty", systemImage: "shippingbox").tag("products")
                Label("Zawartość (sprzęt + ludzie)", systemImage: "person.2").tag("contents")
                Label("Transport", systemImage: "truck.box").tag("transport")
            }
            .pickerStyle(.segmented).labelsHidden().padding(.horizontal, 20)
            HStack {
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("Zaznacz wszystkie") { toggleAll() }.controlSize(.small).disabled(sources == nil)
            }
            .padding(.horizontal, 20).padding(.vertical, 10)
            Group {
                if let sources {
                    ScrollView { table(sources).padding(.horizontal, 20) }
                } else if !loadError.isEmpty {
                    ContentUnavailableView("Nie udało się wczytać ofert", systemImage: "doc.text", description: Text(loadError))
                } else {
                    ProgressView("Wczytywanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxHeight: .infinity)
            HStack {
                Text("Zaznaczono: \(totalSelected)").font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }.disabled(importing)
                Button { Task { await runImport() } } label: { Label("Importuj (\(totalSelected))", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(totalSelected == 0 || importing)
            }
            .padding(20)
        }
        .frame(width: 900, height: 680)
        .task { await load() }
    }

    private var subtitle: String {
        switch mode {
        case "products": return "Importuj produkty z oferty jako pozycje kalkulacji."
        case "contents": return "Importuj sprzęt i pracowników przypisanych do produktów w ofercie."
        default: return "Importuj pojazdy przypisane do tego wydarzenia."
        }
    }

    private func load() async {
        do {
            sources = try await store.tabQuery(eventID, "calculations", "importSources", as: CalculationImportSources.self)
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać ofert wydarzenia.")
        }
    }

    @ViewBuilder private func table(_ sources: CalculationImportSources) -> some View {
        switch mode {
        case "products": productsTable(sources.products)
        case "contents": contentsTable(sources.equipment, sources.staff)
        default: transportTable(sources.vehicles)
        }
    }

    private func check(_ ref: String, _ set: Binding<Set<String>>) -> some View {
        Toggle("", isOn: Binding(get: { set.wrappedValue.contains(ref) }, set: { on in
            if on { set.wrappedValue.insert(ref) } else { set.wrappedValue.remove(ref) }
        }))
        .toggleStyle(.checkbox).labelsHidden().disabled(existingRefs.contains(ref)).frame(width: 24)
    }

    private var importedBadge: some View {
        Text("Już zaimportowano").font(.caption).foregroundStyle(theme.accent)
            .padding(.horizontal, 6).padding(.vertical, 1).background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
    }

    private func headerRow(_ titles: [(String, CGFloat?)]) -> some View {
        HStack(spacing: 10) {
            Color.clear.frame(width: 24, height: 1)
            ForEach(Array(titles.enumerated()), id: \.offset) { entry in
                if let width = entry.element.1 {
                    Text(entry.element.0).frame(width: width, alignment: .leading)
                } else {
                    Text(entry.element.0).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).padding(.vertical, 6)
    }

    @ViewBuilder private func productsTable(_ products: [CalculationImportSources.Product]) -> some View {
        if products.isEmpty {
            Text("Brak pozycji w ofertach dla tego wydarzenia.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(32)
        } else {
            VStack(spacing: 0) {
                headerRow([("Oferta", 110), ("Nazwa", nil), ("Kategoria", 130), ("Ilość", 80), ("Cena", 90), ("Wartość", 100)])
                ForEach(products) { product in
                    let imported = existingRefs.contains(product.ref)
                    HStack(spacing: 10) {
                        check(product.ref, $pickedProducts)
                        Text(product.offerName).foregroundStyle(.secondary).frame(width: 110, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(product.name)
                            if let categoryName = product.categoryName { Text(categoryName).font(.caption).foregroundStyle(.tertiary) }
                            if imported { importedBadge }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Picker("", selection: Binding(get: { categories[product.ref] ?? product.category }, set: { categories[product.ref] = $0 })) {
                            ForEach(CalculationCategory.allCases) { category in Text(category.label).tag(category.rawValue) }
                        }
                        .labelsHidden().controlSize(.small).disabled(imported).frame(width: 130)
                        Text(CalculationMath.plain(product.quantity) + " " + product.unit).frame(width: 80, alignment: .leading)
                        Text(CalculationMath.money(product.unitPrice)).frame(width: 90, alignment: .leading)
                        Text(CalculationMath.money(product.total)).foregroundStyle(theme.accent).frame(width: 100, alignment: .leading)
                    }
                    .font(.callout).padding(.vertical, 6).opacity(imported ? 0.45 : 1)
                }
            }
        }
    }

    @ViewBuilder private func contentsTable(_ equipment: [CalculationImportSources.Equipment], _ staff: [CalculationImportSources.Staff]) -> some View {
        if equipment.isEmpty && staff.isEmpty {
            Text("Brak sprzętu ani pracowników w produktach oferty.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(32)
        } else {
            VStack(alignment: .leading, spacing: 14) {
                if !equipment.isEmpty {
                    VStack(spacing: 0) {
                        Label("Sprzęt", systemImage: "shippingbox").font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                        headerRow([("Nazwa", nil), ("Typ", 80), ("Produkt", 160), ("Ilość", 60), ("Cena/dzień", 100)])
                        ForEach(equipment) { row in
                            let imported = existingRefs.contains(row.ref)
                            let kind: String = row.isKit ? "Zestaw" : row.isRental ? "Rental" : "Sprzęt"
                            HStack(spacing: 10) {
                                check(row.ref, $pickedEquipment)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.name)
                                    if imported { importedBadge }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text(kind).foregroundStyle(.secondary).frame(width: 80, alignment: .leading)
                                Text(row.productName).foregroundStyle(.secondary).lineLimit(1).frame(width: 160, alignment: .leading)
                                Text(CalculationMath.plain(row.quantity)).frame(width: 60, alignment: .leading)
                                Text(CalculationMath.money(row.rentalPrice)).foregroundStyle(theme.accent).frame(width: 100, alignment: .leading)
                            }
                            .font(.callout).padding(.vertical, 6).opacity(imported ? 0.45 : 1)
                        }
                    }
                }
                if !staff.isEmpty {
                    VStack(spacing: 0) {
                        Label("Ludzie", systemImage: "person.2").font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                        headerRow([("Rola", nil), ("Produkt", 160), ("Ilość", 60), ("Stawka/h", 90), ("Godziny", 70), ("Koszt", 100)])
                        ForEach(staff) { row in
                            let imported = existingRefs.contains(row.ref)
                            let total = row.hourlyRate * row.estimatedHours
                            HStack(spacing: 10) {
                                check(row.ref, $pickedStaff)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.role.isEmpty ? "—" : row.role)
                                    if imported { importedBadge }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text(row.productName).foregroundStyle(.secondary).lineLimit(1).frame(width: 160, alignment: .leading)
                                Text(CalculationMath.plain(row.quantity)).frame(width: 60, alignment: .leading)
                                Text(CalculationMath.money(row.hourlyRate)).frame(width: 90, alignment: .leading)
                                Text(CalculationMath.plain(row.estimatedHours)).frame(width: 70, alignment: .leading)
                                Text(total > 0 ? CalculationMath.money(total) : "—").foregroundStyle(theme.accent).frame(width: 100, alignment: .leading)
                            }
                            .font(.callout).padding(.vertical, 6).opacity(imported ? 0.45 : 1)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func transportTable(_ vehicles: [CalculationImportSources.Vehicle]) -> some View {
        if vehicles.isEmpty {
            Text("Brak pojazdów przypisanych do tego wydarzenia.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(32)
        } else {
            VStack(spacing: 0) {
                headerRow([("Pojazd", nil), ("Rola", 140), ("Kierowca", 150), ("Dystans", 80), ("Koszt szac.", 100)])
                ForEach(vehicles) { vehicle in
                    let imported = existingRefs.contains(vehicle.ref)
                    let total = (vehicle.fuelCost ?? 0) + (vehicle.tollCost ?? 0)
                    let distanceText: String = vehicle.estimatedDistance.map { CalculationMath.plain($0) + " km" } ?? "—"
                    HStack(spacing: 10) {
                        check(vehicle.ref, $pickedVehicles)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(vehicle.vehicleName)
                            if imported { importedBadge }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(vehicle.role).foregroundStyle(.secondary).frame(width: 140, alignment: .leading)
                        Text(vehicle.driverName ?? "—").frame(width: 150, alignment: .leading)
                        Text(distanceText).frame(width: 80, alignment: .leading)
                        Text(total > 0 ? CalculationMath.money(total) : "—").foregroundStyle(theme.accent).frame(width: 100, alignment: .leading)
                    }
                    .font(.callout).padding(.vertical, 6).opacity(imported ? 0.45 : 1)
                }
            }
        }
    }

    /// „Zaznacz wszystkie” — jak w CRM: drugi klik odznacza, gdy zaznaczone są już wszystkie dostępne.
    private func toggleAll() {
        guard let sources else { return }
        func flip(_ refs: [String], _ current: Set<String>) -> Set<String> {
            let available = refs.filter { !existingRefs.contains($0) }
            return current.count == available.count ? [] : Set(available)
        }
        switch mode {
        case "products": pickedProducts = flip(sources.products.map(\.ref), pickedProducts)
        case "contents":
            pickedEquipment = flip(sources.equipment.map(\.ref), pickedEquipment)
            pickedStaff = flip(sources.staff.map(\.ref), pickedStaff)
        default: pickedVehicles = flip(sources.vehicles.map(\.ref), pickedVehicles)
        }
    }

    private func draft(category: String, name: String, description: String, unit: String, quantity: Double, unitPrice: Double,
                       ref: String, vat: Double) -> JSONValue {
        .object([
            "category": .string(category), "name": .string(name), "description": .string(description), "unit": .string(unit),
            "quantity": .number(quantity), "unitPrice": .number(unitPrice), "days": .number(1), "source": .string("offer"),
            "sourceRef": .string(ref), "vat": .number(vat), "power": .null, "weight": .null, "transportEstimate": .null,
        ])
    }

    /// `handleImport`: pozycje z zaznaczenia aktywnej zakładki (źródło `offer`).
    private func runImport() async {
        guard let sources, !importing else { return }
        var picked: [JSONValue] = []
        switch mode {
        case "products":
            for product in sources.products where pickedProducts.contains(product.ref) {
                picked.append(draft(category: categories[product.ref] ?? product.category, name: product.name, description: product.description,
                                    unit: product.unit.nonEmpty ?? "szt.", quantity: product.quantity, unitPrice: product.unitPrice, ref: product.ref, vat: product.vat))
            }
        case "contents":
            for row in sources.equipment where pickedEquipment.contains(row.ref) {
                let note: String = row.productName.isEmpty ? "" : "Z produktu: " + row.productName
                picked.append(draft(category: "equipment", name: row.name, description: note, unit: row.isKit ? "zest." : "szt.",
                                    quantity: row.quantity, unitPrice: row.rentalPrice, ref: row.ref, vat: 23))
            }
            for row in sources.staff where pickedStaff.contains(row.ref) {
                let total = row.hourlyRate * row.estimatedHours
                let note: String = row.productName.isEmpty ? "" : "Z produktu: " + row.productName
                picked.append(draft(category: "staff", name: row.role, description: note, unit: "os.", quantity: row.quantity,
                                    unitPrice: total > 0 ? total : row.hourlyRate, ref: row.ref, vat: 23))
            }
        default:
            for vehicle in sources.vehicles where pickedVehicles.contains(vehicle.ref) {
                let driver: String = vehicle.driverName.map { " — kierowca: " + $0 } ?? ""
                picked.append(draft(category: "transport", name: vehicle.vehicleName, description: vehicle.role + driver, unit: "kurs", quantity: 1,
                                    unitPrice: (vehicle.fuelCost ?? 0) + (vehicle.tollCost ?? 0), ref: vehicle.ref, vat: 23))
            }
        }
        guard !picked.isEmpty else { return }
        importing = true
        defer { importing = false }
        if await onImport(picked) { dismiss() }
    }
}
