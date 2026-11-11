import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Rental — 1:1 z `/crm/equipment/rental` (sprzęt wynajmu od podwykonawców) i kartą `/crm/subcontractors/rental/[id]`:
// wyszukiwanie (nazwa, podwykonawca, kategoria), filtr kategorii, karta z cennikiem netto/brutto, podwykonawcą, umiejętnościami,
// notatkami i galerią (`rental-equipment-images`), edycja i usuwanie. Z kopii na dysku (`warehouse-rental`).

extension RentalItem {
    @MainActor func categoryName(_ store: WarehouseStore) -> String { store.category(categoryId)?.name ?? category }
}

@MainActor struct RentalView: View {
    @ObservedObject var store: WarehouseStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var categoryFilter = "all"
    @State private var removing: RentalItem?

    private var visible: [RentalItem] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.rental.filter { item in
            let category = item.categoryName(store)
            let matches = q.isEmpty || item.name.lowercased().contains(q) || item.company.lowercased().contains(q) || category.lowercased().contains(q)
            return item.active && matches && (categoryFilter == "all" || category == categoryFilter)
        }
    }
    private var categoryNames: [String] {
        var seen: [String] = []
        for item in store.rental { let name = item.categoryName(store); if !name.isEmpty && !seen.contains(name) { seen.append(name) } }
        return seen
    }

    var body: some View {
        Group {
            if let id = store.openedRentalID {
                if let item = store.rentalItem(id) {
                    RentalDetailView(store: store, item: item).id(id)
                } else {
                    ContentUnavailableView {
                        Label("Nie znaleziono sprzętu wynajmu", systemImage: "shippingbox.and.arrow.backward")
                    } actions: { Button("Wróć do listy") { store.openedRentalID = nil } }
                }
            } else {
                list
            }
        }
        .confirmationDialog("Usuń sprzęt", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                if let item = removing { Task { await store.run("Usuwanie…", "rentalDelete", ["id": .string(item.id)], success: "Sprzęt został usunięty") } }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć \"\(removing?.name ?? "")\"? Ta operacja jest nieodwracalna.") }
        .task(id: state.employee?.id) {
            await store.backgroundSync()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    private var list: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Picker("Kategoria", selection: $categoryFilter) {
                    Text("Wszystkie kategorie").tag("all")
                    ForEach(categoryNames, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden().fixedSize()
                Text("Sprzęt dostępny od podwykonawców (\(visible.count))").font(.callout).foregroundStyle(.secondary)
                Spacer()
                if store.syncing { ProgressView().controlSize(.small) }
            }
            .controlSize(.small)
            .padding(.horizontal, 14).padding(.vertical, 9)
            Group {
                if store.rental.isEmpty && !store.loaded {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if visible.isEmpty {
                    ContentUnavailableView(search.isEmpty && categoryFilter == "all" ? "Brak dostępnego sprzętu wynajmu" : "Nie znaleziono sprzętu spełniającego kryteria",
                                           systemImage: "shippingbox.and.arrow.backward")
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 240, maximum: 340), spacing: 12)], spacing: 12) {
                            ForEach(visible) { card($0) }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 6)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Sprzęt wynajmu")
        .navigationSubtitle("Magazyn")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj po nazwie, podwykonawcy lub kategorii...")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { state.openHref("/crm/equipment") } label: { Label("Magazyn", systemImage: "chevron.left") }.help("Wróć do magazynu")
            }
        }
    }

    private func card(_ item: RentalItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            WarehouseThumb(url: item.cover, size: 150, symbol: "shippingbox.and.arrow.backward").frame(maxWidth: .infinity)
            Text(item.name).font(.headline.weight(.medium)).lineLimit(2)
            if !item.description.isEmpty { Text(item.description).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            Label(item.company.nonEmpty ?? "Nieznany podwykonawca", systemImage: "building.2").font(.caption)
            let category = item.categoryName(store)
            if !category.isEmpty { WarehouseBadge(text: category, color: theme.accent) }
            HStack {
                Label(RentalDetailView.price(item.dailyGross ?? item.dailyPrice).map { "\($0)/dzień" } ?? "Cena do ustalenia", systemImage: "banknote")
                Spacer()
                Label("\(item.quantity) szt.", systemImage: "shippingbox")
            }
            .font(.caption)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .topTrailing) {
            if store.canManage {
                Button(role: .destructive) { removing = item } label: { Image(systemName: "trash") }.buttonStyle(.borderless).padding(8).help("Usuń")
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { store.openedRentalID = item.id }
        .contextMenu {
            Button("Otwórz", systemImage: "eye") { store.openedRentalID = item.id }
            if store.canManage { Button("Usuń", systemImage: "trash", role: .destructive) { removing = item } }
        }
    }
}

/// Formularz karty sprzętu wynajmu.
struct RentalDraft: Equatable {
    var name = ""
    var categoryId = ""
    var description = ""
    var quantity = 0
    var active = true
    var vatRate = 23.0
    var dailyNet = ""
    var dailyGross = ""
    var weeklyNet = ""
    var weeklyGross = ""
    var monthlyNet = ""
    var monthlyGross = ""
    var skills = ""
    var notes = ""
    var images: [RentalImage] = []

    init() {}
    init(_ item: RentalItem) {
        let n = WarehouseLabels.number
        name = item.name; categoryId = item.categoryId ?? ""; description = item.description; quantity = item.quantity; active = item.active
        vatRate = item.vatRate ?? 23; dailyNet = n(item.dailyNet); dailyGross = n(item.dailyGross); weeklyNet = n(item.weeklyNet)
        weeklyGross = n(item.weeklyGross); monthlyNet = n(item.monthlyNet); monthlyGross = n(item.monthlyGross)
        skills = item.skills.joined(separator: ", "); notes = item.notes; images = item.images
    }
    var json: [String: JSONValue] {
        let num = EquipmentDraft.number
        return [
            "name": .string(name), "categoryId": .string(categoryId), "description": .string(description), "quantity": .number(Double(quantity)),
            "active": .bool(active), "vatRate": .number(vatRate), "dailyNet": num(dailyNet), "dailyGross": num(dailyGross),
            "weeklyNet": num(weeklyNet), "weeklyGross": num(weeklyGross), "monthlyNet": num(monthlyNet), "monthlyGross": num(monthlyGross),
            "skills": .array(skills.split(separator: ",").map { .string($0.trimmingCharacters(in: .whitespaces)) }),
            "notes": .string(notes),
            "images": .array(images.map { .object(["url": .string($0.url), "title": .string($0.title), "primary": .bool($0.primary)]) }),
        ]
    }
}

@MainActor struct RentalDetailView: View {
    @ObservedObject var store: WarehouseStore
    let item: RentalItem
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editing = false
    @State private var draft = RentalDraft()
    @State private var saving = false
    @State private var removing = false
    @State private var importing = false

    static func price(_ value: Double?) -> String? {
        guard let value, value > 0 else { return nil }
        return value.formatted(.number.precision(.fractionLength(2)).locale(Locale(identifier: "pl_PL"))) + " zł"
    }
    private var grid: [GridItem] { [GridItem(.flexible(), spacing: 14, alignment: .topLeading), GridItem(.flexible(), spacing: 14, alignment: .topLeading)] }
    private var images: [RentalImage] { editing ? draft.images : item.images }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    WarehouseThumb(url: item.cover, size: 72, symbol: "shippingbox.and.arrow.backward")
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.name).font(.title2.weight(.light))
                        Text("Sprzęt wynajmu od podwykonawcy").foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                basics
                pricing
                subcontractor
                skillsAndNotes
                gallery
            }
            .padding(16)
        }
        .navigationTitle(item.name)
        .navigationSubtitle("Rental")
        .overlay { if saving { PendingOverlay(text: "Zapisywanie…") } }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { store.openedRentalID = nil } label: { Label("Rental", systemImage: "chevron.left") }.help("Wróć do listy")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if store.canManage {
                    if editing {
                        Button("Anuluj") { editing = false }.disabled(saving)
                        Button { Task { await save() } } label: { Label("Zapisz", systemImage: "checkmark") }.buttonStyle(.borderedProminent).keyboardShortcut("s").disabled(saving)
                    } else {
                        Button { draft = RentalDraft(item); editing = true } label: { Label("Edytuj", systemImage: "pencil") }.keyboardShortcut("e")
                        Button(role: .destructive) { removing = true } label: { Label("Usuń", systemImage: "trash") }
                    }
                }
            }
        }
        .confirmationDialog("Usuń sprzęt", isPresented: $removing, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                Task {
                    let reply = await store.run("Usuwanie…", "rentalDelete", ["id": .string(item.id)], success: "Sprzęt został usunięty")
                    if reply != nil { store.openedRentalID = nil }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Czy na pewno chcesz usunąć \"\(item.name)\"? Ta operacja jest nieodwracalna.") }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await upload(urls) } }
        }
        .task { await store.sync() }
    }

    private func row(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.isEmpty ? "-" : value).textSelection(.enabled)
        }
    }
    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            content()
        }
    }

    private var basics: some View {
        TeamCard(title: "Podstawowe informacje") {
            if editing {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    field("Nazwa") { TextField("", text: $draft.name).textFieldStyle(.roundedBorder) }
                    field("Kategoria") {
                        Picker("", selection: $draft.categoryId) {
                            Text("Brak").tag("")
                            ForEach(store.categoryTree) { c in Text(String(repeating: "   ", count: max(0, c.level - 1)) + c.name).tag(c.id) }
                        }
                        .labelsHidden()
                    }
                    field("Ilość dostępna") { Stepper("\(draft.quantity) szt.", value: $draft.quantity, in: 0...100_000) }
                    field("Status") { Toggle(draft.active ? "Aktywny" : "Nieaktywny", isOn: $draft.active) }
                }
                field("Opis") { TextField("", text: $draft.description, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder) }
            } else {
                LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                    row("Nazwa", item.name)
                    row("Kategoria", item.categoryName(store))
                    row("Ilość dostępna", "\(item.quantity) szt.")
                    row("Status", item.active ? "Aktywny" : "Nieaktywny")
                }
                row("Opis", item.description)
            }
        }
    }

    private var pricing: some View {
        TeamCard(title: "Cennik wynajmu") {
            if editing {
                field("Stawka VAT") {
                    Picker("", selection: $draft.vatRate) {
                        Text("0% (zwolniony z VAT)").tag(0.0)
                        Text("5%").tag(5.0)
                        Text("8%").tag(8.0)
                        Text("23%").tag(23.0)
                    }
                    .labelsHidden().fixedSize()
                }
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        Text("")
                        Text("Netto").font(.caption).foregroundStyle(.secondary)
                        Text("Brutto").font(.caption).foregroundStyle(.secondary)
                    }
                    priceRow("Cena dzienna", $draft.dailyNet, $draft.dailyGross)
                    priceRow("Cena tygodniowa", $draft.weeklyNet, $draft.weeklyGross)
                    priceRow("Cena miesięczna", $draft.monthlyNet, $draft.monthlyGross)
                }
            } else {
                row("Stawka VAT", (item.vatRate ?? 23) == 0 ? "0% (zwolniony z VAT)" : "\(WarehouseLabels.number(item.vatRate ?? 23))%")
                Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 8) {
                    GridRow {
                        Text("")
                        Text("Netto").font(.caption).foregroundStyle(.secondary)
                        Text("Brutto").font(.caption).foregroundStyle(.secondary)
                    }
                    priceText("Cena dzienna", item.dailyNet, item.dailyGross)
                    priceText("Cena tygodniowa", item.weeklyNet, item.weeklyGross)
                    priceText("Cena miesięczna", item.monthlyNet, item.monthlyGross)
                }
            }
        }
    }
    private func priceRow(_ label: String, _ net: Binding<String>, _ gross: Binding<String>) -> some View {
        GridRow {
            Text(label)
            TextField("", text: net).textFieldStyle(.roundedBorder).frame(width: 140)
            TextField("", text: gross).textFieldStyle(.roundedBorder).frame(width: 140)
        }
    }
    private func priceText(_ label: String, _ net: Double?, _ gross: Double?) -> some View {
        GridRow {
            Text(label)
            Text(Self.price(net) ?? "-").monospacedDigit()
            Text(Self.price(gross) ?? "-").monospacedDigit().foregroundStyle(theme.accent)
        }
    }

    private var subcontractor: some View {
        TeamCard(title: "Podwykonawca") {
            LazyVGrid(columns: grid, alignment: .leading, spacing: 12) {
                row("Firma:", item.company)
                row("Organizacja:", item.organization)
                row("Email:", item.email)
                row("Telefon:", item.phone)
            }
            HStack {
                if let email = item.email.nonEmpty, let url = URL(string: "mailto:\(email)") { Button("Napisz e-mail", systemImage: "envelope") { NSWorkspace.shared.open(url) } }
                if let phone = item.phone.nonEmpty, let url = URL(string: "tel:\(phone.replacingOccurrences(of: " ", with: ""))") {
                    Button("Zadzwoń", systemImage: "phone") { NSWorkspace.shared.open(url) }
                }
            }
            .controlSize(.small)
        }
    }

    private var skillsAndNotes: some View {
        VStack(alignment: .leading, spacing: 16) {
            if editing {
                TeamCard(title: "Wymagane umiejętności") {
                    TextField("", text: $draft.skills, prompt: Text("np. obsługa podestu, uprawnienia SEP (oddziel przecinkami)")).textFieldStyle(.roundedBorder)
                }
                TeamCard(title: "Notatki") { TextField("", text: $draft.notes, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder) }
            } else {
                if !item.skills.isEmpty {
                    TeamCard(title: "Wymagane umiejętności") {
                        WrapLayout(spacing: 6) { ForEach(item.skills, id: \.self) { WarehouseBadge(text: $0, color: theme.accent) } }
                    }
                }
                TeamCard(title: "Notatki") { Text(item.notes.isEmpty ? "Brak" : item.notes).foregroundStyle(item.notes.isEmpty ? .secondary : .primary).textSelection(.enabled) }
            }
        }
    }

    private var galleryAction: (String, () -> Void)? { editing ? ("Dodaj zdjęcia", { importing = true }) : nil }
    private var gallery: some View {
        TeamCard(title: "Galeria zdjęć", action: galleryAction) {
            if images.isEmpty {
                Text("Brak zdjęć").foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(Array(images.enumerated()), id: \.element.url) { index, image in
                        ZStack(alignment: .topLeading) {
                            CachedRemoteImage(url: image.url, crop: nil).frame(maxWidth: .infinity).frame(height: 140)
                                .background(Color.primary.opacity(0.05)).clipShape(RoundedRectangle(cornerRadius: 10))
                            if image.primary {
                                Label("Główne", systemImage: "star.fill").font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 3)
                                    .background(theme.accent, in: RoundedRectangle(cornerRadius: 5)).foregroundStyle(.black).padding(6)
                            }
                            if editing {
                                HStack(spacing: 4) {
                                    Spacer()
                                    if !image.primary {
                                        Button { setPrimary(index) } label: { Image(systemName: "star") }.help("Ustaw jako główne")
                                    }
                                    Button(role: .destructive) { draft.images.remove(at: index) } label: { Image(systemName: "trash") }.help("Usuń")
                                }
                                .buttonStyle(.borderedProminent).controlSize(.small).padding(6)
                            }
                        }
                        .onTapGesture { if let url = URL(string: image.url) { NSWorkspace.shared.open(url) } }
                    }
                }
            }
        }
    }

    private func setPrimary(_ index: Int) {
        for i in draft.images.indices { draft.images[i].primary = i == index }
    }

    private func upload(_ urls: [URL]) async {
        var added = 0
        for (number, url) in urls.enumerated() {
            guard let jpeg = ImageJPEG.from(url, maxSide: 1920) else { state.error = "\(url.lastPathComponent) nie jest obrazem"; continue }
            await state.withPending(urls.count > 1 ? "Przesyłanie \(number + 1)/\(urls.count)…" : "Przesyłanie…") {
                do {
                    let reply = try await store.upload(["op": "rentalImage", "equipmentId": item.id], data: jpeg, filename: url.deletingPathExtension().lastPathComponent + ".jpg", mime: "image/jpeg")
                    if let address = reply["url"]?.text.nonEmpty {
                        draft.images.append(RentalImage(url: address, title: url.lastPathComponent, primary: draft.images.isEmpty))
                        added += 1
                    }
                } catch { state.error = store.failureText(error, "Błąd podczas przesyłania \(url.lastPathComponent)") }
            }
        }
        if added > 0 { state.succeed("Przesyłanie zakończone") }
    }

    private func save() async {
        guard !draft.name.trimmingCharacters(in: .whitespaces).isEmpty else { state.error = "Podaj nazwę sprzętu."; return }
        saving = true
        defer { saving = false }
        let reply = await store.run("Zapisywanie…", "rentalUpdate", ["id": .string(item.id), "data": .object(draft.json)], success: "Zapisano zmiany")
        if reply != nil { editing = false }
    }
}
