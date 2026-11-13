import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Grafika na karcie produktu (`ProductCardImageSection.tsx`) — zdjęcie do oferty PDF (JPG, PNG lub WebP do 10 MB,
// zmniejszane do 1800 px jak `optimizeOfferImage`), opis grafiki i kadrowanie: poziom, pion, skala i „Przywróć domyślny kadr”.

/// Zdjęcie w kadrze 4:3 jak w ofercie: wypełnienie ramki (`object-fit: cover`), położenie w procentach i skala względem
/// punktu kadru; poniżej 100% całe zdjęcie mieści się w kadrze, a rozmyte tło wypełnia resztę.
struct ProductFramedImage: View {
    let image: NSImage?
    let x: Double
    let y: Double
    let zoom: Double

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack {
                Color.black.opacity(0.18)
                if let image, image.size.width > 0, image.size.height > 0 {
                    let fill = max(size.width / image.size.width, size.height / image.size.height)
                    let width = image.size.width * fill
                    let height = image.size.height * fill
                    let left = (size.width - width) * x / 100
                    let top = (size.height - height) * y / 100
                    if zoom < 1 {
                        Image(nsImage: image).resizable().frame(width: width, height: height)
                            .position(x: left + width / 2, y: top + height / 2)
                            .blur(radius: 16).opacity(0.55)
                    }
                    Image(nsImage: image).resizable().interpolation(.high).frame(width: width, height: height)
                        .position(x: left + width / 2, y: top + height / 2)
                        .scaleEffect(zoom, anchor: UnitPoint(x: x / 100, y: y / 100))
                } else {
                    Image(systemName: "photo").font(.system(size: 34)).foregroundStyle(.secondary)
                }
            }
            .frame(width: size.width, height: size.height)
            .clipped()
        }
        .aspectRatio(4 / 3, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

/// Zapisane zdjęcie produktu (z pamięci podręcznej po ścieżce) w kadrze oferty.
@MainActor struct ProductStoredImage: View {
    let path: String
    let url: String?
    let x: Double
    let y: Double
    let zoom: Double
    @State private var image: NSImage?

    init(path: String, url: String?, x: Double, y: Double, zoom: Double) {
        self.path = path
        self.url = url
        self.x = x
        self.y = y
        self.zoom = zoom
        _image = State(initialValue: path.isEmpty ? nil : ProductImageCache.shared.cached(path))
    }

    var body: some View {
        ProductFramedImage(image: path.isEmpty ? nil : image, x: x, y: y, zoom: min(3, max(0.5, zoom)))
            .task(id: path) {
                guard !path.isEmpty, let url else { image = nil; return }
                image = await ProductImageCache.shared.image(path: path, url: url)
            }
    }
}

/// Zmniejszenie zdjęcia do 1800 px (jak `optimizeOfferImage` w CRM): PNG zostaje PNG (przezroczystość), pozostałe — JPEG 0,82.
enum ProductImageEncoder {
    static let maxSide: CGFloat = 1800
    static let uploadLimit = 8 * 1024 * 1024

    static func encode(_ url: URL) -> (data: Data, image: NSImage)? {
        guard let source = NSImage(contentsOf: url),
              let cg = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let png = UTType(filenameExtension: url.pathExtension)?.conforms(to: .png) ?? false
        let scale = min(1, maxSide / CGFloat(max(cg.width, cg.height)))
        let width = max(1, Int((CGFloat(cg.width) * scale).rounded()))
        let height = max(1, Int((CGFloat(cg.height) * scale).rounded()))
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current?.imageInterpolation = .high
        if !png {
            NSColor.white.setFill()
            NSRect(x: 0, y: 0, width: width, height: height).fill()
        }
        NSGraphicsContext.current?.cgContext.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.restoreGraphicsState()
        var data = png ? rep.representation(using: .png, properties: [:]) : rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82])
        if png, let encoded = data, encoded.count > uploadLimit {
            // Bardzo duży PNG (zdjęcie zapisane jako PNG) — JPEG mieści się w limicie.
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            NSColor.white.setFill()
            NSRect(x: 0, y: 0, width: width, height: height).fill(using: .destinationOver)
            NSGraphicsContext.restoreGraphicsState()
            data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82])
        }
        guard let data, data.count <= uploadLimit else { return nil }
        let image = NSImage(size: NSSize(width: width, height: height))
        image.addRepresentation(rep)
        return (data, image)
    }
}

@MainActor struct ProductImageSheet: View {
    @ObservedObject var store: ProductsStore
    let detail: ProductDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var alt: String
    @State private var x: Double
    @State private var y: Double
    @State private var zoom: Double
    @State private var pickedData: Data?
    @State private var pickedImage: NSImage?
    @State private var removed = false
    @State private var stored: NSImage?
    @State private var importing = false
    @State private var problem: String?
    @State private var saving = false
    @State private var dropping = false

