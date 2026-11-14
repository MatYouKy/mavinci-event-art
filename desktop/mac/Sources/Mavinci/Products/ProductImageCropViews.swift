import AppKit
import SwiftUI

// MARK: Karta produktu, część C2b — kadrowanie zdjęć w PDF (`ProductImageFraming.tsx`, `productImageCrop.ts`): osobny kadr
// dla zdjęcia produktu i zdjęć wariantów w każdym układzie karty. Zapis w `offer_image_crops` (sekcja `image_crops`);
// PL i EN korzystają z tych samych ustawień.

/// Kadr jednego zdjęcia w jednym układzie (jak `ImageCrop`): dopasowanie, pozycja 0–100% i skala 0,5–3.
struct ProductImageCrop: Equatable {
    var fit: String
    var x: Double
    var y: Double
    var zoom: Double

    var json: JSONValue {
        .object(["fit": .string(fit), "x": .number(x), "y": .number(y), "zoom": .number(zoom)])
    }

    /// Odczyt z bazy z granicami jak `imageCrop` w CRM.
    init?(_ value: JSONValue?) {
        guard case .object(let fields)? = value else { return nil }
        func number(_ key: String, _ range: ClosedRange<Double>, _ fallback: Double) -> Double {
            let raw: Double?
            switch fields[key] {
            case .number(let value)?: raw = value
            case .string(let text)?: raw = Double(text)
            default: raw = nil
            }
            guard let raw, raw.isFinite else { return fallback }
            return min(range.upperBound, max(range.lowerBound, raw))
        }
        fit = fields["fit"] == JSONValue.string("contain") ? "contain" : "cover"
        x = number("x", 0...100, 50)
        y = number("y", 0...100, 50)
        zoom = number("zoom", 0.5...3, 1)
    }

    init(fit: String, x: Double, y: Double, zoom: Double) {
        self.fit = fit
        self.x = x
        self.y = y
        self.zoom = zoom
    }
}

enum ProductImageCrops {
    struct Layout: Identifiable {
        let id: String
        let label: String
        let width: Double
        let height: Double
    }
    /// Układy karty w PDF (`IMAGE_CROP_LAYOUTS`) z proporcjami standardowej ramki.
    static let layouts: [Layout] = [
        Layout(id: "default", label: "Osobna strona", width: 225, height: 190),
        Layout(id: "visual", label: "Duża grafika", width: 431, height: 285),
        Layout(id: "compact", label: "Kompaktowy", width: 145, height: 135),
        Layout(id: "variants", label: "Lista wariantów", width: 118, height: 100),
        Layout(id: "recommendations", label: "Propozycja dodatkowa — miniatura", width: 110, height: 110),
    ]
    static func label(_ id: String) -> String { layouts.first { $0.id == id }?.label ?? id }

    /// `offer_image_crops`: ścieżka zdjęcia → układ → kadr.
    static func parse(_ value: JSONValue?) -> [String: [String: ProductImageCrop]] {
        guard case .object(let paths)? = value else { return [:] }
        var result: [String: [String: ProductImageCrop]] = [:]
        for (path, entry) in paths {
            guard case .object(let items) = entry else { continue }
            var crops: [String: ProductImageCrop] = [:]
            for layout in layouts {
                if let crop = ProductImageCrop(items[layout.id]) { crops[layout.id] = crop }
            }
            if !crops.isEmpty { result[path] = crops }
        }
        return result
    }

    static func json(_ crops: [String: [String: ProductImageCrop]]) -> JSONValue {
        var object: [String: JSONValue] = [:]
        for (path, items) in crops where !items.isEmpty {
            object[path] = .object(items.mapValues(\.json))
        }
        return .object(object)
    }
}

/// Zdjęcie do kadrowania: główne zdjęcie produktu albo zdjęcie wariantu (z domyślnym kadrem zdjęcia).
struct ProductCropSource: Identifiable, Hashable {
    let path: String
    let url: String?
    let name: String
    let x: Double
    let y: Double
    let zoom: Double
    var id: String { path }

    /// Jak `sources` w `ProductDetailPage`: zdjęcie główne i zdjęcia wariantów, bez powtórzeń ścieżek.
    static func list(_ detail: ProductDetail, _ extras: ProductExtras?) -> [ProductCropSource] {
        var result: [ProductCropSource] = []
        let product = detail.product
        let main = ProductValue.text(product, "offer_image_path")
        if !main.isEmpty, detail.imageUrl != nil {
            result.append(ProductCropSource(path: main, url: detail.imageUrl, name: "Zdjęcie główne",
                                            x: ProductValue.number(product, "offer_image_position_x") ?? 50,
                                            y: ProductValue.number(product, "offer_image_position_y") ?? 25,
                                            zoom: ProductValue.number(product, "offer_image_zoom") ?? 1))
        }
        for variant in extras?.variants ?? [] {
            guard let path = variant.imagePath, !path.isEmpty, variant.imageUrl != nil,
                  !result.contains(where: { $0.path == path }) else { continue }
            result.append(ProductCropSource(path: path, url: variant.imageUrl, name: variant.name.isEmpty ? "Wariant" : variant.name,
                                            x: 50, y: 50, zoom: 1))
        }
        return result
    }
}

