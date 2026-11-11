import AppKit

/// Marka z brandbooka domyślnej firmy (`GET /bridge/native/v1/brand`): sygnet i kolory. Zapisywana przez aplikację
/// w Application Support/Mavinci/Desktop/v1/brand/brand.json — z niej skrypt budowania tworzy ikonę pakietu.
struct BrandInfo: Codable, Equatable {
    var company: String?
    var sygnet: String?
    var colors: [String: String?]
    func color(_ role: String, fallback: Int) -> NSColor { (colors[role] ?? nil).flatMap(NSColor.init(brandHex:)) ?? NSColor(brandRGB: fallback) }
}

extension NSColor {
    convenience init(brandRGB rgb: Int) {
        self.init(srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }
    convenience init?(brandHex value: String) {
        let digits = value.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).prefix(6)
        guard digits.count == 6, let rgb = Int(digits, radix: 16) else { return nil }
        self.init(brandRGB: rgb)
    }
}

/// Ikona aplikacji: sygnet z brandbooka na zaokrąglonym kwadracie (siatka ikon macOS: 824 × 824 na płótnie 1024)
/// w kolorach marki — tło z koloru głównego w drugoplanowy, delikatna poświata i obwódka w kolorze akcentu.
/// Ten sam kod rysuje ikonę w Docku (aplikacja) i ikonę pakietu (`scripts/make-icon`).
enum BrandIcon {
    static func draw(in ctx: CGContext, size: CGFloat, sygnet: NSImage, brand: BrandInfo) {
        let k = size / 1024
        let primary = brand.color("primary", fallback: 0x1c1f33)
        let bottom = brand.color("secondary", fallback: 0x0f1119).usingColorSpace(.sRGB) ?? .black
        let accent = brand.color("accent", fallback: 0xd3bb73).usingColorSpace(.sRGB) ?? .systemYellow
        var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
        (primary.usingColorSpace(.sRGB) ?? primary).getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        let top = NSColor(hue: hue, saturation: min(1, saturation * 1.1), brightness: min(1, brightness * 1.6), alpha: 1)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let body = CGRect(x: 100 * k, y: 100 * k, width: 824 * k, height: 824 * k)
        let shape = CGPath(roundedRect: body, cornerWidth: 185 * k, cornerHeight: 185 * k, transform: nil)

        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -12 * k), blur: 28 * k, color: NSColor.black.withAlphaComponent(0.38).cgColor)
        ctx.addPath(shape); ctx.setFillColor(bottom.cgColor); ctx.fillPath()
        ctx.restoreGState()

        ctx.saveGState()
        ctx.addPath(shape); ctx.clip()
        if let gradient = CGGradient(colorsSpace: space, colors: [top.cgColor, bottom.cgColor] as CFArray, locations: [0, 1]) {
            ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: body.maxY), end: CGPoint(x: 0, y: body.minY), options: [])
        }
        if let glow = CGGradient(colorsSpace: space, colors: [accent.withAlphaComponent(0.16).cgColor, accent.withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1]) {
            let center = CGPoint(x: 512 * k, y: (1024 - 120) * k)
            ctx.drawRadialGradient(glow, startCenter: center, startRadius: 0, endCenter: center, endRadius: 640 * k, options: [])
        }
        ctx.restoreGState()

        let rim = CGPath(roundedRect: body.insetBy(dx: 1.5 * k, dy: 1.5 * k), cornerWidth: 183.5 * k, cornerHeight: 183.5 * k, transform: nil)
            .copy(strokingWithWidth: max(1, 3 * k), lineCap: .butt, lineJoin: .round, miterLimit: 10)
        ctx.saveGState()
        ctx.addPath(rim); ctx.clip()
        let light = accent.blended(withFraction: 0.45, of: .white) ?? accent
        if let gradient = CGGradient(colorsSpace: space, colors: [light.withAlphaComponent(0.45).cgColor, accent.withAlphaComponent(0.12).cgColor, accent.withAlphaComponent(0.05).cgColor] as CFArray, locations: [0, 0.35, 1]) {
            ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: body.maxY), end: CGPoint(x: 0, y: body.minY), options: [])
        }
        ctx.restoreGState()

        let side = body.width * 0.70
        let ratio = sygnet.size.height > 0 ? sygnet.size.width / sygnet.size.height : 1
        let width = ratio >= 1 ? side : side * ratio
        let height = ratio >= 1 ? side / ratio : side
        let target = CGRect(x: 512 * k - width / 2, y: 512 * k - height / 2, width: width, height: height)
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -6 * k), blur: 16 * k, color: NSColor.black.withAlphaComponent(0.45).cgColor)
        let previous = NSGraphicsContext.current
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        sygnet.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high.rawValue])
        NSGraphicsContext.current = previous
        ctx.restoreGState()
    }

    static func image(sygnet: NSImage, brand: BrandInfo, size: CGFloat = 1024) -> NSImage {
        NSImage(size: NSSize(width: size, height: size), flipped: false) { _ in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            draw(in: ctx, size: size, sygnet: sygnet, brand: brand)
            return true
        }
    }

    /// Bitmapa PNG w dokładnym rozmiarze w pikselach (zestaw ikon pakietu).
    static func png(sygnet: NSImage, brand: BrandInfo, pixels: Int) -> Data? {
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        draw(in: context.cgContext, size: CGFloat(pixels), sygnet: sygnet, brand: brand)
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }
}
