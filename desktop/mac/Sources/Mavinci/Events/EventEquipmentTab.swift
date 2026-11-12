import SwiftUI
import AppKit

// MARK: Sprzęt (1:1 z `EventEquipmentTab`): lista sprzętu wydarzenia w sekcjach (pojedynczy, zestawy, przewody; dodane ręcznie
// i z oferty), dostępność w terminie, edycja ilości, usuwanie/przywracanie, wynajem i zamiana na alternatywę, komponenty,
// kolejka weryfikacji zestawów, import z kalkulacji z brakami, checklista etapów, notatki i checklista PDF (drukowana na Macu).

private struct AlternativesRequest: Identifiable {
    let id = UUID()
    var rowID: String?
    var equipmentID: String?
    var categoryID: String?
    var oldName: String
    var deficit: Int?
    var conflictIndex: Int?
    var quantity: Int
}

private struct RentalRequest: Identifiable {
    let id = UUID()
    var rowID: String?
    var name: String
    var categoryID: String?
    var quantity: Int
    var conflictIndex: Int?
}

private struct ComponentsRequest: Identifiable {
    var id: String { equipmentID + (reviewID ?? "") }
    var equipmentID: String
    var offerID: String?
    var reviewID: String?
}

@MainActor struct EventEquipmentTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var expanded: Set<String> = []
    @State private var selection: Set<String> = []
    @State private var anchor: String?
    @FocusState private var listFocused: Bool
    @State private var addOpen = false
    @State private var managerFocus: String?
    @State private var replacingExternal: Int?
    @State private var resolvedExternal: Set<Int> = []
    @State private var importConflicts: [EquipmentImportResult.Conflict] = []
    @State private var resolvedConflicts: Set<Int> = []
    @State private var importing = false
    @State private var generating = false
    @State private var notesDirty = false
    @State private var localModified = false
    @State private var stagePick: EquipmentStage?
    @State private var alternatives: AlternativesRequest?
    @State private var rental: RentalRequest?
    @State private var components: ComponentsRequest?
    @State private var preview: NativePreview?
    @State private var autoOpened: Set<String> = []

    private var data: EquipmentTabData? { store.tab(eventID, "equipment", as: EquipmentTabData.self) }
    private var editor: EquipmentEditor { store.equipmentEditor(eventID) }
    private var checklistTab: EquipmentChecklistTab? { store.tab(eventID, "equipment-checklist", as: EquipmentChecklistTab.self) }
    private var checklist: EquipmentChecklist? { checklistTab?.checklist }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|equipment"] {
                ContentUnavailableView {
                    Label("Nie udało się wczytać sprzętu", systemImage: "shippingbox")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await reload() } } }
            } else {
                ProgressView("Ładowanie sprzętu…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await reload() }
        // Katalog „Dodaj sprzęt” odświeżany w tle (tylko zmienione koszyki), żeby okno dodawania otwierało się od razu z dysku.
        .task(id: eventID) { await store.syncEquipmentCatalog(eventID) }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await reload() } }
        .onChange(of: checklist?.stage) { old, new in
            if old != nil, new != nil, old != new { stagePick = nil }
        }
        .task(id: reviewSignature) { await finishEmptyReview() }
        .sheet(isPresented: $addOpen, onDismiss: { replacingExternal = nil; managerFocus = nil }) {
            EquipmentManagerSheet(store: store, editor: editor, eventID: eventID, focus: managerFocus, shownReviews: $autoOpened) { added in
                if added, let index = replacingExternal { resolvedExternal.insert(index) }
                replacingExternal = nil
            }
            .warehouseSheetStyle(state)
        }
        .sheet(item: $alternatives) { request in
            EquipmentAlternativesSheet(store: store, eventID: eventID, rowID: request.rowID, equipmentID: request.equipmentID,
                                       categoryID: request.categoryID, oldName: request.oldName, deficit: request.deficit,
                                       initialQuantity: request.quantity) {
                if let index = request.conflictIndex { resolvedConflicts.insert(index) }
            }
            .warehouseSheetStyle(state)
        }
        .sheet(item: $rental) { request in
            EquipmentRentalSheet(store: store, eventID: eventID, rowID: request.rowID, currentName: request.name, categoryID: request.categoryID,
                                 quantity: request.quantity) {
                if let index = request.conflictIndex { resolvedConflicts.insert(index) }
            }
            .warehouseSheetStyle(state)
        }
        .sheet(item: $components) { request in
            EquipmentComponentsSheet(store: store, eventID: eventID, equipmentID: request.equipmentID, offerID: request.offerID, reviewID: request.reviewID)
                .warehouseSheetStyle(state)
        }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
    }

    private func reload() async {
        await store.loadTab(eventID, "equipment-checklist")
        await store.loadTab(eventID, "equipment")
    }

    // MARK: Checklista etapów

    private func currentStage(_ c: EquipmentChecklist?) -> EquipmentStage? {
        guard let c, c.stage != "empty" else { return nil }
        return stagePick ?? EquipmentRules.defaultStage(c)
    }
    private var checklistLocked: Bool { checklist?.dispatch.confirmed_at != nil }
    private var showLegacyLoaded: Bool { checklist == nil && (checklistTab?.status == "missing" || checklistTab?.status == "error") }

    private func rowChecklist(_ row: EquipmentTabData.Row, _ lines: [String: EquipmentChecklist.Line]) -> EquipmentRowChecklist? {
        guard let c = checklist, let stage = currentStage(c), let line = lines[row.id] else { return nil }
        if stage != .dispatch && line.shipped_qty <= 0 { return nil }
        let editable = stage == .dispatch ? c.can.pack : stage == .loadback ? c.can.loadback : c.can.returning
        return EquipmentRowChecklist(line: line, stage: stage, editable: editable, busy: store.checklistBusy.contains("line:\(line.id)"), people: c.people)
    }

    // MARK: Widok

    private func content(_ data: EquipmentTabData) -> some View {
        let stage = currentStage(checklist)
        let lines = Dictionary((checklist?.lines ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let shippedOnly = stage == .loadback || stage == .giveBack
        let stageRows = shippedOnly ? data.rows.filter { (lines[$0.id]?.shipped_qty ?? 0) > 0 } : data.rows
        let visible = filtered(stageRows)
        let notShipped = shippedOnly ? (checklist?.lines ?? []).filter { $0.shipped_qty <= 0 }.count : 0
        let ordered = displayOrder(visible).map(\.id)
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header(data)
                EventArrangementsBanner(store: store, eventID: eventID, area: .equipment)
                if data.event.hasShortage && data.hasUnresolvedConflicts { shortageBanner(data) }
                if let review = data.reviews.first { reviewQueue(data, review) }
                if !data.external.isEmpty { externalCard(data) }
                if !importConflicts.isEmpty { conflictsCard }
                EquipmentChecklistBar(store: store, eventID: eventID, tab: checklistTab, stage: stage, pick: $stagePick,
                                      legacy: (data.rows.filter(\.loaded).count, data.rows.count, data.event.loadingConfirmed, data.event.loadingConfirmedAt))
                if data.rows.isEmpty {
                    Text("Brak przypisanego sprzętu").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 30)
                } else {
                    if shippedOnly {
                        Text("Pokazano \(stageRows.count) wydanych pozycji · \(notShipped) nie wydano").font(.callout).foregroundStyle(.secondary)
                    }
                    if !search.trimmingCharacters(in: .whitespaces).isEmpty {
                        Text(visible.isEmpty ? "Brak sprzętu pasującego do wyszukiwania." : "Znaleziono pozycji: \(visible.count) z \(stageRows.count)")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    sections(data, visible, lines, ordered)
                }
                EquipmentChecklistNotesView(store: store, eventID: eventID, notes: data.notes, dirty: $notesDirty) { localModified = true }
            }
            .padding(18)
        }
        // Zaznaczanie jak w Finderze: klik, ⌘-klik, ⇧-klik; ⌫ usuwa zaznaczone (z „Cofnij”), Esc czyści zaznaczenie, ⌘A — wszystko.
        .focusable()
        .focused($listFocused)
        .focusEffectDisabled()
        .onDeleteCommand { deleteSelected() }
        .onExitCommand { selection = [] }
        .onCommand(#selector(NSResponder.selectAll(_:))) { selection = Set(ordered) }
    }

    /// Kolejność wierszy na ekranie (sekcje i grupy jak w `sections`) — dla zaznaczania zakresu ⇧-klikiem.
    private func displayOrder(_ rows: [EquipmentTabData.Row]) -> [EquipmentTabData.Row] {
        let groups = [rows.filter { !$0.isKit && !$0.isCable }, rows.filter(\.isKit), rows.filter(\.isCable)]
        return groups.flatMap { group in group.filter { !$0.autoAdded } + group.filter(\.autoAdded) }
    }

    /// Wyszukiwanie po nazwie, marce, modelu i zawartości zestawu (każde słowo musi wystąpić).
    private func filtered(_ rows: [EquipmentTabData.Row]) -> [EquipmentTabData.Row] {
        let terms = EquipmentSearch.normalize(search).split(separator: " ").map { String($0) }.filter { !$0.isEmpty }
        if terms.isEmpty { return rows }
        return rows.filter { row in
            let text = row.searchText
            return terms.allSatisfy { text.contains($0) }
        }
    }

    private func header(_ data: EquipmentTabData) -> some View {
        let modified = data.event.checklistModified || localModified
        let hasPdf = data.event.checklistPdfPath != nil
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sprzęt").font(.title2.weight(.light))
                Text("Event Zawiera \(data.rows.count) Pozycji").font(.caption).foregroundStyle(.secondary)
            }
            TextField("Szukaj sprzętu: nazwa, model, producent…", text: $search)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 340)
            Spacer(minLength: 8)
            if !checklistLocked {
                Button { addOpen = true } label: { Label("Zarządzaj sprzętem", systemImage: "plus.forwardslash.minus") }
                    .buttonStyle(.borderedProminent)
                    .help("Dodawanie, zmiana ilości i usuwanie sprzętu w jednym oknie (z dostępnością w terminie)")
            }
            if data.calculationId != nil && !checklistLocked {
                Button { Task { await importCalculation() } } label: { Label(importing ? "Importowanie..." : "Importuj z kalkulacji", systemImage: "function") }
                    .disabled(importing)
            }
            if !hasPdf || modified {
                Button { Task { await generate(data) } } label: {
                    Label(generating ? "Generowanie..." : modified ? "Regeneruj checklistę" : "Generuj checklistę", systemImage: "printer")
                }
                .disabled(generating)
            } else {
                Menu {
                    Button("Regeneruj checklistę", systemImage: "printer") { Task { await generate(data) } }.disabled(generating)
                    Button("Pokaż checklistę", systemImage: "eye") { Task { await showChecklist() } }
                    Button("Pobierz checklistę", systemImage: "arrow.down.circle") { Task { await downloadChecklist() } }
                } label: { Label(generating ? "Generowanie..." : "Checklista PDF", systemImage: "printer") }
                    .fixedSize()
            }
        }
        .controlSize(.regular)
    }

    private func shortageBanner(_ data: EquipmentTabData) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.title3)
            VStack(alignment: .leading, spacing: 4) {
                Text("Braki sprzętowe").font(.headline)
                Text("Event ma braki sprzętowe w terminie. Część sprzętu z oferty nie została dodana do eventu, ponieważ nie jest dostępna.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Rozwiąż konflikty") {
                if let id = data.latestOfferId { state.openCRM("/crm/offers/\(id)") } else { state.error = "Brak ofert dla tego eventu" }
            }
            .buttonStyle(.borderedProminent).tint(.red)
        }
        .padding(14).background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
    }

    private func reviewQueue(_ data: EquipmentTabData, _ review: EquipmentTabData.Review) -> some View {
        let entry = data.components[review.equipmentId]
        let groups = entry?.groups ?? []
        let missing = groups.reduce(0) { $0 + ($1.name != nil ? 1 : $1.components.count) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "shippingbox").foregroundStyle(theme.accent).font(.title3)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Kolejka weryfikacji zestawów (\(data.reviews.count))").font(.headline)
                    Text("Sprawdź elementy wymagane, rekomendowane i opcjonalne oraz ich dostępność przed zamknięciem listy sprzętu.")
                        .font(.callout).foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 8) {
                Text(review.name).font(.callout.weight(.medium))
                Text(review.source == "manual" ? "Dodano ręcznie" : "Import").font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.primary.opacity(0.08), in: Capsule())
                Spacer()
                if !groups.isEmpty {
                    Text("\(missing) \(missing == 1 ? "komponent wymaga" : "komponentów wymaga") weryfikacji").font(.caption).foregroundStyle(.orange)
                    Button("Zobacz komponenty i dodaj") { components = ComponentsRequest(equipmentID: review.equipmentId, offerID: nil, reviewID: review.id) }
                        .buttonStyle(.borderedProminent).controlSize(.small)
                }
            }
            .padding(10).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
        }
        .padding(14).background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .task(id: review.id + (addOpen ? "|manager" : "")) {
            // „Dodano ręcznie” otwiera okno komponentów od razu (`autoOpen`); przy otwartym oknie sprzętu robi to ono (nad nim).
            if !addOpen, review.source == "manual", !groups.isEmpty, !autoOpened.contains(review.id) {
                autoOpened.insert(review.id)
                components = ComponentsRequest(equipmentID: review.equipmentId, offerID: nil, reviewID: review.id)
            }
        }
    }

    /// Pierwsza pozycja kolejki bez brakujących komponentów zamyka się sama (`onReviewFinished` z `checkRequiredComponents`).
    private var reviewSignature: String {
        guard let data, let review = data.reviews.first else { return "" }
        let entry = data.components[review.equipmentId]
        return "\(review.id)|\(entry?.groups.count ?? -1)|\(entry?.defined == true)"
    }
    private func finishEmptyReview() async {
        guard let data, let review = data.reviews.first, let entry = data.components[review.equipmentId], entry.groups.isEmpty else { return }
        _ = try? await store.tabAction(eventID, "equipment", "review", ["reviewId": .string(review.id), "status": .string(entry.defined ? "reviewed" : "not_applicable")],
                                       reload: ["equipment"], success: nil, pending: "Weryfikacja zestawu…")
    }

    private func externalCard(_ data: EquipmentTabData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.down.doc").foregroundStyle(.orange)
                Text("Elementy spoza magazynu (z kalkulacji)").font(.headline)
                if !resolvedExternal.isEmpty {
                    Text("(\(resolvedExternal.count)/\(data.external.count) rozwiązane)").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text("Poniższe pozycje z zaakceptowanej kalkulacji nie pochodzą z magazynu. Zamień na sprzęt z magazynu lub oznacz jako uwagę w checkliście.")
                .font(.callout).foregroundStyle(.secondary)
            ForEach(Array(data.external.enumerated()), id: \.offset) { item in
                externalRow(item.offset, item.element)
            }
        }
        .padding(14).background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private func externalRow(_ index: Int, _ item: EquipmentTabData.External) -> some View {
        let resolved = resolvedExternal.contains(index)
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.name ?? "Pozycja").font(.callout).strikethrough(resolved).foregroundStyle(resolved ? Color.secondary : Color.primary)
                if !item.description.isEmpty { Text(item.description).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Text("\(EquipmentQty.text(item.quantity)) \(item.unit)").font(.callout.monospacedDigit()).foregroundStyle(.secondary)
            if resolved {
                Image(systemName: "checkmark").foregroundStyle(.green)
            } else {
                Button("Zamień na magazyn") { replacingExternal = index; addOpen = true }.buttonStyle(.borderedProminent)
                Button("Dodaj do uwag") {
                    resolvedExternal.insert(index)
                    state.snack = Snack(kind: .info, text: "Pozycja zostanie dodana do uwag w checkliście")
                }
            }
        }
        .controlSize(.small)
        .padding(8).background(resolved ? Color.green.opacity(0.07) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private var conflictsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
                Text("Braki magazynowe (z importu kalkulacji)").font(.headline)
                if !resolvedConflicts.isEmpty {
                    Text("(\(resolvedConflicts.count)/\(importConflicts.count) rozwiązane)").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text("Poniższe pozycje z kalkulacji przekraczają dostępny stan magazynowy w wybranym terminie. Zaimportowano maksymalną dostępną ilość.")
                .font(.callout).foregroundStyle(.secondary)
            ForEach(Array(importConflicts.enumerated()), id: \.offset) { item in
                conflictRow(item.offset, item.element)
            }
        }
        .padding(14).background(Color.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }

    private func conflictRow(_ index: Int, _ conflict: EquipmentImportResult.Conflict) -> some View {
        let resolved = resolvedConflicts.contains(index)
        let deficit = Int(conflict.quantity - conflict.available)
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(conflict.name).font(.callout).strikethrough(resolved).foregroundStyle(resolved ? Color.secondary : Color.primary)
                if !resolved {
                    Text("brakuje \(deficit) szt. (potrzeba: \(Int(conflict.quantity)), dostępne: \(Int(conflict.available)))").font(.caption).foregroundStyle(.red)
                }
            }
            Spacer()
            if resolved {
                Image(systemName: "checkmark").foregroundStyle(.green)
            } else {
                Button("Szukaj alternatywy") { alternativeForConflict(index, conflict) }.buttonStyle(.borderedProminent)
                Button("Oznacz jako rental") {
                    rental = RentalRequest(rowID: nil, name: conflict.name, categoryID: nil, quantity: Int(conflict.quantity), conflictIndex: index)
                }
                Button("Zamknij") {
                    resolvedConflicts.insert(index)
                    state.snack = Snack(kind: .info, text: "Konflikt oznaczony jako rozwiązany")
                }
            }
        }
        .controlSize(.small)
        .padding(8).background(resolved ? Color.green.opacity(0.07) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func alternativeForConflict(_ index: Int, _ conflict: EquipmentImportResult.Conflict) {
        if conflict.type == "kit" {
            state.snack = Snack(kind: .info, text: "Alternatywy dla zestawów nie są jeszcze obsługiwane")
            return
        }
        let deficit = max(1, Int(conflict.quantity - conflict.available))
        alternatives = AlternativesRequest(rowID: nil, equipmentID: conflict.equipmentId, categoryID: nil, oldName: conflict.name, deficit: deficit,
                                           conflictIndex: index, quantity: deficit)
    }

    // MARK: Sekcje listy

    @ViewBuilder private func sections(_ data: EquipmentTabData, _ rows: [EquipmentTabData.Row], _ lines: [String: EquipmentChecklist.Line], _ ordered: [String]) -> some View {
        let items = rows.filter { !$0.isKit && !$0.isCable }
        let kits = rows.filter(\.isKit)
        let cables = rows.filter(\.isCable)
        if !items.isEmpty {
            section("Pojedynczy sprzęt", "Samodzielne urządzenia rezerwowane na wydarzenie", items, data, lines, ordered)
        }
        if !kits.isEmpty {
            section("Zestawy sprzętowe", "Gotowe komplety z możliwością rozwinięcia zawartości", kits, data, lines, ordered)
        }
        if !cables.isEmpty {
            section("Przewody i okablowanie", "Pozycje magazynowe rozliczane w sztukach lub metrach", cables, data, lines, ordered)
        }
    }

    private func section(_ title: String, _ subtitle: String, _ rows: [EquipmentTabData.Row], _ data: EquipmentTabData,
                         _ lines: [String: EquipmentChecklist.Line], _ ordered: [String]) -> some View {
        let manual = rows.filter { !$0.autoAdded }
        let auto = rows.filter(\.autoAdded)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(rows.count)").font(.callout.monospacedDigit()).padding(.horizontal, 8).padding(.vertical, 2)
                    .background(theme.accent.opacity(0.15), in: Capsule())
            }
            if !manual.isEmpty { group("Dodane bezpośrednio", manual, data, lines, ordered) }
            if !auto.isEmpty { group("Z oferty / importu", auto, data, lines, ordered) }
        }
    }

    private func group(_ title: String, _ rows: [EquipmentTabData.Row], _ data: EquipmentTabData, _ lines: [String: EquipmentChecklist.Line],
                       _ ordered: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).padding(.bottom, 2)
            ForEach(rows) { row in
                EquipmentRowView(store: store, eventID: eventID, row: row, data: data, editable: !checklistLocked,
                                 checklist: rowChecklist(row, lines), legacyLoaded: showLegacyLoaded,
                                 expanded: expanded.contains(row.id), editor: editor, selected: selection.contains(row.id),
                                 selectionCount: selection.contains(row.id) ? selection.count : 0, actions: actions(for: row, ordered))
            }
        }
    }

    private func actions(for row: EquipmentTabData.Row, _ ordered: [String]) -> EquipmentRowActions {
        EquipmentRowActions(
            toggleExpand: { if expanded.contains(row.id) { expanded.remove(row.id) } else { expanded.insert(row.id) } },
            select: { select(row, ordered) },
            setQuantity: { qty in setQuantity(row, qty) },
            stageQuantity: { qty in
                // − / + i wpisana liczba czekają na ✓; pozycja występująca kilka razy — zapis tej jednej od razu.
                let duplicates = (data?.rows ?? []).filter { $0.key != nil && $0.key == row.key && !$0.removed }.count > 1
                if !duplicates, let target = target(for: row) { editor.stage(target, to: qty) } else { setQuantity(row, qty) }
            },
            confirmQuantity: { if let key = row.key { editor.confirm(key) } },
            cancelQuantity: { if let key = row.key { editor.discard(key) } },
            removeSelection: { deleteSelected() },
            remove: { delete([row]) },
            reservations: {
                let kind: String? = row.isKit ? "kit" : (row.isCable ? nil : "item")
                let id: String? = row.isKit ? row.kitId : row.equipmentId
                if let kind, let id {
                    managerFocus = kind + ":" + id
                    addOpen = true
                }
            },
            restore: { Task { await restore(row) } },
            rental: { rental = RentalRequest(rowID: row.id, name: row.name, categoryID: row.warehouseCategoryId, quantity: row.qty, conflictIndex: nil) },
            alternative: { suggestAlternative(row) },
            toggleExpandInChecklist: { expand in Task { await toggleExpandInChecklist(row, expand) } },
            openDetail: {
                if row.isCable, let id = row.cableId { state.showCable(id) } else if let id = row.equipmentId { state.showEquipment(id) }
            },
            components: { if let id = row.equipmentId { components = ComponentsRequest(equipmentID: id, offerID: row.offerId, reviewID: nil) } }
        )
    }

    // MARK: Czynności

    private func run(_ action: String, _ body: [String: JSONValue], success: String?, pending: String = "Zapisywanie…") async -> Data? {
        do {
            let reply = try await store.tabAction(eventID, "equipment", action, body, reload: ["equipment", "equipment-checklist"], success: success, pending: pending)
            localModified = true
            return reply
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać zmian.")
            return nil
        }
    }

    private func updateQuantity(_ row: EquipmentTabData.Row, _ qty: Int, _ maxSet: Int) async {
        guard qty >= 1, qty <= maxSet else {
            state.error = "Maksymalnie możesz ustawić: \(maxSet) szt."
            return
        }
        _ = await run("quantity", ["rowId": .string(row.id), "quantity": .number(Double(qty))], success: "Zaktualizowano")
    }

    // MARK: Zaznaczanie, ilość i usuwanie z „Cofnij” (wspólny zapis z oknem „Zarządzaj sprzętem”)

    private func select(_ row: EquipmentTabData.Row, _ ordered: [String]) {
        let flags = NSEvent.modifierFlags
        if flags.contains(.command) {
            if selection.contains(row.id) { selection.remove(row.id) } else { selection.insert(row.id) }
            anchor = row.id
        } else if flags.contains(.shift), let anchor, let from = ordered.firstIndex(of: anchor), let to = ordered.firstIndex(of: row.id) {
            selection = Set(ordered[min(from, to)...max(from, to)])
        } else {
            selection = [row.id]
            anchor = row.id
        }
        listFocused = true
    }

    private func target(for row: EquipmentTabData.Row) -> EquipmentEditor.Target? {
        let kind = row.isKit ? "kit" : row.isCable ? "cable" : "item"
        guard let id = row.isKit ? row.kitId : row.isCable ? row.cableId : row.equipmentId else { return nil }
        let target = EquipmentEditor.Target(kind: kind, id: id, name: row.name)
        return row.key == target.key ? target : nil
    }

    /// Ilość z − / + albo wpisana: zapis po krótkiej przerwie; pozycja występująca na liście kilka razy — zapis tej jednej pozycji.
    private func setQuantity(_ row: EquipmentTabData.Row, _ qty: Int) {
        guard let data else { return }
        let duplicates = data.rows.filter { $0.key != nil && $0.key == row.key && !$0.removed }.count > 1
        if !duplicates, let target = target(for: row) {
            editor.set(target, to: qty)
        } else {
            Task { await updateQuantity(row, qty, data.limits(row).maxSet) }
        }
    }

    private func deleteSelected() {
        guard !checklistLocked, let data else { return }
        delete(data.rows.filter { selection.contains($0.id) && !$0.removed })
    }

    /// Usunięcie od razu, bez pytania — komunikat na dole ma „Cofnij” (pozycja z oferty wraca przez przywrócenie, ręczna — dodaniem).
    private func delete(_ rows: [EquipmentTabData.Row]) {
        guard !rows.isEmpty else { return }
        var targets: [EquipmentEditor.Target] = []
        for row in rows {
            if let target = target(for: row) {
                if !targets.contains(target) { targets.append(target) }
            } else {
                Task { await remove(row) }
            }
        }
        if !targets.isEmpty { editor.remove(targets) }
        selection.subtract(rows.map(\.id))
    }

    private func remove(_ row: EquipmentTabData.Row) async {
        guard let reply = await run("remove", ["rowId": .string(row.id)], success: nil, pending: "Usuwanie…") else { return }
        struct Reply: Decodable { var message: String? }
        state.succeed((try? JSONDecoder().decode(Reply.self, from: reply))?.message ?? "Usunięto")
    }

    private func restore(_ row: EquipmentTabData.Row) async {
        _ = await run("restore", ["rowId": .string(row.id)], success: "Zaktualizowano")
    }

    private func toggleExpandInChecklist(_ row: EquipmentTabData.Row, _ expand: Bool) async {
        _ = await run("expand", ["rowId": .string(row.id), "expand": .bool(expand)], success: "Zaktualizowano")
    }

    private func suggestAlternative(_ row: EquipmentTabData.Row) {
        if row.isKit {
            state.snack = Snack(kind: .info, text: "Alternatywy dla zestawów nie są jeszcze obsługiwane")
            return
        }
        alternatives = AlternativesRequest(rowID: row.id, equipmentID: row.equipmentId, categoryID: row.warehouseCategoryId, oldName: row.name,
                                           deficit: nil, conflictIndex: nil, quantity: max(1, row.qty))
    }

    private func importCalculation() async {
        guard !importing else { return }
        importing = true
        defer { importing = false }
        guard let reply = await run("importCalculation", [:], success: nil, pending: "Importowanie z kalkulacji…"),
              let result = try? JSONDecoder().decode(EquipmentImportResult.self, from: reply) else { return }
        if !result.conflicts.isEmpty {
            importConflicts = result.conflicts
            resolvedConflicts = []
        }
        if result.level == "success" { state.succeed(result.message) } else { state.snack = Snack(kind: .info, text: result.message) }
    }

    /// „Generuj / Regeneruj checklistę”: PDF drukowany na Macu (Chrome) albo przez serwer, zapisany w Plikach wydarzenia.
    private func generate(_ data: EquipmentTabData) async {
        if notesDirty {
            state.snack = Snack(kind: .info, text: "Zapisz notatki przed wygenerowaniem checklisty.")
            return
        }
        guard !generating else { return }
        if data.rows.isEmpty {
            state.error = "Brak sprzętu do wygenerowania checklisty"
            return
        }
        generating = true
        defer { generating = false }
        let resolved = resolvedExternal.sorted().map { String($0) }.joined(separator: ",")
        await state.withPending(ChromePdfEngine.available ? "Generowanie checklisty…" : "Pobieranie checklisty…") {
            do {
                let url = try await state.printDocument(path: "/bridge/events/\(eventID)/equipment-checklist",
                                                        query: resolved.isEmpty ? [:] : ["resolved": resolved],
                                                        fallbackName: "checklista-sprzetu.pdf")
                localModified = false
                state.succeed("Checklista sprzętu została wygenerowana i zapisana w zakładce Pliki")
                preview = NativePreview(name: url.lastPathComponent, data: try Data(contentsOf: url))
            } catch {
                state.error = store.failureText(error, "Błąd podczas generowania checklisty")
            }
        }
        await store.loadTab(eventID, "equipment")
    }

    private struct ChecklistFile: Decodable { var url: String; var name: String }

    private func showChecklist() async {
        await state.withPending("Otwieranie checklisty…") {
            do {
                let file = try await store.tabQuery(eventID, "equipment", "checklistPdf", as: ChecklistFile.self)
                guard let url = URL(string: file.url) else { throw AppError.invalidResponse }
                let (data, _) = try await URLSession.shared.data(from: url)
                preview = NativePreview(name: file.name, data: data)
            } catch {
                state.error = store.failureText(error, "Błąd podczas otwierania PDF")
            }
        }
    }

    private func downloadChecklist() async {
        await state.withPending("Pobieranie…") {
            do {
                let file = try await store.tabQuery(eventID, "equipment", "checklistPdf", as: ChecklistFile.self)
                guard let remote = URL(string: file.url) else { throw AppError.invalidResponse }
                let (temporary, _) = try await URLSession.shared.download(from: remote)
                let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
                let base = (file.name as NSString).deletingPathExtension, ext = (file.name as NSString).pathExtension
                var target = folder.appendingPathComponent(file.name)
                var copy = 1
                while FileManager.default.fileExists(atPath: target.path) {
                    target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(copy))" : "\(base) (\(copy)).\(ext)")
                    copy += 1
                }
                try FileManager.default.moveItem(at: temporary, to: target)
                NSWorkspace.shared.activateFileViewerSelecting([target])
                state.succeed("Pobrano: \(target.lastPathComponent)")
            } catch {
                state.error = store.failureText(error, "Błąd podczas pobierania PDF")
            }
        }
    }
}

