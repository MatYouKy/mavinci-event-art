import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Warianty / elementy produktu (`ProductVariantsEditor.tsx`) — lista w kolejności z PDF, edycja w oknie (zdjęcie
// w proporcjach karty 118:100, nazwa, ceny netto ↔ brutto, sposób wyliczania ilości, czas usługi i przedłużenie, opisy
// z limitami druku, zakres), rekomendacja, przenoszenie i usuwanie. Każda zmiana zapisuje się od razu jak w CRM.

@MainActor struct ProductVariantsSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    @EnvironmentObject private var state: Workspace
    @State private var editing: ProductExtras.Variant?
    @State private var removing: ProductExtras.Variant?

    private var noun: String { extras.elementMode ? "element" : "wariant" }
    private var editable: Bool { extras.canEdit && state.canWrite }

    var body: some View {
        ProductPanel(title: extras.elementMode ? "Elementy produktu" : "Warianty produktu",
                     subtitle: extras.elementMode
                        ? "Elementy prezentowane bez cen, do trzech na pierwszej stronie i do pięciu na kolejnych. Gotowe zestawy ustawisz w sekcji pakietów."
                        : "Dodaj warianty i ustal ich kolejność. W PDF pojawią się do trzech na pierwszej stronie i do pięciu na kolejnych.") {
            if editable {
                Button { editing = .blank() } label: { Label(extras.elementMode ? "Dodaj element" : "Dodaj wariant", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
            }
        } content: {
            if extras.variants.isEmpty {
                Text("Brak pozycji. Użyj przycisku „\(extras.elementMode ? "Dodaj element" : "Dodaj wariant")”, aby rozpocząć.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 6) {
                    ForEach(Array(extras.variants.enumerated()), id: \.element.id) { index, variant in row(variant, index: index) }
                }
            }
        }
        .sheet(item: $editing) { variant in ProductVariantSheet(store: store, productID: productID, extras: extras, variant: variant) }
        .confirmationDialog("Usunąć „\(removing?.name ?? "")” z produktu?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Usuń z listy", role: .destructive) {
                if let variant = removing { save(extras.variants.filter { $0.id != variant.id }, success: "Zapisano zmiany elementów produktu") }
                removing = nil
            }
            Button("Anuluj", role: .cancel) { removing = nil }
        } message: {
            Text(extras.packageElementIds.contains(removing?.id ?? "")
                 ? "Ten element jest w składzie pakietu — najpierw usuń go z pakietów."
                 : "Własny sprzęt, obsada i klauzule tego \(noun)u też przestaną obowiązywać.")
        }
    }

    private func row(_ variant: ProductExtras.Variant, index: Int) -> some View {
        HStack(spacing: 10) {
            Text(String(format: "%02d", index + 1)).font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 22)
            ProductThumb(path: variant.imagePath, url: variant.imageUrl, corner: 6).frame(width: 59, height: 50)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(variant.name.isEmpty ? "Nowy element" : variant.name).font(.callout.weight(.semibold))
                    if variant.recommended { Image(systemName: "star.fill").foregroundStyle(.yellow).help("Rekomendowany") }
                    if !variant.active {
                        Text("Nieaktywny").font(.caption2).padding(.horizontal, 5).padding(.vertical, 1).background(Color.secondary.opacity(0.15), in: Capsule())
                    }
                }
                Text(variant.shortDescription.isEmpty ? (variant.description.isEmpty ? "Brak opisu" : variant.description) : variant.shortDescription)
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                if !extras.elementMode {
                    Text("\(ProductText.money(variant.priceNet)) netto").font(.caption.monospacedDigit())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if editable {
                Menu {
                    Button("Edytuj", systemImage: "pencil") { editing = variant }
                    Button(variant.recommended ? "Usuń rekomendację" : "Rekomenduj", systemImage: "star") {
                        save(extras.variants.map { item in
                            var next = item
                            next.recommended = item.id == variant.id && !variant.recommended
                            return next
                        }, success: "Zapisano zmiany elementów produktu")
                    }
                    Button("Przenieś wyżej", systemImage: "arrow.up") { move(index, index - 1) }.disabled(index == 0)
                    Button("Przenieś niżej", systemImage: "arrow.down") { move(index, index + 1) }.disabled(index == extras.variants.count - 1)
                    Divider()
                    Button("Usuń z listy", systemImage: "trash", role: .destructive) { removing = variant }
                } label: { Image(systemName: "ellipsis.circle") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            }
        }
        .padding(8)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { if editable { editing = variant } }
    }

    private func move(_ from: Int, _ to: Int) {
        guard to >= 0, to < extras.variants.count else { return }
        var next = extras.variants
        let item = next.remove(at: from)
        next.insert(item, at: to)
        save(next, success: "Zapisano kolejność")
    }

    private func save(_ variants: [ProductExtras.Variant], success: String) {
        Task { await store.changeExtras(productID, "variantsSave", ["variants": .array(variants.map(\.json))], success: success) }
    }
}

@MainActor struct ProductVariantSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let extras: ProductExtras
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: ProductExtras.Variant
    @State private var benefits: String
    @State private var imageData: Data?
    @State private var image: NSImage?
    @State private var removeImage = false
    @State private var stored: NSImage?
    @State private var importing = false
    @State private var problem: String?
    @State private var saving = false

    init(store: ProductsStore, productID: String, extras: ProductExtras, variant: ProductExtras.Variant) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.extras = extras
        _draft = State(initialValue: variant)
        _benefits = State(initialValue: variant.benefits.joined(separator: "\n"))
        _stored = State(initialValue: ProductImageCache.shared.cached(variant.imagePath))
    }

    private var existing: Bool { extras.variants.contains { $0.id == draft.id } }
    private var noun: String { extras.elementMode ? "element" : "wariant" }
    private var preview: NSImage? { image ?? (removeImage ? nil : stored) }
    private var multiplier: Double { 1 + extras.vatRate / 100 }
    private func round2(_ value: Double) -> Double { ((value + .ulpOfOne) * 100).rounded() / 100 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("\(existing ? "Edytuj" : "Dodaj") \(extras.elementMode ? "element produktu" : "wariant produktu")").font(.title3.weight(.semibold))
                Spacer()
                Toggle(isOn: $draft.recommended) { Label(draft.recommended ? "Rekomendowany" : "Rekomenduj (opcjonalnie)", systemImage: "star") }
                    .toggleStyle(.button)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)

            ScrollView {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(extras.elementMode ? "Zdjęcie elementu do oferty" : "Zdjęcie wariantu do oferty").font(.caption).foregroundStyle(.secondary)
                        Color.primary.opacity(0.05)
                            .aspectRatio(118 / 100, contentMode: .fit)
                            .overlay {
                                if let preview {
                                    Image(nsImage: preview).resizable().scaledToFill()
                                } else {
                                    VStack(spacing: 4) {
                                        Image(systemName: "photo").font(.title2)
                                        Text("Przeciągnij zdjęcie lub kliknij „Wybierz”").font(.caption)
                                        Text("PNG, JPG lub WebP, maks. 10 MB").font(.caption2)
                                    }
                                    .foregroundStyle(.secondary)
                                }
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .dropDestination(for: URL.self) { urls, _ in
                                guard let url = urls.first else { return false }
                                choose(url)
                                return true
                            }
                        HStack {
                            Button(preview == nil ? "Wybierz…" : "Zmień…") { importing = true }
                            if preview != nil {
                                Button("Usuń", role: .destructive) { image = nil; imageData = nil; removeImage = true }
                            }
                        }
                        .controlSize(.small)
                        Text("Proporcje zdjęcia jak na karcie elementu w PDF (118:100). Podgląd pokazuje centralny kadr — brzegi szerszego lub wyższego zdjęcia zostaną przycięte.")
                            .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        TextField("", text: $draft.imageAlt, prompt: Text("Opis zdjęcia dla dostępności")).textFieldStyle(.roundedBorder)
                    }
                    .frame(width: 240)

                    VStack(alignment: .leading, spacing: 10) {
                        ProductField(label: extras.elementMode ? "Nazwa elementu" : "Nazwa wariantu") {
                            TextField("", text: $draft.name, prompt: Text(extras.elementMode ? "Np. Stół blackjack" : "Np. Standard")).textFieldStyle(.roundedBorder)
                        }
                        HStack(alignment: .top, spacing: 10) {
                            ProductField(label: "Cena netto") {
                                ProductNumberField(value: Binding(get: { draft.priceNet }, set: { value in
                                    draft.priceNet = value ?? 0
                                    draft.priceGross = round2((value ?? 0) * multiplier)
                                }), suffix: "zł")
                            }
                            ProductField(label: "Cena brutto") {
                                ProductNumberField(value: Binding(get: { draft.priceGross }, set: { value in
                                    draft.priceGross = value ?? 0
                                    draft.priceNet = round2((value ?? 0) / multiplier)
                                }), suffix: "zł")
                            }
                        }
                        ProductField(label: "Sposób wyliczania ilości") {
                            Picker("", selection: $draft.quantitySource) {
                                ForEach(ProductText.quantitySources, id: \.key) { item in Text(item.label).tag(item.key) }
                            }
                            .labelsHidden().fixedSize()
                        }
                        HStack(alignment: .top, spacing: 10) {
                            ProductField(label: "Czas usługi (h)") {
                                ProductNumberField(value: $draft.serviceDurationHours,
                                                   prompt: extras.defaults.serviceDurationHours.map { "Dziedziczy: \(ProductText.number($0))" } ?? "np. 6", nullable: true)
                            }
                            ProductField(label: "Przedłużenie netto / h") {
                                ProductNumberField(value: $draft.extensionPriceNetPerHour,
                                                   prompt: extras.defaults.extensionPriceNetPerHour.map { "Dziedziczy: \(ProductText.number($0))" } ?? "np. 500", nullable: true)
                            }
                        }
                        Text("Puste pole korzysta z wartości głównej produktu. Uzupełnij je tylko wtedy, gdy wariant ma inny czas lub koszt przedłużenia.")
                            .font(.caption).foregroundStyle(.secondary)
                        ProductField(label: "Krótki opis", help: "\(draft.shortDescription.count)/95 znaków") {
                            TextField("", text: Binding(get: { draft.shortDescription }, set: { draft.shortDescription = String($0.prefix(95)) }),
                                      prompt: Text("Dla kameralnych przyjęć")).textFieldStyle(.roundedBorder)
                        }
                        ProductField(label: extras.elementMode ? "Opis elementu" : "Opis wariantu", help: "\(draft.description.count)/205 znaków") {
                            ProductTextArea(text: Binding(get: { draft.description }, set: { draft.description = String($0.prefix(205)) }),
                                            prompt: "Dla kogo jest ten wariant i czym się wyróżnia", lines: 3...5)
                        }
                        ProductField(label: "Zakres (jedna pozycja w wierszu)") {
                            ProductTextArea(text: $benefits, prompt: "DJ i prowadzenie\nNagłośnienie sali\nPodstawowe oświetlenie", lines: 4...8)
                        }
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 10)
                .disabled(saving)
            }
            .frame(height: 520)

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                else { Text("Zapisz, aby od razu zaktualizować produkt. Anulowanie pozostawi element bez zmian.").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : existing ? "Zapisz \(noun)" : "Dodaj \(noun)") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
            .padding(18)
        }
        .frame(width: 720)
        .background(theme.page)
        .task {
            guard stored == nil, let path = draft.imagePath, let url = draft.imageUrl else { return }
            stored = await ProductImageCache.shared.image(path: path, url: url)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP]) { result in
            if case .success(let url) = result { choose(url) }
        }
    }

    private func choose(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let type = UTType(filenameExtension: url.pathExtension)
        let allowed = [UTType.jpeg, .png, .webP].contains { type?.conforms(to: $0) == true }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard allowed, size > 0, size <= 10 * 1024 * 1024, let encoded = ProductImageEncoder.encode(url) else {
            problem = "Wybierz zdjęcie JPG, PNG lub WebP o wielkości do 10 MB."
            return
        }
        imageData = encoded.data
        image = encoded.image
        removeImage = false
        problem = nil
    }

    private func save() async {
        var next = draft
        next.name = next.name.trimmingCharacters(in: .whitespacesAndNewlines)
        next.benefits = benefits.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !next.name.isEmpty else { problem = "Podaj nazwę."; return }
        let lowered = next.name.lowercased()
        if extras.variants.contains(where: { $0.id != next.id && $0.name.trimmingCharacters(in: .whitespaces).lowercased() == lowered }) {
            problem = "Ta nazwa jest już używana."
            return
        }
        if removeImage { next.imagePath = nil }
        var list = existing ? extras.variants.map { $0.id == next.id ? next : $0 } : extras.variants + [next]
        if next.recommended { list = list.map { item in var copy = item; copy.recommended = item.id == next.id; return copy } }
        var fields: [String: JSONValue] = ["variants": .array(list.map(\.json))]
        if imageData != nil || removeImage {
            var upload: [String: JSONValue] = ["variantId": .string(next.id)]
            if let imageData { upload["data"] = .string(imageData.base64EncodedString()) }
            if removeImage { upload["remove"] = .bool(true) }
            fields["image"] = .object(upload)
        }
        problem = nil
        saving = true
        defer { saving = false }
        if await store.changeExtras(productID, "variantsSave", fields, success: existing ? "Zapisano zmiany elementów produktu" : "Dodano \(noun)") {
            if imageData != nil, let image, let path = store.extras[productID]?.variants.first(where: { $0.id == next.id })?.imagePath {
                ProductImageCache.shared.store(image, path: path)
            }
            dismiss()
        }
    }
}