    init(store: ProductsStore, detail: ProductDetail) {
        _store = ObservedObject(wrappedValue: store)
        self.detail = detail
        let product = detail.product
        _alt = State(initialValue: ProductValue.text(product, "offer_image_alt"))
        _x = State(initialValue: ProductValue.number(product, "offer_image_position_x") ?? 50)
        _y = State(initialValue: ProductValue.number(product, "offer_image_position_y") ?? 25)
        _zoom = State(initialValue: min(3, max(0.5, ProductValue.number(product, "offer_image_zoom") ?? 1)))
        let path = ProductValue.text(product, "offer_image_path")
        _stored = State(initialValue: path.isEmpty ? nil : ProductImageCache.shared.cached(path))
    }

    private var currentPath: String { ProductValue.text(detail.product, "offer_image_path") }
    private var preview: NSImage? { pickedImage ?? (removed || currentPath.isEmpty ? nil : stored) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Grafika na karcie produktu").font(.title3.weight(.semibold))
                Spacer()
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)

            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    ProductFramedImage(image: preview, x: x, y: y, zoom: zoom)
                        .overlay {
                            if preview == nil {
                                Text("Przeciągnij zdjęcie tutaj").font(.callout).foregroundStyle(.secondary).offset(y: 36)
                            }
                        }
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(dropping ? theme.accent : Color.primary.opacity(0.15),
                                                                          style: StrokeStyle(lineWidth: dropping ? 2 : 1, dash: preview == nil ? [6] : [])))
                        .dropDestination(for: URL.self) { urls, _ in
                            guard let url = urls.first else { return false }
                            choose(url)
                            return true
                        } isTargeted: { dropping = $0 }
                    HStack {
                        Button { importing = true } label: { Label(preview == nil ? "Wybierz zdjęcie" : "Zmień zdjęcie", systemImage: "square.and.arrow.up") }
                        if preview != nil {
                            Button(role: .destructive) {
                                pickedData = nil
                                pickedImage = nil
                                removed = true
                            } label: { Label("Usuń grafikę", systemImage: "trash") }
                        }
                    }
                    .controlSize(.small)
                    Text("PNG, JPG lub WebP, do 10 MB.").font(.caption).foregroundStyle(.secondary)
                }
                .frame(width: 400)

                VStack(alignment: .leading, spacing: 12) {
                    ProductField(label: "Opis grafiki") {
                        TextField("", text: Binding(get: { alt }, set: { alt = String($0.prefix(300)) })).textFieldStyle(.roundedBorder)
                    }
                    Text("Kadrowanie w ofercie").font(.callout.weight(.semibold))
                    slider("Poziom: \(Int(x.rounded()))%", value: $x, range: 0...100, step: 1)
                    slider("Pion: \(Int(y.rounded()))%", value: $y, range: 0...100, step: 1)
                    slider("Skala: \(Int((zoom * 100).rounded()))%", value: $zoom, range: 0.5...3, step: 0.05)
                    Button("Przywróć domyślny kadr") { x = 50; y = 25; zoom = 1 }
                        .controlSize(.small)
                        .disabled(preview == nil)
                    Text("Poniżej 100% całe zdjęcie mieści się w kadrze, a tło wypełnia pozostałe miejsce.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                .frame(width: 280)
            }
            .padding(.horizontal, 20)
            .disabled(saving)

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz grafikę") { Task { await save() } }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || !state.canWrite)
            }
            .padding(20)
        }
        .frame(width: 740)
        .background(theme.page)
        .task {
            guard !currentPath.isEmpty, stored == nil, let url = detail.imageUrl else { return }
            stored = await ProductImageCache.shared.image(path: currentPath, url: url)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP]) { result in
            if case .success(let url) = result { choose(url) }
        }
    }

    private func slider(_ label: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            Slider(value: value, in: range, step: step).disabled(preview == nil)
        }
    }

    private func choose(_ url: URL) {
        guard !saving else { return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let type = UTType(filenameExtension: url.pathExtension)
        let allowed = [UTType.jpeg, .png, .webP].contains { type?.conforms(to: $0) == true }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard allowed, size > 0, size <= 10 * 1024 * 1024 else {
            problem = "Wybierz zdjęcie JPG, PNG lub WebP do 10 MB."
            return
        }
        guard let encoded = ProductImageEncoder.encode(url) else {
            problem = "Nie udało się odczytać zdjęcia. Wybierz inny plik."
            return
        }
        pickedData = encoded.data
        pickedImage = encoded.image
        removed = false
        problem = nil
    }

    private func save() async {
        saving = true
        defer { saving = false }
        problem = nil
        var path: String? = removed || currentPath.isEmpty ? nil : currentPath
        if let pickedData, let pickedImage {
            guard let uploaded = await store.uploadImage(detail.id, data: pickedData) else { return }
            ProductImageCache.shared.store(pickedImage, path: uploaded)
            path = uploaded
        }
        let patch: [String: JSONValue] = [
            "offer_image_path": path.map { JSONValue.string($0) } ?? .null,
            "offer_image_alt": .string(alt),
            "offer_image_position_x": .number(x.rounded()),
            "offer_image_position_y": .number(y.rounded()),
            "offer_image_zoom": .number((zoom * 100).rounded() / 100),
        ]
        if await store.saveSection(detail.id, section: "offer_image", patch: patch, success: "Zapisano grafikę produktu") {
            dismiss()
        }
    }
}