enum EquipmentQty {
    static func text(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
    }
}

// MARK: Wiersz sprzętu (`EventEquipmentRow` i `renderKitRow`)

struct EquipmentRowActions {
    var toggleExpand: () -> Void
    var select: () -> Void
    var setQuantity: (Int) -> Void
    var stageQuantity: (Int) -> Void
    var confirmQuantity: () -> Void
    var cancelQuantity: () -> Void
    var removeSelection: () -> Void
    var remove: () -> Void
    var reservations: () -> Void
    var restore: () -> Void
    var rental: () -> Void
    var alternative: () -> Void
    var toggleExpandInChecklist: (Bool) -> Void
    var openDetail: () -> Void
    var components: () -> Void
}

@MainActor struct EquipmentRowView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let row: EquipmentTabData.Row
    let data: EquipmentTabData
    let editable: Bool
    let checklist: EquipmentRowChecklist?
    let legacyLoaded: Bool
    let expanded: Bool
    @ObservedObject var editor: EquipmentEditor
    let selected: Bool
    let selectionCount: Int
    let actions: EquipmentRowActions
    @Environment(\.crmTheme) private var theme
    @State private var previewShown = false

    private var limits: EquipmentLimits { data.limits(row) }
    private var conflict: Bool { (row.key.flatMap { data.availability[$0] }?.maxAdd ?? 0) < 0 }
    private var badge: (label: String, color: Color) { EquipmentStatusBadge.badge(row.status, conflict: conflict) }
    private var done: Bool { checklist?.done == true }

    private var tint: Color {
        if selected { return theme.accent.opacity(0.2) }
        if let checklist { return checklist.tint ?? Color.primary.opacity(0.04) }
        if legacyLoaded && row.loaded { return Color.green.opacity(0.08) }
        if conflict || row.optional { return Color.red.opacity(0.07) }
        return Color.primary.opacity(0.04)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                if let checklist { EquipmentRowTick(store: store, eventID: eventID, context: checklist) }
                if row.isKit {
                    Button { actions.toggleExpand() } label: { Image(systemName: expanded ? "chevron.up" : "chevron.down").frame(width: 14) }
                        .buttonStyle(.plain).foregroundStyle(.secondary).help("Rozwiń zestaw")
                }
                thumbnail
                info.frame(maxWidth: .infinity, alignment: .leading)
                if row.removed {
                    Text("USUNIĘTE Z OFERTY").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(Color.orange.opacity(0.14), in: Capsule())
                }
                trailing
                rowActions
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(tint, in: RoundedRectangle(cornerRadius: 7))
            .opacity(row.removed ? 0.55 : 1)
            .contentShape(Rectangle())
            .onTapGesture { actions.select() }
            .contextMenu { menuItems }
            if !row.isKit, let id = row.equipmentId, let entry = data.components[id], !entry.groups.isEmpty {
                componentsWarning(entry)
            }
            if row.isKit && expanded { kitContents }
        }
    }

    /// Miniatura — kliknięcie otwiera podgląd (powiększone zdjęcie i szczegóły pozycji) w natywnym okienku.
    private var thumbnail: some View {
        Button { previewShown.toggle() } label: {
            ZStack(alignment: .topTrailing) {
                WarehouseThumb(url: row.thumbnail, size: 32, symbol: row.isKit ? "shippingbox.fill" : row.isCable ? "cable.connector" : "shippingbox")
                if row.isKit {
                    Image(systemName: "shippingbox.fill").font(.system(size: 7)).foregroundStyle(.black)
                        .frame(width: 13, height: 13).background(theme.accent, in: Circle()).offset(x: 4, y: -4)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Podgląd: zdjęcie i szczegóły")
        .popover(isPresented: $previewShown, arrowEdge: .trailing) { previewCard }
    }

    private var previewCard: some View {
        var open: (() -> Void)? = nil
        if !row.isKit && (row.equipmentId != nil || row.cableId != nil) {
            open = {
                previewShown = false
                actions.openDetail()
            }
        }
        return EquipmentPreviewCard(row: row, limits: limits, status: badge, editable: editable, openDetail: open)
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                nameView
                EventDotLabel(label: badge.label, color: badge.color, size: 6).font(.caption).foregroundStyle(.secondary)
                if !row.isKit {
                    Text(row.fromOffer ? "Z oferty / importu" : "Dodane ręcznie").font(.caption2).foregroundStyle(.secondary)
                }
                if row.optional && !row.isKit {
                    Text("BRAK").font(.caption2.weight(.bold)).foregroundStyle(.red)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(Color.red.opacity(0.14), in: Capsule())
                }
                if let checklist {
                    EquipmentRowBadges(context: checklist)
                } else if legacyLoaded && row.loaded {
                    HStack(spacing: 4) {
                        if let by = row.loadedBy { EmployeeAvatarView(name: by.name, url: by.avatarUrl, crop: nil, size: 14) }
                        Text("ZAŁADOWANY").font(.caption2.weight(.semibold))
                    }
                    .foregroundStyle(.green).padding(.horizontal, 6).padding(.vertical, 2).background(Color.green.opacity(0.14), in: Capsule())
                }
            }
            subtitle
            if row.isKit && editable {
                Text("możesz dodać jeszcze \(limits.maxAdd) • max ustawienia \(limits.maxSet)").font(.caption).foregroundStyle(.secondary)
            }
            if let checklist { EquipmentRowNote(context: checklist, photoBase: data.photoBase) }
        }
    }

    @ViewBuilder private var nameView: some View {
        let font = Font.callout.weight(.medium)
        if !row.isKit && (row.equipmentId != nil || row.cableId != nil) {
            Button { actions.openDetail() } label: {
                Text(row.name).font(font).strikethrough(done).foregroundStyle(done ? Color.secondary : Color.primary).lineLimit(1)
            }
            .buttonStyle(.plain).help("Otwórz szczegóły sprzętu")
        } else {
            Text(row.name).font(font).strikethrough(done).foregroundStyle(done ? Color.secondary : Color.primary).lineLimit(1)
        }
    }

    @ViewBuilder private var subtitle: some View {
        if !row.isKit && !row.isCable && (!row.brand.isEmpty || !row.model.isEmpty) {
            Text([row.brand, row.model].filter { !$0.isEmpty }.joined(separator: " • ")).font(.caption).foregroundStyle(.secondary)
        } else if row.isCable {
            let length = row.cableLength.map { " • " + EquipmentQty.text($0) + " m" } ?? ""
            Text("Przewód" + length).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var trailing: some View {
        HStack(spacing: 12) {
            if !row.isKit && !row.isCable && !row.category.isEmpty {
                Text(row.category).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if !row.isKit && row.key != nil && editable {
                VStack(alignment: .trailing, spacing: 1) {
                    Text("\(limits.maxAdd) dostępne do dodania").font(.caption).foregroundStyle(theme.accent)
                    Text("max: \(limits.maxSet) • zarezerw.: \(limits.reserved) • magazyn: \(limits.total)").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let checklist { EquipmentRowQtyChip(store: store, eventID: eventID, context: checklist, photoBase: data.photoBase) }
            quantity
        }
    }

    @ViewBuilder private var quantity: some View {
        let unit = row.isKit ? "szt." : row.unit
        if editable && !row.removed && row.key != nil {
            EquipmentStepper(value: row.key.flatMap { editor.drafts[$0] } ?? row.qty, pending: row.key.flatMap { editor.pending[$0] },
                             lower: 1, upper: max(1, limits.maxSet), unit: unit,
                             saving: row.key.map { editor.saving.contains($0) } ?? false,
                             confirm: actions.confirmQuantity, cancel: actions.cancelQuantity) { actions.stageQuantity($0) }
        } else {
            (Text("\(row.qty) ").font(.callout.weight(.semibold).monospacedDigit()) + Text(unit).font(.caption).foregroundColor(.secondary))
        }
    }

    /// Pozycje wymagające decyzji (brak, konflikt, wynajem) mają przyciski na wierzchu; pozostałe czynności — w menu „…” i pod prawym przyciskiem.
    @ViewBuilder private var rowActions: some View {
        HStack(spacing: 4) {
            if (conflict || row.optional || row.rental) && editable && !row.removed {
                Button("Usuń", role: .destructive) { actions.remove() }
                if !row.rental { Button("Rental") { actions.rental() } }
                if !row.isKit { Button("Zamień") { actions.alternative() }.buttonStyle(.borderedProminent) }
                if !row.isCable { Button("Kto ma?") { actions.reservations() }.help("Kto rezerwuje ten sprzęt w terminie — można zapytać, czy odstąpi") }
            } else if row.removed && editable {
                Button("Przywróć") { actions.restore() }.help("Przywróć z oferty")
            }
            Menu { menuItems } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Czynności")
        }
        .controlSize(.small)
    }

    @ViewBuilder private var menuItems: some View {
        if selectionCount > 1 && editable {
            Button("Usuń zaznaczone (\(selectionCount))", systemImage: "trash", role: .destructive) { actions.removeSelection() }
            Divider()
        }
        Button("Podgląd", systemImage: "eye") { previewShown = true }
        if !row.isKit && (row.equipmentId != nil || row.cableId != nil) {
            Button("Karta sprzętu", systemImage: "arrow.up.right.square") { actions.openDetail() }
        }
        if row.isKit {
            Button(expanded ? "Zwiń zawartość" : "Pokaż zawartość", systemImage: "list.bullet.indent") { actions.toggleExpand() }
            Button(row.expandInChecklist ? "Ukryj zawartość na checkliście" : "Drukuj zawartość na checkliście", systemImage: "printer") {
                actions.toggleExpandInChecklist(!row.expandInChecklist)
            }
        }
        if !row.isCable, (row.key.flatMap { data.availability[$0] }?.reserved ?? 0) > 0 {
            Button("Kto rezerwuje w tym terminie?", systemImage: "person.2") { actions.reservations() }
        }
        if editable && !row.removed {
            Divider()
            if !row.isKit && !row.isCable { Button("Zamień na inny sprzęt…", systemImage: "arrow.left.arrow.right") { actions.alternative() } }
            if !row.isKit && !row.rental { Button("Wynajem od podwykonawcy…", systemImage: "person.badge.shield.checkmark") { actions.rental() } }
            if !row.isKit, let id = row.equipmentId, data.components[id] != nil {
                Button("Komponenty…", systemImage: "puzzlepiece.extension") { actions.components() }
            }
            Divider()
            Button(row.autoAdded ? "Usuń z wydarzenia (z oferty)" : "Usuń z wydarzenia", systemImage: "trash", role: .destructive) { actions.remove() }
        }
        if editable && row.removed {
            Button("Przywróć z oferty", systemImage: "arrow.uturn.backward") { actions.restore() }
        }
    }

    private func componentsWarning(_ entry: EquipmentTabData.Components) -> some View {
        let total = entry.groups.reduce(0) { $0 + ($1.name != nil ? 1 : $1.components.count) }
        return HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 1) {
                Text("Ten sprzęt ma dodatkowe komponenty").font(.callout.weight(.medium))
                Text("\(total) \(total == 1 ? "komponent wymaga" : "komponentów wymaga") weryfikacji").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Zobacz komponenty i dodaj") { actions.components() }.controlSize(.small)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.orange.opacity(0.09), in: RoundedRectangle(cornerRadius: 8))
        .padding(.leading, 24)
    }

    private var kitContents: some View {
        VStack(alignment: .leading, spacing: 4) {
            if row.kitItems.isEmpty {
                Text("Brak danych o zawartości zestawu.").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(Array(row.kitItems.enumerated()), id: \.offset) { item in
                    kitItemRow(item.element)
                }
            }
        }
        .padding(.leading, 40)
    }

    private func kitItemRow(_ item: EquipmentTabData.KitItem) -> some View {
        let perKit = Int(item.quantity)
        let meta = [item.brand, item.model].filter { !$0.isEmpty }.joined(separator: " • ")
        return HStack(spacing: 8) {
            WarehouseThumb(url: item.thumbnail, size: 26)
            VStack(alignment: .leading, spacing: 0) {
                Text(item.name).font(.caption.weight(.medium))
                if !meta.isEmpty { Text(meta).font(.caption2).foregroundStyle(.secondary) }
            }
            if !item.category.isEmpty { Text(item.category).font(.caption2).foregroundStyle(.secondary) }
            Spacer()
            if row.expandInChecklist { Image(systemName: "printer").font(.caption2).foregroundStyle(.secondary).help("Na checkliście") }
            Text("\(perKit)×\(row.qty) = \(perKit * row.qty)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
    }
}


// MARK: Podgląd pozycji sprzętu (okienko przy miniaturze)

@MainActor struct EquipmentPreviewCard: View {
    let row: EquipmentTabData.Row
    let limits: EquipmentLimits
    let status: (label: String, color: Color)
    let editable: Bool
    let openDetail: (() -> Void)?

    private var unit: String { row.isKit ? "szt." : row.unit }
    private var meta: String { [row.brand, row.model].filter { !$0.isEmpty }.joined(separator: " • ") }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            WarehouseThumb(url: row.thumbnail, size: 260, symbol: row.isKit ? "shippingbox.fill" : row.isCable ? "cable.connector" : "shippingbox")
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name).font(.headline).textSelection(.enabled)
                if !meta.isEmpty { Text(meta).font(.callout).foregroundStyle(.secondary) }
                if !row.category.isEmpty { Text(row.category).font(.caption).foregroundStyle(.secondary) }
            }
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 5) {
                GridRow {
                    Text("Status").foregroundStyle(.secondary)
                    EventDotLabel(label: status.label, color: status.color)
                }
                GridRow {
                    Text("W wydarzeniu").foregroundStyle(.secondary)
                    Text("\(row.qty) \(unit)").monospacedDigit()
                }
                if row.key != nil {
                    GridRow {
                        Text("Magazyn").foregroundStyle(.secondary)
                        Text("\(limits.total) · zarezerw. \(limits.reserved)").monospacedDigit()
                    }
                    if editable {
                        GridRow {
                            Text("Można dodać").foregroundStyle(.secondary)
                            Text("\(limits.maxAdd) · max \(limits.maxSet)").monospacedDigit()
                        }
                    }
                }
                if row.isCable, let length = row.cableLength {
                    GridRow {
                        Text("Długość").foregroundStyle(.secondary)
                        Text(EquipmentQty.text(length) + " m").monospacedDigit()
                    }
                }
            }
            .font(.callout)
            if row.isKit && !row.kitItems.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Zawartość zestawu").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(Array(row.kitItems.prefix(8).enumerated()), id: \.offset) { entry in
                        HStack(spacing: 6) {
                            WarehouseThumb(url: entry.element.thumbnail, size: 20)
                            Text(entry.element.name).lineLimit(1)
                            Spacer(minLength: 8)
                            Text("\(Int(entry.element.quantity))×").monospacedDigit().foregroundStyle(.secondary)
                        }
                        .font(.caption)
                    }
                    if row.kitItems.count > 8 { Text("… i \(row.kitItems.count - 8) więcej").font(.caption).foregroundStyle(.secondary) }
                }
            }
            if let openDetail {
                Button("Otwórz kartę sprzętu", systemImage: "arrow.up.forward.app") { openDetail() }
                    .controlSize(.small)
            }
        }
        .padding(14)
        .frame(width: 288)
    }
}
