import SwiftUI
import AppKit

// MARK: Okna zakładki Sprzęt: alternatywy (okno zamiany), wynajem (`SelectRentalEquipmentModal`),
// komponenty (`RequiredComponentsWarning`) i notatki do checklisty (`EquipmentChecklistNotes`). Dodawanie i ilości — `EventEquipmentManager.swift`.

// MARK: Alternatywny sprzęt

@MainActor struct EquipmentAlternativesSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let rowID: String?
    let equipmentID: String?
    let categoryID: String?
    let oldName: String
    let deficit: Int?
    let initialQuantity: Int
    let onReplaced: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var result: EquipmentAlternatives?
    @State private var error: String?
    @State private var quantity = 1

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Wybierz alternatywny sprzęt").font(.title3.weight(.semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            HStack(spacing: 4) {
                Text("Zastępujesz:").foregroundStyle(.secondary)
                Text(oldName).bold()
                if let deficit { Text("(brakuje \(deficit) szt.)").foregroundStyle(.red) }
            }
            .font(.callout).padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            HStack(spacing: 6) {
                Text("Ilość:").font(.callout)
                TextField("", value: Binding(get: { quantity }, set: { quantity = max(1, $0) }), format: .number).frame(width: 60).textFieldStyle(.roundedBorder)
                Text("szt.").font(.callout).foregroundStyle(.secondary)
            }
            Group {
                if let result {
                    if result.alternatives.isEmpty {
                        ContentUnavailableView("Brak dostępnych alternatyw", systemImage: "shippingbox")
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) { ForEach(result.alternatives) { alternativeRow($0) } }
                        }
                    }
                } else if let error {
                    ContentUnavailableView("Nie udało się znaleźć alternatyw", systemImage: "shippingbox", description: Text(error))
                } else {
                    ProgressView("Szukanie alternatyw…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .padding(20).frame(width: 620, height: 600)
        .task { await load() }
    }

    private func load() async {
        quantity = max(1, initialQuantity)
        var params: [String: String] = [:]
        if let equipmentID { params["equipmentId"] = equipmentID }
        if let categoryID { params["categoryId"] = categoryID }
        do {
            let reply = try await store.tabQuery(eventID, "equipment", "alternatives", params, as: EquipmentAlternatives.self)
            result = reply
            state.snack = Snack(kind: .info, text: reply.message)
        } catch {
            self.error = store.failureText(error, "Błąd podczas szukania alternatyw")
        }
    }

    private func alternativeRow(_ alt: EquipmentAlternatives.Alternative) -> some View {
        let inTerm = Int(alt.availableInTerm)
        let available = inTerm >= quantity
        let meta = [alt.brand, alt.model].filter { !$0.isEmpty }.joined(separator: " • ")
        return HStack(spacing: 12) {
            WarehouseThumb(url: alt.thumbnail, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(alt.name).font(.callout.weight(.medium))
                if !meta.isEmpty { Text(meta).font(.caption).foregroundStyle(.secondary) }
                HStack(spacing: 6) {
                    Text("Dostępne w terminie: \(inTerm) szt.").foregroundStyle(inTerm > 0 ? Color.green : Color.red)
                    Text("•").foregroundStyle(.secondary)
                    Text("Ogółem: \(Int(alt.total)) szt.").foregroundStyle(.secondary)
                }
                .font(.caption)
            }
            Spacer()
            Button(available ? "Wybierz" : "Niedostępne") { Task { await replace(alt) } }
                .buttonStyle(.borderedProminent).disabled(!available)
        }
        .padding(12)
        .background(available ? Color.primary.opacity(0.04) : Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private func replace(_ alt: EquipmentAlternatives.Alternative) async {
        var body: [String: JSONValue] = ["alternativeId": .string(alt.id), "quantity": .number(Double(quantity)), "oldName": .string(oldName)]
        if let rowID { body["rowId"] = .string(rowID) }
        do {
            let reply = try await store.tabAction(eventID, "equipment", "replace", body, reload: ["equipment", "equipment-checklist"], success: nil, pending: "Zamiana sprzętu…")
            struct Reply: Decodable { var message: String? }
            state.succeed((try? JSONDecoder().decode(Reply.self, from: reply))?.message ?? "Sprzęt zamieniony")
            onReplaced()
            dismiss()
        } catch {
            state.error = store.failureText(error, "Błąd podczas zamiany sprzętu")
        }
    }
}

// MARK: Wynajem od podwykonawcy

@MainActor struct EquipmentRentalSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let rowID: String?
    let currentName: String
    let categoryID: String?
    let quantity: Int
    let onDone: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var catalog: RentalCatalog?
    @State private var error: String?
    @State private var search = ""
    @State private var picked: RentalCatalog.Item?

    private var filtered: [RentalCatalog.Item] {
        let q = search.lowercased()
        guard !q.isEmpty else { return catalog?.items ?? [] }
        return (catalog?.items ?? []).filter { $0.name.lowercased().contains(q) || $0.description.lowercased().contains(q) || ($0.category ?? "").lowercased().contains(q) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(picked == nil ? "Wybierz sprzęt do wypożyczenia" : "Potwierdź wybór").font(.title3.weight(.semibold))
                    if !currentName.isEmpty { (Text("Zamiennik dla: ").foregroundColor(.secondary) + Text(currentName).bold()).font(.callout) }
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            if let picked {
                confirm(picked)
            } else {
                TextField("Szukaj sprzętu...", text: $search).textFieldStyle(.roundedBorder)
                Group {
                    if catalog != nil {
                        if filtered.isEmpty {
                            let text = !search.isEmpty ? "Nie znaleziono sprzętu" : categoryID != nil ? "Brak sprzętu w tej kategorii" : "Brak sprzętu do wypożyczenia"
                            ContentUnavailableView(text, systemImage: "shippingbox")
                        } else {
                            ScrollView { LazyVStack(spacing: 8) { ForEach(filtered) { item in itemRow(item) } } }
                        }
                    } else if let error {
                        ContentUnavailableView("Błąd podczas ładowania sprzętu", systemImage: "shippingbox", description: Text(error))
                    } else {
                        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(maxHeight: .infinity)
            }
        }
        .padding(20).frame(width: 620, height: 600)
        .task { await load() }
    }

    private func load() async {
        do {
            catalog = try await store.tabQuery(eventID, "equipment", "rentals", categoryID.map { ["categoryId": $0] } ?? [:], as: RentalCatalog.self)
        } catch {
            self.error = store.failureText(error, "Błąd podczas ładowania sprzętu")
        }
    }

    private func price(_ value: Double?) -> String? {
        guard let value, value != 0 else { return nil }
        return value.formatted(.number.precision(.fractionLength(2)).locale(Locale(identifier: "pl_PL"))) + " zł/dzień"
    }

    private func itemRow(_ item: RentalCatalog.Item) -> some View {
        Button { picked = item } label: {
            HStack(spacing: 12) {
                WarehouseThumb(url: item.thumbnail, size: 48)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.name).font(.callout.weight(.medium))
                    if !item.description.isEmpty { Text(item.description).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                    HStack(spacing: 8) {
                        if let category = item.category { Text(category).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1).background(Color.primary.opacity(0.08), in: Capsule()) }
                        if item.subcontractorAlias != nil || item.subcontractorName != nil { Label(item.company, systemImage: "building.2").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if let price = price(item.pricePerDay) { Text(price).font(.callout.weight(.medium)).foregroundStyle(theme.accent) }
                    Text("Dostępne: \(EquipmentQty.text(item.quantity))").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10)).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func confirm(_ item: RentalCatalog.Item) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                WarehouseThumb(url: item.thumbnail, size: 96)
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name).font(.title3.weight(.medium))
                    if !item.description.isEmpty { Text(item.description).font(.callout).foregroundStyle(.secondary) }
                    Label(item.company, systemImage: "building.2").font(.callout)
                    if let price = price(item.pricePerDay) { Text(price).font(.callout).foregroundStyle(theme.accent) }
                    Text("Dostępne: \(EquipmentQty.text(item.quantity))").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text("Pozycja zostanie oznaczona jako wynajem, a u podwykonawcy powstanie zadanie wynajmu.").font(.callout).foregroundStyle(.secondary)
            Spacer()
            HStack {
                Button("Wstecz") { picked = nil; search = "" }
                Spacer()
                Button("Potwierdź wybór") { Task { await select(item) } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
    }

    private func select(_ item: RentalCatalog.Item) async {
        var body: [String: JSONValue] = [
            "subcontractorId": .string(item.subcontractorId), "rentalEquipmentId": .string(item.id), "equipmentName": .string(item.name),
            "subcontractorName": .string(item.company), "quantity": .number(Double(quantity)),
        ]
        if let rowID { body["rowId"] = .string(rowID) }
        do {
            let reply = try await store.tabAction(eventID, "equipment", "rental", body, reload: ["equipment", "equipment-checklist"], success: nil, pending: "Zapisywanie wynajmu…")
            struct Reply: Decodable { var message: String? }
            state.succeed((try? JSONDecoder().decode(Reply.self, from: reply))?.message ?? "Sprzęt oznaczony jako wynajem od \(item.company)")
            onDone()
            dismiss()
        } catch {
            state.error = store.failureText(error, "Błąd podczas oznaczania jako rental")
        }
    }
}

// MARK: Komponenty sprzętu

@MainActor struct EquipmentComponentsSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let equipmentID: String
    let offerID: String?
    let reviewID: String?
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var chosen: [String: String] = [:]
    @State private var quantities: [String: Int] = [:]
    @State private var conflicts: [String: ComponentConflicts] = [:]
    @State private var loadingConflict: String?
    @State private var expandedConflict: String?
    @State private var adding = false
    @State private var finished = false

    private var data: EquipmentTabData? { store.tab(eventID, "equipment", as: EquipmentTabData.self) }
    private var groups: [EquipmentTabData.ComponentGroup] { data?.components[equipmentID]?.groups ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Komponenty zestawu").font(.title2.weight(.light))
                    Text("Sprawdź elementy wymagane, rekomendowane i opcjonalne oraz ich dostępność").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { close(skipped: true) } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            Label("Elementy wymagane są niezbędne do działania. Rekomendowane warto dodać, jeśli będą potrzebne w tej realizacji. Opcjonalne dodaj według potrzeb, wybierając ich ilość.",
                  systemImage: "exclamationmark.triangle")
                .font(.callout).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(groups) { group in
                        if group.name != nil { groupCard(group) } else if let component = group.components.first { singleCard(group, component) }
                    }
                }
            }
            .frame(maxHeight: .infinity)
            HStack {
                Spacer()
                Button("Anuluj") { close(skipped: true) }.disabled(adding)
                Button { Task { await add() } } label: { Label(adding ? "Dodawanie..." : "Dodaj wybrane komponenty", systemImage: "checkmark.circle") }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(adding || groups.isEmpty)
            }
        }
        .padding(20).frame(width: 900, height: 700)
        .task { await verifyUnavailable() }
        .onChange(of: groups.isEmpty) { _, empty in if empty && !adding { close(skipped: false) } }
    }

    // Dostępność komponentu (`getAvailability`): sprawdzona przez administratora albo z dostępności wydarzenia.
    private func availability(_ c: EquipmentTabData.Component) -> (available: Int, required: Int, addable: Int, isAvailable: Bool, isPartial: Bool)? {
        guard let key = c.key, let a = conflicts[key]?.verified ?? data?.availability[key] else { return nil }
        let available = Int(a.maxAdd)
        let required = Int(c.missing)
        return (available, required, min(required, available), available > 0, available > 0 && available < required)
    }
    private func maxAddable(_ c: EquipmentTabData.Component) -> Int { max(0, availability(c)?.addable ?? Int(c.missing)) }
    private func selectedQuantity(_ c: EquipmentTabData.Component) -> Int {
        let maximum = maxAddable(c)
        guard maximum > 0 else { return 0 }
        let minimum = c.type == "optional" ? 0 : 1
        let fallback = c.type == "optional" && c.group == nil ? 0 : maximum
        return min(maximum, max(minimum, quantities[c.id] ?? fallback))
    }

    private func groupCard(_ group: EquipmentTabData.ComponentGroup) -> some View {
        let name = group.name ?? ""
        let badge = group.required ? "Wybierz JEDEN" : group.recommended ? "Rekomendowane" : "Opcjonalne"
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(group.required ? .red : .blue)
                Text(name).font(.headline)
                Text(badge).font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background((group.required ? Color.red : Color.blue).opacity(0.15), in: Capsule())
                Spacer()
                Button { Task { await dismissGroup(group) } } label: { Label(group.required ? "Pomiń wymaganie" : "Nie używamy", systemImage: "minus.circle") }
                    .controlSize(.small)
            }
            Text(group.required ? "Wybierz jeden z poniższych komponentów albo świadomie pomiń wymaganie dla tego wydarzenia" : "Możesz wybrać jeden z poniższych wariantów")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(group.components) { component in
                let isSelected = chosen[name] == component.targetId
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: isSelected ? "largecircle.fill.circle" : "circle").foregroundStyle(isSelected ? theme.accent : Color.secondary)
                    componentBody(component, required: group.required, single: false, enabled: isSelected)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(isSelected ? theme.accent.opacity(0.1) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
                .onTapGesture { if let target = component.targetId { chosen[name] = target } }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
    }

    private func singleCard(_ group: EquipmentTabData.ComponentGroup, _ component: EquipmentTabData.Component) -> some View {
        HStack(alignment: .center, spacing: 14) {
            componentBody(component, required: group.required, single: true, enabled: true,
                          hint: group.required ? "Niezbędny — zostanie dodany po zatwierdzeniu."
                              : component.type == "optional" ? "Opcjonalny — ustaw ilość, jeśli chcesz go dodać."
                              : "Warto dodać, jeśli będzie potrzebny w tej realizacji.")
            Button { Task { await dismissGroup(group) } } label: {
                Label(group.required ? "Pomiń wymaganie" : "Nie używamy", systemImage: "minus.circle")
            }
            .controlSize(.small)
            .help(group.required ? "Pomiń wymaganie w tym wydarzeniu" : "Nie używamy w tym rozwiązaniu")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func componentBody(_ c: EquipmentTabData.Component, required: Bool, single: Bool, enabled: Bool, hint: String? = nil) -> some View {
        let a = availability(c)
        let unit = c.unit
        let typeLabel = required ? "WYMAGANY" : c.type == "optional" ? "OPCJONALNY" : "REKOMENDOWANY"
        let isRequired = c.type == "required"
        let needLabel = isRequired ? "Do dodania" : "Sugerowane"
        let targetLabel = isRequired ? "wymagane" : "docelowo"
        let need = "\(needLabel): \(Int(c.missing)) / \(targetLabel) \(Int(c.required)) \(unit)"
        // Wiersz na całą szerokość: miniatura | nazwa, typ, dostępność, potrzeba | ilość do dodania.
        return HStack(alignment: .center, spacing: 12) {
            WarehouseThumb(url: c.thumbnail, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(c.name ?? "Komponent").font(.body.weight(.semibold)).lineLimit(1)
                    if single { tag(typeLabel, required ? .red : .blue) }
                    if c.kind == "kit" { tag("ZESTAW", theme.accent) }
                    if c.kind == "cable" { tag("PRZEWÓD", .cyan) }
                }
                HStack(spacing: 8) {
                    Text(need).font(.callout).foregroundStyle(.secondary)
                    if let a { availabilityBadge(a.isAvailable, a.isPartial, a.available) }
                }
                details(c)
                if let hint { Text(hint).font(.caption).foregroundStyle(.tertiary) }
                conflictDetails(c)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            quantitySelector(c, disabled: !enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func details(_ c: EquipmentTabData.Component) -> some View {
        if c.kind == "item" && (!c.brand.isEmpty || !c.model.isEmpty) {
            Text("\(c.brand) \(c.model)").font(.caption).foregroundStyle(.secondary)
        } else if c.kind == "kit" && !c.description.isEmpty {
            Text(c.description).font(.caption).foregroundStyle(.secondary)
        } else if c.kind == "cable" {
            let length = c.lengthMeters.map { EquipmentQty.text($0) + "m" } ?? ""
            let description = c.description.isEmpty ? "" : " - " + c.description
            if !(length + description).isEmpty { Text(length + description).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.weight(.semibold)).foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 2).background(color.opacity(0.14), in: Capsule())
    }
    private func availabilityBadge(_ available: Bool, _ partial: Bool, _ count: Int) -> some View {
        tag(available ? (partial ? "Dostępna część: \(count)" : "Dostępne: \(count)") : "Niedostępne", available ? .green : .red)
    }

    @ViewBuilder private func quantitySelector(_ c: EquipmentTabData.Component, disabled: Bool) -> some View {
        let maximum = maxAddable(c)
        if maximum > 0 {
            let minimum = c.type == "optional" ? 0 : 1
            VStack(alignment: .trailing, spacing: 2) {
                Text("Dodaj").font(.caption).foregroundStyle(.secondary)
                EquipmentStepper(value: selectedQuantity(c), lower: minimum, upper: maximum, unit: c.unit) { quantities[c.id] = min(maximum, max(minimum, $0)) }
                    .disabled(disabled)
                Text("maks. \(maximum) \(c.unit)").font(.caption2).foregroundStyle(.secondary)
            }
            .fixedSize()
        }
    }

    @ViewBuilder private func conflictDetails(_ c: EquipmentTabData.Component) -> some View {
        if let key = c.key, let a = availability(c), !a.isAvailable {
            let expanded = expandedConflict == key
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    if expanded { expandedConflict = nil } else { expandedConflict = key; Task { await loadConflicts(c) } }
                } label: {
                    HStack(spacing: 4) {
                        if loadingConflict == key { ProgressView().controlSize(.mini) } else { Image(systemName: expanded ? "chevron.up" : "chevron.down") }
                        Text(expanded ? "Ukryj zajętość" : "Gdzie jest zajęty?")
                    }
                    .font(.caption.weight(.medium)).foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                if expanded && loadingConflict != key { conflictList(conflicts[key]?.conflicts ?? []) }
            }
        }
    }

    private func conflictList(_ list: [ComponentConflicts.Conflict]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if list.isEmpty {
                Text("Brak rezerwacji nakładającej się na termin. Niedostępność wynika ze stanu lub statusu jednostki magazynowej i wymaga weryfikacji danych sprzętu.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(list) { conflict in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "calendar.badge.clock").font(.caption).foregroundStyle(.red)
                        VStack(alignment: .leading, spacing: 1) {
                            Button(conflict.eventName) { state.showEvent(conflict.eventId) }.buttonStyle(.link).linkCursor().font(.caption.weight(.medium))
                            Text("\(conflictDate(conflict.start)) – \(conflictDate(conflict.end))").font(.caption2)
                            Text("Ilość: \(Int(conflict.quantity))" + (conflict.source == "kit" ? " · element zarezerwowanego zestawu" : "")).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(8).background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    private func conflictDate(_ iso: String) -> String {
        guard let date = MeetingDates.parse(iso) else { return iso }
        return date.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year().hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "pl_PL")))
    }

    private func loadConflicts(_ c: EquipmentTabData.Component) async {
        guard let key = c.key, conflicts[key] == nil else { return }
        loadingConflict = key
        defer { loadingConflict = nil }
        do {
            conflicts[key] = try await store.tabQuery(eventID, "equipment", "conflicts", ["key": key, "existing": String(Int(c.existing))], as: ComponentConflicts.self)
        } catch {
            state.error = "Nie udało się pobrać szczegółów zajętości"
            conflicts[key] = ComponentConflicts(conflicts: [], verified: nil)
        }
    }

    /// Administrator: niedostępne komponenty sprawdzane od razu (zajętość i stan jednostek, `verifyAdminInventory`).
    private func verifyUnavailable() async {
        guard data?.canVerifyInventory == true else { return }
        for group in groups {
            for component in group.components {
                if let a = availability(component), a.available > 0 { continue }
                await loadConflicts(component)
            }
        }
    }

    private func dismissGroup(_ group: EquipmentTabData.ComponentGroup) async {
        do {
            let reply = try await store.tabAction(eventID, "equipment", "dismissComponents",
                                                  ["equipmentId": .string(equipmentID), "componentIds": .array(group.components.map { .string($0.id) }), "required": .bool(group.required)],
                                                  reload: ["equipment"], success: nil, pending: "Zapisywanie decyzji…")
            struct Reply: Decodable { var message: String? }
            state.succeed((try? JSONDecoder().decode(Reply.self, from: reply))?.message ?? "Zapisano")
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać decyzji o pominięciu komponentu")
        }
    }

    private func add() async {
        for group in groups where group.name != nil && group.required && chosen[group.name ?? ""] == nil {
            state.snack = Snack(kind: .info, text: "Proszę wybrać jeden komponent z grupy \"\(group.name ?? "")\"")
            return
        }
        var picks: [JSONValue] = []
        for group in groups {
            let component: EquipmentTabData.Component?
            if let name = group.name { component = group.components.first { $0.targetId != nil && $0.targetId == chosen[name] } } else { component = group.components.first }
            guard let component else { continue }
            if component.type == "optional" && selectedQuantity(component) <= 0 { continue }
            if let a = availability(component), !a.isAvailable {
                state.snack = Snack(kind: .info, text: group.name != nil ? "Wybrany komponent nie jest dostępny w terminie wydarzenia" : "\(component.name ?? "Komponent") nie jest dostępny w terminie wydarzenia")
                return
            }
            picks.append(.object(["componentId": .string(component.id), "quantity": .number(Double(selectedQuantity(component)))]))
        }
        adding = true
        defer { adding = false }
        var body: [String: JSONValue] = ["equipmentId": .string(equipmentID), "picks": .array(picks)]
        if let offerID { body["offerId"] = .string(offerID) }
        do {
            try await store.tabAction(eventID, "equipment", "components", body, reload: ["equipment", "equipment-checklist"],
                                      success: "Zaktualizowano komponenty wydarzenia", pending: "Dodawanie komponentów…")
            close(skipped: false)
        } catch {
            state.error = store.failureText(error, "Błąd podczas dodawania komponentów")
        }
    }

    /// Zamknięcie: z kolejki weryfikacji „Anuluj” / ✕ zapisuje „pominięte”, pełne dodanie — „sprawdzone” (gdy nic już nie brakuje).
    private func close(skipped: Bool) {
        guard !finished else { return }
        finished = true
        if let reviewID {
            let status = skipped ? "skipped" : groups.isEmpty ? "reviewed" : nil
            if let status {
                Task {
                    _ = try? await store.tabAction(eventID, "equipment", "review", ["reviewId": .string(reviewID), "status": .string(status)],
                                                   reload: ["equipment"], success: nil, pending: "Zapisywanie…")
                }
            }
        }
        dismiss()
    }
}

// MARK: Notatki do checklisty

@MainActor struct EquipmentChecklistNotesView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let notes: [EquipmentTabData.Note]
    @Binding var dirty: Bool
    let onSaved: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var draft: [EquipmentTabData.Note] = []
    @State private var editing = false
    @State private var saving = false
    @State private var error = ""
    @State private var loadedFrom: [EquipmentTabData.Note]?

    private var length: Int { draft.reduce(0) { $0 + $1.text.count } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Notatki do checklisty").font(.headline)
                Spacer()
                if !editing { Button { editing = true } label: { Label("Edytuj notatki", systemImage: "pencil") }.controlSize(.small) }
            }
            ForEach(Array(draft.enumerated()), id: \.element.id) { item in noteRow(item.offset, item.element) }
            if draft.isEmpty { Text("Brak dodatkowych notatek.").font(.callout).foregroundStyle(.secondary) }
            Button { editing = true; draft.append(EquipmentTabData.Note(id: UUID().uuidString.lowercased(), text: "", checked: false)) } label: {
                Label("Dodaj notatkę", systemImage: "plus")
            }
            .controlSize(.small).disabled(saving || draft.count >= 50)
            if editing || dirty {
                HStack {
                    Text("\(length)/1000" + (dirty ? " · Niezapisane zmiany" : "")).font(.caption).foregroundStyle(length > 1000 ? Color.red : Color.secondary)
                    Spacer()
                    Button("Anuluj") { draft = notes; editing = false; error = "" }.disabled(saving)
                    Button(saving ? "Zapisywanie…" : "Zapisz notatki") { Task { await save() } }
                        .buttonStyle(.borderedProminent).disabled(saving || !dirty || length > 1000)
                }
                .controlSize(.small)
            }
            if !error.isEmpty { Text(error).font(.callout).foregroundStyle(.red) }
        }
        .padding(14)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .onAppear { sync() }
        .onChange(of: notes) { _, _ in if !dirty { sync() } }
        .onChange(of: draft) { _, next in dirty = next != notes }
    }

    private func sync() {
        draft = notes
        loadedFrom = notes
        dirty = false
    }

    private func noteRow(_ index: Int, _ note: EquipmentTabData.Note) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Toggle("", isOn: Binding(get: { draft.indices.contains(index) ? draft[index].checked : false },
                                     set: { value in if draft.indices.contains(index) { draft[index].checked = value } }))
                .labelsHidden().toggleStyle(.checkbox).disabled(saving)
                .help("Potwierdź notatkę \(index + 1)")
            if editing {
                TextField("Treść notatki", text: Binding(get: { draft.indices.contains(index) ? draft[index].text : "" },
                                                        set: { value in if draft.indices.contains(index) { draft[index].text = String(value.prefix(1000)) } }),
                          axis: .vertical)
                    .lineLimit(1...4).textFieldStyle(.roundedBorder).disabled(saving)
                Button { draft.removeAll { $0.id == note.id } } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).foregroundStyle(.red).disabled(saving).help("Usuń notatkę \(index + 1)")
            } else {
                Text(note.text).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func save() async {
        guard !saving else { return }
        if length > 1000 || draft.count > 50 { error = "Notatki mogą mieć łącznie do 1000 znaków i 50 punktów."; return }
        if draft.contains(where: { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            error = "Uzupełnij treść każdego punktu lub usuń pustą notatkę."
            return
        }
        saving = true
        defer { saving = false }
        error = ""
        let value: [JSONValue] = draft.map {
            .object(["id": .string($0.id), "text": .string($0.text.trimmingCharacters(in: .whitespacesAndNewlines)), "checked": .bool($0.checked)])
        }
        do {
            try await store.tabAction(eventID, "equipment", "notes", ["notes": .array(value)], reload: ["equipment"],
                                      success: "Notatki do checklisty zapisane", pending: "Zapisywanie notatek…")
            editing = false
            dirty = false
            onSaved()
            sync()
        } catch {
            self.error = store.failureText(error, "Nie udało się zapisać notatek. Spróbuj ponownie.")
        }
    }
}