/// Sekcja karty: zapisane kadry i przycisk „Ustaw kadry”.
@MainActor struct ProductImageCropsSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let detail: ProductDetail
    let locked: Bool
    @Environment(\.crmTheme) private var theme
    @State private var editing = false

    var body: some View {
        let sources = ProductCropSource.list(detail, store.extras[productID])
        let crops = ProductImageCrops.parse(detail.product["offer_image_crops"])
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Kadrowanie zdjęć w PDF").font(.headline)
                    Text("Osobne ustawienia dla zdjęcia produktu, wariantów i układów karty.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if detail.canEdit {
                    Button { editing = true } label: { Label("Ustaw kadry", systemImage: "crop") }
                        .controlSize(.small)
                        .disabled(locked || sources.isEmpty)
                }
            }
            if sources.isEmpty {
                Text("Dodaj zdjęcie produktu albo wariantu, aby ustawić kadry.").font(.callout).foregroundStyle(.secondary)
            } else {
                let configured = sources.filter { crops[$0.path]?.isEmpty == false }
                if configured.isEmpty {
                    Text("Brak osobnych kadrów — w PDF zdjęcia są przycinane według domyślnego kadru zdjęcia.").font(.callout).foregroundStyle(.secondary)
                } else {
                    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
                        ForEach(configured) { source in
                            ProductFactRow(label: source.name, value: ProductImageCrops.layouts
                                .filter { crops[source.path]?[$0.id] != nil }.map(\.label).joined(separator: ", "))
                        }
                    }
                    .font(.callout)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
        .sheet(isPresented: $editing) {
            ProductImageCropSheet(store: store, productID: productID, sources: sources, crops: crops)
        }
    }
}

/// Podgląd kadru jak w CRM: tło `cover`/`contain` z pozycją x% y% i skalą względem punktu pozycji; przy skali < 100%
/// zdjęcie mieści się w ramce, a puste miejsce wypełnia rozmyte tło.
struct ProductCropPreview: View {
    let image: NSImage?
    let crop: ProductImageCrop
    let ratio: CGFloat

    var body: some View {
        Color.primary.opacity(0.06)
            .aspectRatio(ratio, contentMode: .fit)
            .overlay {
                GeometryReader { geometry in
                    if let image {
                        let box = geometry.size
                        let rect = Self.imageRect(image: image.size, box: box, crop: crop)
                        ZStack(alignment: .topLeading) {
                            if crop.zoom < 1 {
                                Image(nsImage: image).resizable().scaledToFill()
                                    .frame(width: box.width, height: box.height).clipped()
                                    .blur(radius: 14).opacity(0.45)
                            }
                            Image(nsImage: image).resizable()
                                .frame(width: rect.width, height: rect.height)
                                .offset(x: rect.minX, y: rect.minY)
                        }
                        .frame(width: box.width, height: box.height, alignment: .topLeading)
                        .clipped()
                    } else {
                        ProgressView().frame(width: geometry.size.width, height: geometry.size.height)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.15)))
    }

    /// Prostokąt zdjęcia w ramce (`background-size`, `background-position`, `transform: scale` z `transform-origin` x% y%).
    static func imageRect(image: CGSize, box: CGSize, crop: ProductImageCrop) -> CGRect {
        guard image.width > 0, image.height > 0, box.width > 0, box.height > 0 else { return .zero }
        let contain = crop.zoom < 1 || crop.fit == "contain"
        let scale = contain ? min(box.width / image.width, box.height / image.height) : max(box.width / image.width, box.height / image.height)
        let width = image.width * scale
        let height = image.height * scale
        let left = (box.width - width) * crop.x / 100
        let top = (box.height - height) * crop.y / 100
        let originX = box.width * crop.x / 100
        let originY = box.height * crop.y / 100
        return CGRect(x: originX + (left - originX) * crop.zoom, y: originY + (top - originY) * crop.zoom,
                      width: width * crop.zoom, height: height * crop.zoom)
    }
}

