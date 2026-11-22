import AVFoundation
import CoreGraphics
import CoreMedia
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

// MARK: Materiały — dane pliku przed wysyłką (wspólne dla aplikacji i rozszerzenia Findera)
//
// Miniatura JPEG do 640 px (zdjęcie, klatka wideo, pierwsza strona PDF), wymiary, czas trwania, typ MIME i skrót SHA-256 —
// to samo, co przygotowuje przeglądarka w CRM (`src/components/crm/materials/materialsApi.ts`). Błąd = bez miniatury (zdjęciom
// do 25 MB miniaturę zrobi serwer). Plik kompiluje się do aplikacji (SwiftPM) i do rozszerzenia (`scripts/build-app.sh`) —
// bez AppKit, tylko szkielety dostępne w rozszerzeniach.

enum MaterialMedia {
    struct Facts {
        var thumbnail: Data?
        var width: Int?
        var height: Int?
        var duration: Double?
    }

    /// Największy plik w Materiałach (jak `MATERIALS_MAX_FILE_BYTES`).
    static let maxBytes: Int64 = 2 * 1024 * 1024 * 1024
    static let thumbSide: CGFloat = 640

    /// Typ MIME z nazwy pliku (Finder podaje treść w pliku tymczasowym bez rozszerzenia — liczy się nazwa elementu).
    static func mime(forName name: String) -> String {
        UTType(filenameExtension: (name as NSString).pathExtension.lowercased())?.preferredMIMEType ?? "application/octet-stream"
    }

    static func size(of url: URL) -> Int64 {
        Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }

    /// Miniatura, wymiary i czas trwania (zdjęcia, wideo, dźwięk, PDF); dla pozostałych plików — puste. Rodzaj z `name`
    /// (nazwa elementu), a bez niej — z rozszerzenia pliku.
    static func facts(for url: URL, name: String? = nil) async -> Facts {
        let ext = ((name ?? url.lastPathComponent) as NSString).pathExtension.lowercased()
        let type = UTType(filenameExtension: ext) ?? .data
        if type.conforms(to: .image) { return image(url) }
        if type.conforms(to: .pdf) { return pdf(url) }
        if type.conforms(to: .audio) { return await movie(url, video: false) }
        if type.conforms(to: .movie) || type.conforms(to: .video) || type.conforms(to: .audiovisualContent) { return await movie(url, video: true) }
        return Facts()
    }

    /// SHA-256 treści (szesnastkowo), czytane po 4 MB.
    static func sha256(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 4 * 1024 * 1024), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Rodzaje

    private static func image(_ url: URL) -> Facts {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return Facts() }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        var width = (properties?[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue
        var height = (properties?[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue
        // Orientacja EXIF 5–8 — zdjęcie obrócone o 90°: wymiary jak po obróceniu (tak pokazuje je przeglądarka).
        if let orientation = (properties?[kCGImagePropertyOrientation] as? NSNumber)?.intValue, (5...8).contains(orientation) {
            swap(&width, &height)
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(thumbSide),
        ]
        let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).flatMap { jpeg($0) }
        return Facts(thumbnail: thumbnail, width: width, height: height, duration: nil)
    }

    private static func movie(_ url: URL, video: Bool) async -> Facts {
        let asset = AVURLAsset(url: url)
        var facts = Facts()
        if let duration = try? await asset.load(.duration), duration.isNumeric, duration.seconds.isFinite, duration.seconds >= 0 {
            facts.duration = duration.seconds
        }
        guard video else { return facts }
        if let tracks = try? await asset.loadTracks(withMediaType: .video), let track = tracks.first,
           let loaded = try? await track.load(.naturalSize, .preferredTransform) {
            let rect = CGRect(origin: .zero, size: loaded.0).applying(loaded.1)
            let w = Int(abs(rect.width).rounded()), h = Int(abs(rect.height).rounded())
            if w > 0, h > 0 { facts.width = w; facts.height = h }
        }
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: thumbSide, height: thumbSide)
        let at = CMTime(seconds: min(1, (facts.duration ?? 0) / 2), preferredTimescale: 600)
        if let frame = try? await generator.image(at: at) { facts.thumbnail = jpeg(frame.image) }
        return facts
    }

    private static func pdf(_ url: URL) -> Facts {
        guard let document = CGPDFDocument(url as CFURL), let page = document.page(at: 1) else { return Facts() }
        var box = page.getBoxRect(.cropBox)
        if abs(page.rotationAngle) % 180 == 90 { box = CGRect(x: 0, y: 0, width: box.height, height: box.width) }
        guard box.width > 0, box.height > 0 else { return Facts() }
        let scale = min(2, thumbSide / max(box.width, box.height))
        let width = max(1, Int((box.width * scale).rounded(.up)))
        let height = max(1, Int((box.height * scale).rounded(.up)))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return Facts() }
        let target = CGRect(x: 0, y: 0, width: width, height: height)
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(target)
        // Przekształcenie strony (obrót, przycięcie) do rozmiaru miniatury; małe strony powiększamy ręcznie.
        let natural = page.getBoxRect(.cropBox)
        if max(natural.width, natural.height) < thumbSide {
            context.scaleBy(x: scale, y: scale)
            context.concatenate(page.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: box.width, height: box.height), rotate: 0, preserveAspectRatio: true))
        } else {
            context.concatenate(page.getDrawingTransform(.cropBox, rect: target, rotate: 0, preserveAspectRatio: true))
        }
        context.drawPDFPage(page)
        return Facts(thumbnail: context.makeImage().flatMap { jpeg($0) }, width: nil, height: nil, duration: nil)
    }

    // MARK: JPEG

    /// JPEG (jakość 0,82) na białym tle — przezroczystość PNG nie zamienia się w czarne tło.
    static func jpeg(_ image: CGImage) -> Data? {
        let width = image.width, height = image.height
        guard width > 0, height > 0,
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(rect)
        context.interpolationQuality = .high
        context.draw(image, in: rect)
        guard let flat = context.makeImage() else { return nil }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, flat, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }
}