/// „Ustaw kadry”: wybór zdjęcia i układu, podgląd ramki i suwaki; zapis obejmuje wszystkie zmienione kadry.
@MainActor struct ProductImageCropSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let sources: [ProductCropSource]
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: [String: [String: ProductImageCrop]]
    @State private var sourcePath: String
    @State private var layoutID = "visual"
    @State private var images: [String: NSImage] = [:]
    @State private var saving = false

    init(store: ProductsStore, productID: String, sources: [ProductCropSource], crops: [String: [String: ProductImageCrop]]) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.sources = sources
        _draft = State(initialValue: crops)
        _sourcePath = State(initialValue: sources.first?.path ?? "")
    }

    private var source: ProductCropSource? { sources.first { $0.path == sourcePath } ?? sources.first }
    private var layout: ProductImageCrops.Layout { ProductImageCrops.layouts.first { $0.id == layoutID } ?? ProductImageCrops.layouts[0] }
    private var custom: Bool { source.flatMap { draft[$0.path]?[layout.id] } != nil }
    /// Zapisany kadr albo domyślny: miniatura propozycji — całe zdjęcie, pozostałe — wypełnienie z kadrem zdjęcia.
    private var crop: ProductImageCrop {
        if let source, let saved = draft[source.path]?[layout.id] { return saved }
        return ProductImageCrop(fit: layout.id == "recommendations" ? "contain" : "cover",
                                x: source?.x ?? 50, y: source?.y ?? 50, zoom: source?.zoom ?? 1)
    }

    private func change(_ update: (inout ProductImageCrop) -> Void) {
        guard let source else { return }
        var next = crop
        update(&next)
        draft[source.path, default: [:]][layout.id] = next
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Kadrowanie zdjęć w PDF").font(.title3.weight(.semibold))
                Text("Osobne ustawienia dla zdjęcia produktu, wariantów i układów karty.").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 12)

            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 10) {
                        ProductField(label: "Zdjęcie") {
                            Picker("", selection: $sourcePath) {
                                ForEach(sources) { item in
                                    Text(item.name + (draft[item.path]?.isEmpty == false ? " •" : "")).tag(item.path)
                                }
                            }
                            .labelsHidden()
                        }
                        ProductField(label: "Układ w PDF") {
                            Picker("", selection: $layoutID) {
                                ForEach(ProductImageCrops.layouts) { item in
                                    Text(item.label + (source.flatMap { draft[$0.path]?[item.id] } != nil ? " — własny kadr" : "")).tag(item.id)
                                }
                            }
                            .labelsHidden()
                        }
                    }
                    ProductCropPreview(image: source.flatMap { images[$0.path] }, crop: crop, ratio: CGFloat(layout.width / layout.height))
                        .frame(maxWidth: 431, maxHeight: 285)
                        .frame(maxWidth: .infinity)
                    Text("Proporcje standardowego układu. Własny szablon lub zmieniona wysokość grafiki może mieć inną ramkę.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                .frame(width: 450)

                VStack(alignment: .leading, spacing: 12) {
                    ProductField(label: "Dopasowanie") {
                        Picker("", selection: Binding(get: { crop.fit }, set: { value in change { $0.fit = value } })) {
                            Text("Wypełnij kadr — przytnij nadmiar").tag("cover")
                            Text("Pokaż całe zdjęcie").tag("contain")
                        }
                        .labelsHidden().fixedSize()
                    }
                    ProductField(label: "Pozycja pozioma: \(Int(crop.x.rounded()))%") {
                        Slider(value: Binding(get: { crop.x }, set: { value in change { $0.x = value.rounded() } }), in: 0...100)
                    }
                    ProductField(label: "Pozycja pionowa: \(Int(crop.y.rounded()))%") {
                        Slider(value: Binding(get: { crop.y }, set: { value in change { $0.y = value.rounded() } }), in: 0...100)
                    }
                    ProductField(label: "Skala: \(Int((crop.zoom * 100).rounded()))%") {
                        Slider(value: Binding(get: { crop.zoom }, set: { value in change { $0.zoom = (value * 20).rounded() / 20 } }), in: 0.5...3)
                    }
                    HStack {
                        Button("Wyrównaj do góry") { change { $0 = ProductImageCrop(fit: "cover", x: 50, y: 0, zoom: 1) } }
                        Button("Całe zdjęcie") { change { $0 = ProductImageCrop(fit: "contain", x: 50, y: 50, zoom: 1) } }
                    }
                    .controlSize(.small)
                    Button(role: .destructive) {
                        if let source { draft[source.path]?[layout.id] = nil }
                    } label: { Label("Usuń ustawienie tego kadru", systemImage: "arrow.uturn.backward") }
                        .controlSize(.small)
                        .disabled(!custom)
                    Text("Ustawienie dotyczy tylko wybranego zdjęcia i układu. Zapis obejmuje wszystkie zmienione kadry. PL i EN korzystają z tych samych ustawień. Zmiana zdjęcia nie przenosi kadru na nowy plik.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 18)
            .disabled(saving)

            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz kadry") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
            .padding(18)
        }
        .frame(width: 860)
        .background(theme.page)
        .task(id: sourcePath) {
            guard let source, images[source.path] == nil, let url = source.url else { return }
            images[source.path] = await ProductImageCache.shared.image(path: source.path, url: url)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if await store.saveSection(productID, section: "image_crops", patch: ["offer_image_crops": ProductImageCrops.json(draft)],
                                   success: "Zapisano kadry zdjęć") {
            dismiss()
        }
    }
}
