import AppKit
import SwiftUI

// MARK: Kartka A4 szablonu umowy — tekst TextKit 1 w stylach dokumentu jak w edytorze CRM (`buildContractEditorCss`):
// marginesy jak w PDF, numeracja 1. / 1.1 / a. rysowana przy punktach, pola `{{…}}` i „§n” podświetlone, miejsca na
// klauzule jako ramki, sekcje warunkowe z paskiem i etykietą na marginesie, tabele (NSTextTable). Każdy akapit niesie
// swoje miejsce w dokumencie (`ContractParagraphInfo`), a znaki — formatowanie (`ContractMarksBox`); czcionki, odstępy,
// wcięcia i numery wylicza `ContractFormatter` po każdej zmianie (tylko tam, gdzie coś się zmieniło).

extension NSAttributedString.Key {
    /// Miejsce akapitu w dokumencie (`ContractParagraphInfo`) — na całym akapicie razem ze znakiem końca akapitu.
    static let contractBlock = NSAttributedString.Key("pl.mavinci.contract.block")
    /// Formatowanie znaków (`ContractMarksBox`): pogrubienie, kursywa, podkreślenie, przekreślenie, kolor, czcionka.
    static let contractMarks = NSAttributedString.Key("pl.mavinci.contract.marks")
    /// Miejsce na klauzule albo linia pozioma (`ContractObjectBox`) na znaku załącznika.
    static let contractObject = NSAttributedString.Key("pl.mavinci.contract.object")
    /// Adres obrazu w treści (znak załącznika).
    static let contractImage = NSAttributedString.Key("pl.mavinci.contract.image")
    /// Styl dokumentu wyliczony dla akapitu (Tytuł, Punkt…) — do galerii stylów i odświeżania czcionek.
    static let contractStyleID = NSAttributedString.Key("pl.mavinci.contract.style")
    /// Pole umowy (`{{nazwa}}` albo `§n`).
    static let contractField = NSAttributedString.Key("pl.mavinci.contract.field")
}

/// Miejsce akapitu: znacznik (`p`, `h1`…), własne atrybuty (`data-style`, `style`, `data-contract-if`…) i ścieżka
/// kontenerów (sekcja, punkt listy, komórka tabeli). Niezmienne — zmiana to nowy obiekt.
final class ContractParagraphInfo: NSObject {
    let tag: String
    let attributes: [String: String]
    let path: [ContractContainer]

    init(tag: String = "p", attributes: [String: String] = [:], path: [ContractContainer] = []) {
        self.tag = tag
        self.attributes = attributes
        self.path = path
    }

    func with(tag: String? = nil, attributes: [String: String]? = nil, path: [ContractContainer]? = nil) -> ContractParagraphInfo {
        ContractParagraphInfo(tag: tag ?? self.tag, attributes: attributes ?? self.attributes, path: path ?? self.path)
    }

    override func isEqual(_ object: Any?) -> Bool {
        guard let other = object as? ContractParagraphInfo else { return false }
        return other === self || (other.tag == tag && other.attributes == attributes && other.path == path)
    }

    override var hash: Int {
        var hasher = Hasher()
        hasher.combine(tag)
        hasher.combine(attributes)
        hasher.combine(path)
        return hasher.finalize()
    }
}

final class ContractMarksBox: NSObject {
    let marks: ContractInlineMarks
    static let plain = ContractMarksBox(ContractInlineMarks())

    init(_ marks: ContractInlineMarks) {
        self.marks = marks
    }

    override func isEqual(_ object: Any?) -> Bool { (object as? ContractMarksBox)?.marks == marks }
    override var hash: Int { marks.hashValue }
}

final class ContractObjectBox: NSObject {
    let content: ContractFlatContent

    init(_ content: ContractFlatContent) {
        self.content = content
    }
}

/// Wymiary strony jak w PDF (`contract-editor-sheet`: A4, marginesy 20 / 25 / 25 mm) w punktach typograficznych.
enum ContractPage {
    static let mm: CGFloat = 72 / 25.4
    static let width: CGFloat = 210 * mm
    static let height: CGFloat = 297 * mm
    static let marginX: CGFloat = 25 * mm
    static let marginTop: CGFloat = 20 * mm
    static var contentWidth: CGFloat { width - 2 * marginX }
    /// Powiększenie, przy którym kartka ma rozmiar jak w CRM w przeglądarce (CSS: 1 pt = 4/3 px).
    static let browserScale: CGFloat = 96 / 72
}

struct ContractRenderContext {
    var styles: ContractDocumentStyles
    let fieldLabels: [String: String]
    let slotLabels: [String: String]
    let options: [ContractOptionItem]
}

enum ContractFonts {
    private static var cache: [String: NSFont] = [:]

    /// Pierwsza dostępna rodzina z listy CSS („Arial, sans-serif”); ogólne nazwy jak w przeglądarce na Macu.
    static func font(family: String, size: CGFloat, bold: Bool, italic: Bool) -> NSFont {
        let key = "\(family)|\(size)|\(bold)|\(italic)"
        if let cached = cache[key] { return cached }
        let names = family.split(separator: ",").map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " '\"")) }.filter { !$0.isEmpty }
        var base: NSFont?
        for name in names {
            let lower = name.lowercased()
            let candidate = lower == "sans-serif" ? "Helvetica" : lower == "serif" ? "Times New Roman" : lower == "monospace" ? "Menlo" : name
            if let found = NSFontManager.shared.font(withFamily: candidate, traits: [], weight: 5, size: size) { base = found; break }
        }
        var result = base ?? NSFont.systemFont(ofSize: size)
        if bold { result = NSFontManager.shared.convert(result, toHaveTrait: .boldFontMask) }
        if italic { result = NSFontManager.shared.convert(result, toHaveTrait: .italicFontMask) }
        cache[key] = result
        return result
    }
}

enum ContractColors {
    /// Kolor CSS: `#rgb`, `#rrggbb`, `rgb(…)`; inny lub błędny — czarny.
    static func color(_ value: String?) -> NSColor {
        guard var text = value?.trimmingCharacters(in: .whitespaces).lowercased(), !text.isEmpty else { return .black }
        if text.hasPrefix("rgb") {
            let numbers = text.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted).compactMap { Double($0) }
            guard numbers.count >= 3 else { return .black }
            return NSColor(srgbRed: numbers[0] / 255, green: numbers[1] / 255, blue: numbers[2] / 255, alpha: numbers.count > 3 ? numbers[3] : 1)
        }
        if text.hasPrefix("#") { text.removeFirst() }
        if text.count == 3 { text = text.map { "\($0)\($0)" }.joined() }
        guard text.count >= 6, let number = UInt32(text.prefix(6), radix: 16) else { return .black }
        return NSColor(srgbRed: CGFloat((number >> 16) & 255) / 255, green: CGFloat((number >> 8) & 255) / 255, blue: CGFloat(number & 255) / 255, alpha: 1)
    }
    static let condition = NSColor(srgbRed: 0.49, green: 0.36, blue: 0.76, alpha: 1)
    static let slot = NSColor(srgbRed: 0.16, green: 0.36, blue: 0.72, alpha: 1)
    static let field = NSColor(srgbRed: 0.83, green: 0.73, blue: 0.45, alpha: 0.32)
}

// MARK: Układ strony (logo w nagłówku, stopka) — `page_settings` jak zakładka „Układ” w CRM

struct ContractPageLayout: Codable, Equatable {
    struct Footer: Codable, Equatable {
        var companyName: String
        var tagline: String
        var website: String
        var email: String
        var phone: String
        var logoUrl: String
    }

    var selectedLogo: String
    var logoScale: Double
    var logoPositionX: Double
    var logoPositionY: Double
    var selectedFooter: String
    var selectedFooterTemplateId: String?
    var footerContent: Footer
    var footerLogoScale: Double

    static let defaultLogo = "/erulers_logo_vect.png"
    static let standard = ContractPageLayout(
        selectedLogo: defaultLogo, logoScale: 80, logoPositionX: 50, logoPositionY: 0, selectedFooter: "default", selectedFooterTemplateId: nil,
        footerContent: Footer(companyName: "EVENT RULERS", tagline: "Więcej niż Wodzireje!", website: "www.eventrulers.pl",
                              email: "biuro@eventrulers.pl", phone: "698-212-279", logoUrl: defaultLogo),
        footerLogoScale: 80)
}

/// Obrazy w treści i w nagłówku/stopce: pamięć podręczna i pobieranie w tle (po pobraniu — powiadomienie `loaded`).
final class ContractImageStore: @unchecked Sendable {
    static let shared = ContractImageStore()
    static let loaded = Notification.Name("pl.mavinci.contract.imageLoaded")
    private let cache = NSCache<NSURL, NSImage>()
    private let lock = NSLock()
    private var requested = Set<URL>()

    /// Adres obrazu jak w PDF: ścieżka w serwisie (`/logo.png`) — z mavinci.pl, inaczej http(s).
    static func url(_ address: String) -> URL? {
        let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("/") && !text.hasPrefix("//") { return URL(string: "https://mavinci.pl" + text) }
        let lower = text.lowercased()
        guard lower.hasPrefix("https://") || lower.hasPrefix("http://") else { return nil }
        return URL(string: text)
    }

    /// Szerokość obrazu w punktach jak w przeglądarce (1 px CSS = 0,75 pt).
    static func cssWidth(_ image: NSImage) -> CGFloat {
        let pixels = image.representations.map(\.pixelsWide).max() ?? 0
        return pixels > 0 ? CGFloat(pixels) * 0.75 : image.size.width
    }

    static func aspect(_ image: NSImage) -> CGFloat {
        image.size.width > 0 ? image.size.height / image.size.width : 0.3
    }

    func image(_ address: String) -> NSImage? {
        guard let url = Self.url(address) else { return nil }
        if let image = cache.object(forKey: url as NSURL) { return image }
        lock.lock()
        let start = requested.insert(url).inserted
        lock.unlock()
        guard start else { return nil }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data, let image = NSImage(data: data) else { return }
            self.cache.setObject(image, forKey: url as NSURL)
            DispatchQueue.main.async { NotificationCenter.default.post(name: ContractImageStore.loaded, object: nil) }
        }.resume()
        return nil
    }

    /// Obraz wysłany z Maca — od razu w pamięci (bez ponownego pobierania).
    func put(_ image: NSImage, for address: String) {
        guard let url = Self.url(address) else { return }
        cache.setObject(image, forKey: url as NSURL)
    }
}

// MARK: Miejsce na klauzule, linia, obraz — rysowane w tekście

final class ContractObjectCell: NSTextAttachmentCell {
    enum Kind {
        case slot(String)
        case rule
        case image
        /// Obraz w treści: adres, szerokość w % szerokości tekstu (`nil` — naturalna), wyrównanie.
        case picture(source: String, width: Double?, align: String)
    }

    let kind: Kind

    init(kind: Kind) {
        self.kind = kind
        super.init(textCell: "")
    }

    required init(coder: NSCoder) {
        kind = .rule
        super.init(coder: coder)
    }

    private var height: CGFloat {
        switch kind {
        case .slot: return 20
        case .rule: return 6
        case .image: return 14
        case .picture: return 40
        }
    }

    /// Szerokość rysowanego obrazu w dostępnej szerokości wiersza.
    private func pictureWidth(_ image: NSImage?, width: Double?, available: CGFloat) -> CGFloat {
        if let width { return available * CGFloat(width) / 100 }
        return min(available, image.map(ContractImageStore.cssWidth) ?? available * 0.4)
    }

    /// Ramka na całą szerokość wiersza (od wcięcia do prawego marginesu).
    override func cellFrame(for textContainer: NSTextContainer, proposedLineFragment lineFrag: NSRect, glyphPosition position: NSPoint, characterIndex charIndex: Int) -> NSRect {
        switch kind {
        case .image: return NSRect(x: 0, y: -2, width: 44, height: height)
        case .slot: return NSRect(x: 0, y: -5, width: max(40, lineFrag.width - position.x - 2), height: height)
        case .rule: return NSRect(x: 0, y: 0, width: max(40, lineFrag.width - position.x - 2), height: height)
        case .picture(let source, let width, _):
            let available = max(40, lineFrag.width - position.x - 2)
            let image = ContractImageStore.shared.image(source)
            let drawn = pictureWidth(image, width: width, available: available)
            let tall = image.map { drawn * ContractImageStore.aspect($0) } ?? height
            return NSRect(x: 0, y: 0, width: available, height: max(8, tall))
        }
    }

    override func draw(withFrame cellFrame: NSRect, in controlView: NSView?) {
        switch kind {
        case .slot(let label):
            let path = NSBezierPath(roundedRect: cellFrame.insetBy(dx: 0.5, dy: 0.5), xRadius: 3, yRadius: 3)
            path.setLineDash([3, 2], count: 2, phase: 0)
            ContractColors.slot.withAlphaComponent(0.06).setFill()
            path.fill()
            ContractColors.slot.withAlphaComponent(0.7).setStroke()
            path.stroke()
            ("Klauzule produktów: \(label)" as NSString).draw(at: NSPoint(x: cellFrame.minX + 7, y: cellFrame.minY + 4), withAttributes: [
                .font: NSFont.systemFont(ofSize: 8, weight: .semibold),
                .foregroundColor: ContractColors.slot,
            ])
        case .rule:
            NSColor.black.setFill()
            NSRect(x: cellFrame.minX, y: cellFrame.midY - 0.375, width: cellFrame.width, height: 0.75).fill()
        case .picture(let source, let width, let align):
            let image = ContractImageStore.shared.image(source)
            let drawn = pictureWidth(image, width: width, available: cellFrame.width)
            let x = align == "center" ? cellFrame.minX + (cellFrame.width - drawn) / 2 : align == "right" ? cellFrame.maxX - drawn : cellFrame.minX
            let rect = NSRect(x: x, y: cellFrame.minY, width: drawn, height: cellFrame.height)
            if let image {
                image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            } else {
                let path = NSBezierPath(rect: rect.insetBy(dx: 0.5, dy: 0.5))
                path.setLineDash([3, 2], count: 2, phase: 0)
                NSColor.gray.setStroke()
                path.stroke()
                ("Wczytywanie obrazu…" as NSString).draw(at: NSPoint(x: rect.minX + 6, y: rect.minY + 4), withAttributes: [
                    .font: NSFont.systemFont(ofSize: 7), .foregroundColor: NSColor.gray,
                ])
            }
        case .image:
            NSColor.gray.setStroke()
            NSBezierPath(rect: cellFrame.insetBy(dx: 0.5, dy: 0.5)).stroke()
            ("obraz" as NSString).draw(at: NSPoint(x: cellFrame.minX + 6, y: cellFrame.minY + 2), withAttributes: [
                .font: NSFont.systemFont(ofSize: 7), .foregroundColor: NSColor.gray,
            ])
        }
    }
}

// MARK: Akapity → tekst

enum ContractDocumentBuilder {
    static func build(_ paragraphs: [ContractFlatParagraph], context: ContractRenderContext) -> NSMutableAttributedString {
        let output = NSMutableAttributedString()
        for paragraph in paragraphs {
            let start = output.length
            switch paragraph.content {
            case .text(let inlines):
                for inline in inlines {
                    switch inline {
                    case .text(let text, let marks):
                        output.append(NSAttributedString(string: text, attributes: [.contractMarks: ContractMarksBox(marks)]))
                    case .lineBreak:
                        output.append(NSAttributedString(string: "\u{2028}", attributes: [.contractMarks: ContractMarksBox.plain]))
                    case .image(let source):
                        output.append(image(source))
                    }
                }
            case .slot, .rule, .image:
                output.append(object(paragraph.content, context: context))
            }
            output.append(NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain]))
            let info = ContractParagraphInfo(tag: paragraph.tag, attributes: paragraph.attributes, path: paragraph.path)
            output.addAttribute(.contractBlock, value: info, range: NSRange(location: start, length: output.length - start))
        }
        return output
    }

    /// Znak miejsca na klauzule albo linii poziomej (bez znaku końca akapitu).
    static func object(_ content: ContractFlatContent, context: ContractRenderContext) -> NSAttributedString {
        let attachment = NSTextAttachment()
        switch content {
        case .slot(let name, _): attachment.attachmentCell = ContractObjectCell(kind: .slot(context.slotLabels[name] ?? name))
        case .rule: attachment.attachmentCell = ContractObjectCell(kind: .rule)
        case .image(let attributes):
            attachment.attachmentCell = ContractObjectCell(kind: .picture(source: attributes["src"] ?? "", width: ContractImageLayout.widthPercent(attributes),
                                                                          align: ContractImageLayout.alignment(attributes)))
        case .text: attachment.attachmentCell = ContractObjectCell(kind: .image)
        }
        let result = NSMutableAttributedString(attachment: attachment)
        result.addAttributes([.contractObject: ContractObjectBox(content), .contractMarks: ContractMarksBox.plain], range: NSRange(location: 0, length: result.length))
        return result
    }

    private static func image(_ source: String) -> NSAttributedString {
        let attachment = NSTextAttachment()
        attachment.attachmentCell = ContractObjectCell(kind: .image)
        let result = NSMutableAttributedString(attachment: attachment)
        result.addAttributes([.contractImage: source, .contractMarks: ContractMarksBox.plain], range: NSRange(location: 0, length: result.length))
        return result
    }
}

// MARK: Tekst → akapity (do zapisu)

enum ContractDocumentSerializer {
    static func paragraphs(_ storage: NSAttributedString) -> [ContractFlatParagraph] {
        let string = storage.string as NSString
        var result: [ContractFlatParagraph] = []
        var location = 0
        var previous = ContractParagraphInfo()
        while location < string.length {
            var start = 0
            var end = 0
            var contentsEnd = 0
            string.getParagraphStart(&start, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: location, length: 0))
            location = max(end, location + 1)
            let anchor = contentsEnd < end ? contentsEnd : start
            let info = storage.attribute(.contractBlock, at: anchor, effectiveRange: nil) as? ContractParagraphInfo ?? previous
            previous = info
            var inlines: [ContractInline] = []
            var emitted = false
            if contentsEnd > start {
                storage.enumerateAttributes(in: NSRange(location: start, length: contentsEnd - start), options: []) { attributes, run, _ in
                    let text = string.substring(with: run)
                    if let object = attributes[.contractObject] as? ContractObjectBox, text == "\u{FFFC}" {
                        if !inlines.isEmpty {
                            result.append(ContractFlatParagraph(content: .text(merge(inlines)), tag: info.tag, attributes: info.attributes, path: info.path))
                            inlines = []
                        }
                        result.append(ContractFlatParagraph(content: object.content, tag: "div", attributes: [:], path: info.path))
                        emitted = true
                        return
                    }
                    if let source = attributes[.contractImage] as? String, text == "\u{FFFC}" {
                        inlines.append(.image(source))
                        return
                    }
                    let marks = (attributes[.contractMarks] as? ContractMarksBox)?.marks ?? ContractInlineMarks()
                    for (index, part) in text.components(separatedBy: "\u{2028}").enumerated() {
                        if index > 0 { inlines.append(.lineBreak) }
                        let clean = part.replacingOccurrences(of: "\u{FFFC}", with: "")
                        if !clean.isEmpty { inlines.append(.text(clean, marks)) }
                    }
                }
            }
            if !inlines.isEmpty || !emitted {
                result.append(ContractFlatParagraph(content: .text(merge(inlines)), tag: info.tag, attributes: info.attributes, path: info.path))
            }
        }
        return result
    }

    private static func merge(_ inlines: [ContractInline]) -> [ContractInline] {
        var result: [ContractInline] = []
        for inline in inlines {
            if case .text(let text, let marks) = inline, case .text(let previous, let previousMarks)? = result.last, previousMarks == marks {
                result[result.count - 1] = .text(previous + text, marks)
            } else {
                result.append(inline)
            }
        }
        return result
    }
}

// MARK: Formatowanie (style dokumentu, wcięcia, numery, warunki)

final class ContractFormatter {
    struct Paragraph {
        let range: NSRange
        let contentsEnd: Int
        let info: ContractParagraphInfo
        let object: Bool
        var contentLength: Int { contentsEnd - range.location }
        var hasTerminator: Bool { contentsEnd < NSMaxRange(range) }
    }

    struct Marker {
        let location: Int
        let text: NSAttributedString
        let x: CGFloat
        let ascender: CGFloat
    }

    struct Condition {
        let range: NSRange
        let label: String
    }

    struct Decorations {
        var markers: [Marker] = []
        var conditions: [Condition] = []
    }

    var context: ContractRenderContext {
        didSet { conditionLabels = [:] }
    }
    private var tables: [Int: NSTextTable] = [:]
    private var tableColumns: [Int: Int] = [:]
    private var cells: [String: NSTextTableBlock] = [:]
    private var conditionLabels: [String: String] = [:]
    private let fieldPattern = try? NSRegularExpression(pattern: #"\{\{\s*([A-Za-z0-9_]+)\s*\}\}"#)
    private let paragraphPattern = try? NSRegularExpression(pattern: #"§\s*n\b"#)

    init(context: ContractRenderContext) {
        self.context = context
    }

    /// Akapity tekstu z ich miejscem w dokumencie. Miejsce akapitu bierze się ze znaku końca akapitu (pisanie w pustym
    /// akapicie nie przenosi go do poprzedniego); `repair` ujednolica je na całym akapicie.
    static func paragraphs(_ storage: NSTextStorage, repair: Bool) -> [Paragraph] {
        let string: NSString = storage.mutableString
        var result: [Paragraph] = []
        var location = 0
        var previous: ContractParagraphInfo?
        while location < string.length {
            var start = 0
            var end = 0
            var contentsEnd = 0
            string.getParagraphStart(&start, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: location, length: 0))
            let range = NSRange(location: start, length: end - start)
            let anchor = contentsEnd < end ? contentsEnd : start
            let info = storage.attribute(.contractBlock, at: anchor, effectiveRange: nil) as? ContractParagraphInfo ?? previous ?? ContractParagraphInfo()
            if repair, range.length > 0 {
                var effective = NSRange(location: 0, length: 0)
                let current = storage.attribute(.contractBlock, at: start, longestEffectiveRange: &effective, in: range) as? ContractParagraphInfo
                if current?.isEqual(info) != true || effective != range { storage.addAttribute(.contractBlock, value: info, range: range) }
            }
            let object = contentsEnd - start == 1 && string.character(at: start) == 0xFFFC
                && storage.attribute(.contractObject, at: start, effectiveRange: nil) != nil
            result.append(Paragraph(range: range, contentsEnd: contentsEnd, info: info, object: object))
            previous = info
            location = max(end, location + 1)
        }
        return result
    }

    static func roles(_ paragraphs: [Paragraph], string: NSString) -> [ContractParagraphRole] {
        ContractStructure.analyze(paths: paragraphs.map { $0.info.path }, attributes: paragraphs.map { $0.info.attributes }) { index in
            let paragraph = paragraphs[index]
            guard !paragraph.object, paragraph.contentLength > 0, paragraph.contentLength < 200 else { return false }
            return ContractStructure.isPlaceholder(string.substring(with: NSRange(location: paragraph.range.location, length: paragraph.contentLength)))
        }
    }

    /// Formatowanie całego tekstu: styl akapitu (odstępy, wcięcia, wyrównanie, tabela) wszędzie, gdzie się zmienił;
    /// czcionki i pola — w zmienionym zakresie `edited` (`nil` — wszędzie) i w akapitach, którym zmienił się styl.
    func format(_ storage: NSTextStorage, edited: NSRange?) -> Decorations {
        let entries = Self.paragraphs(storage, repair: true)
        let text = storage.string
        let string = text as NSString
        let roles = Self.roles(entries, string: string)
        prepareTables(entries)
        var decorations = Decorations()
        var previousAfter: CGFloat = 0
        var previousInCell = false
        var condition: (start: Int, end: Int, label: String)?
        for (index, entry) in entries.enumerated() {
            let role = roles[index]
            let style = context.styles.style(role.styleID)
            let size = CGFloat(style.fontSizePt)

            var indent: CGFloat = 0
            var outer: CGFloat = 0
            var blocks: [NSTextBlock] = []
            for (depth, container) in entry.info.path.enumerated() {
                switch container {
                case .item:
                    let levelStyle = context.styles.style(depth < role.levelStyles.count ? role.levelStyles[depth] ?? "point" : "point")
                    let section = depth < role.levelSections.count && role.levelSections[depth]
                    outer = indent
                    indent += max(CGFloat(levelStyle.indentPt), section ? 18 : 14)
                case .cell(let cell):
                    indent = 0
                    outer = 0
                    if let block = cells[Self.cellKey(cell)] { blocks.append(block) }
                case .section:
                    break
                }
            }
            if !role.inItem && !role.inCell && !entry.object && role.styleID == "body" { indent += CGFloat(style.indentPt) }

            var before = CGFloat(style.spaceBeforePt)
            var after = CGFloat(style.spaceAfterPt)
            if entry.object {
                switch (storage.attribute(.contractObject, at: entry.range.location, effectiveRange: nil) as? ContractObjectBox)?.content {
                case .slot?: (before, after) = (3, 3)
                case .image?: (before, after) = (2, 4)
                default: (before, after) = (0, 0)
                }
            } else if role.inItem {
                if role.firstInItem {
                    after = role.section ? after : (role.lastInItem ? after : 0)
                } else {
                    before = 0
                    after = role.lastInItem && !role.section ? after : 0
                }
            } else if role.inCell {
                before = 0
                after = 0
            }
            if previousInCell && !role.inCell { previousAfter = 0 }

            let own = Dictionary(ContractHTMLParser.declarations(entry.info.attributes["style"] ?? ""), uniquingKeysWith: { _, last in last })
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = Self.alignment(own["text-align"] ?? style.textAlign)
            if !entry.object { paragraph.minimumLineHeight = size * CGFloat(style.lineHeight) }
            paragraph.paragraphSpacingBefore = max(0, before - previousAfter)
            paragraph.paragraphSpacing = after
            var first = indent
            if role.inItem, role.firstInItem, let marker = role.marker {
                let font = ContractFonts.font(family: style.fontFamily, size: size, bold: style.bold, italic: style.italic)
                let text = NSAttributedString(string: marker, attributes: [.font: font, .foregroundColor: ContractColors.color(style.color)])
                let width = ceil(text.size().width)
                decorations.markers.append(Marker(location: entry.range.location, text: text, x: outer, ascender: font.ascender))
                if outer + width + 3 > indent { first = outer + width + 4 }
            }
            paragraph.firstLineHeadIndent = first
            paragraph.headIndent = indent
            paragraph.textBlocks = blocks
            previousAfter = after
            previousInCell = role.inCell

            let range = entry.range
            if range.length > 0 {
                let last = NSMaxRange(range) - 1
                let existing = storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle
                let existingLast = storage.attribute(.paragraphStyle, at: last, effectiveRange: nil) as? NSParagraphStyle
                if existing?.isEqual(paragraph) != true || existingLast?.isEqual(paragraph) != true {
                    storage.addAttribute(.paragraphStyle, value: paragraph, range: range)
                }
                var refresh = edited.map { NSIntersectionRange($0, range).length > 0 || NSLocationInRange($0.location, range) } ?? true
                if storage.attribute(.contractStyleID, at: range.location, effectiveRange: nil) as? String != role.styleID
                    || storage.attribute(.contractStyleID, at: last, effectiveRange: nil) as? String != role.styleID {
                    storage.addAttribute(.contractStyleID, value: role.styleID, range: range)
                    refresh = true
                }
                if refresh { applyCharacters(storage, text: text, range: range, style: style) }
            }

            // Sekcje warunkowe: kolejne akapity z tym samym warunkiem — jeden pasek z etykietą.
            let label = role.conditions.map(describe).joined(separator: " · ")
            if let open = condition, open.label != label || open.end != range.location {
                decorations.conditions.append(Condition(range: NSRange(location: open.start, length: open.end - open.start), label: open.label))
                condition = nil
            }
            if !label.isEmpty {
                if let open = condition { condition = (open.start, NSMaxRange(range), label) } else { condition = (range.location, NSMaxRange(range), label) }
            }
        }
        if let open = condition {
            decorations.conditions.append(Condition(range: NSRange(location: open.start, length: open.end - open.start), label: open.label))
        }
        return decorations
    }

    private func describe(_ expression: String) -> String {
        if let cached = conditionLabels[expression] { return cached }
        let text = ContractConditionText.describe(expression, options: context.options, fieldLabels: context.fieldLabels)
        conditionLabels[expression] = text
        return text
    }

    static func alignment(_ value: String) -> NSTextAlignment {
        switch value {
        case "center": return .center
        case "right": return .right
        case "justify": return .justified
        default: return .left
        }
    }

    /// Czcionka i dekoracja znaków ze stylu akapitu i formatowania znaków; pola `{{…}}` i „§n” podświetlone.
    private func applyCharacters(_ storage: NSTextStorage, text: String, range: NSRange, style: ContractDocumentStyle) {
        storage.removeAttribute(.backgroundColor, range: range)
        storage.removeAttribute(.contractField, range: range)
        storage.removeAttribute(.toolTip, range: range)
        storage.enumerateAttribute(.contractMarks, in: range, options: []) { value, run, _ in
            let marks = (value as? ContractMarksBox)?.marks ?? ContractInlineMarks()
            storage.addAttributes(Self.characterAttributes(marks, style: style), range: run)
            if let link = marks.link { storage.addAttribute(.toolTip, value: link, range: run) }
        }
        if let fieldPattern {
            let source = text as NSString
            for match in fieldPattern.matches(in: text, range: range) {
                let name = source.substring(with: match.range(at: 1))
                storage.addAttributes([
                    .backgroundColor: ContractColors.field,
                    .contractField: name,
                    .toolTip: "Pole: \(context.fieldLabels[name] ?? name)",
                ], range: match.range)
            }
        }
        if let paragraphPattern {
            for match in paragraphPattern.matches(in: text, range: range) {
                storage.addAttributes([
                    .backgroundColor: ContractColors.field,
                    .contractField: "§n",
                    .toolTip: "Automatyczny numer paragrafu (§ 1, § 2… przy zapisie)",
                ], range: match.range)
            }
        }
    }

    static func characterAttributes(_ marks: ContractInlineMarks, style: ContractDocumentStyle) -> [NSAttributedString.Key: Any] {
        let size = CGFloat(marks.fontSizePt ?? style.fontSizePt)
        let font = ContractFonts.font(family: marks.fontFamily ?? style.fontFamily, size: size, bold: style.bold || marks.bold, italic: style.italic || marks.italic)
        return [
            .font: font,
            .foregroundColor: ContractColors.color(marks.color ?? style.color),
            .underlineStyle: style.underline || marks.underline || marks.link != nil ? NSUnderlineStyle.single.rawValue : 0,
            .strikethroughStyle: marks.strike ? NSUnderlineStyle.single.rawValue : 0,
        ]
    }

    // MARK: Tabele

    static func cellKey(_ cell: ContractCellLevel) -> String { "\(cell.tableID):\(cell.row):\(cell.column)" }

    private func prepareTables(_ entries: [Paragraph]) {
        var layout: [Int: [Int: [(column: Int, span: Int, rows: Int)]]] = [:]
        var seen = Set<String>()
        for entry in entries {
            for container in entry.info.path {
                guard case .cell(let cell) = container, seen.insert(Self.cellKey(cell)).inserted else { continue }
                let span = max(1, Int(cell.attributes["colspan"] ?? "") ?? 1)
                let rows = max(1, Int(cell.attributes["rowspan"] ?? "") ?? 1)
                layout[cell.tableID, default: [:]][cell.row, default: []].append((cell.column, span, rows))
            }
        }
        for (tableID, rows) in layout {
            let columns = max(1, rows.values.map { $0.reduce(0) { $0 + $1.span } }.max() ?? 1)
            if tables[tableID] == nil || tableColumns[tableID] != columns {
                let table = NSTextTable()
                table.numberOfColumns = columns
                table.layoutAlgorithm = .automaticLayoutAlgorithm
                table.collapsesBorders = true
                table.hidesEmptyCells = false
                table.setContentWidth(100, type: .percentageValueType)
                tables[tableID] = table
                tableColumns[tableID] = columns
                cells = cells.filter { !$0.key.hasPrefix("\(tableID):") }
            }
            guard let table = tables[tableID] else { continue }
            for (row, list) in rows {
                var position = 0
                for cell in list.sorted(by: { $0.column < $1.column }) {
                    let key = "\(tableID):\(row):\(cell.column)"
                    if cells[key] == nil, position < columns {
                        let block = NSTextTableBlock(table: table, startingRow: row, rowSpan: cell.rows, startingColumn: position, columnSpan: min(cell.span, columns - position))
                        block.setWidth(0.5, type: .absoluteValueType, for: .border)
                        block.setBorderColor(NSColor(white: 0.55, alpha: 0.35))
                        block.setWidth(2, type: .absoluteValueType, for: .padding)
                        block.verticalAlignment = .topAlignment
                        cells[key] = block
                    }
                    position += cell.span
                }
            }
        }
    }
}

// MARK: Numery punktów, pasek i etykieta sekcji warunkowych

final class ContractLayoutManager: NSLayoutManager {
    var decorations = ContractFormatter.Decorations()

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage, let container = textContainers.first, storage.length > 0 else { return }
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        for condition in decorations.conditions where NSMaxRange(condition.range) <= storage.length {
            let visible = NSIntersectionRange(condition.range, characters)
            guard visible.length > 0 else { continue }
            let glyphs = glyphRange(forCharacterRange: visible, actualCharacterRange: nil)
            var union = NSRect.null
            enumerateLineFragments(forGlyphRange: glyphs) { rect, _, _, _, _ in union = union.union(rect) }
            guard !union.isNull else { continue }
            let box = union.offsetBy(dx: origin.x, dy: origin.y)
            ContractColors.condition.withAlphaComponent(0.07).setFill()
            box.fill()
            ContractColors.condition.withAlphaComponent(0.6).setFill()
            NSRect(x: box.minX - 5, y: box.minY, width: 2, height: box.height).fill()
            guard visible.location == condition.range.location else { continue }
            let labelRect = NSRect(x: origin.x + container.size.width + 6, y: box.minY, width: ContractPage.marginX - 12, height: 60)
            (condition.label as NSString).draw(with: labelRect, options: [.usesLineFragmentOrigin], attributes: [
                .font: NSFont.systemFont(ofSize: 6.5, weight: .semibold),
                .foregroundColor: ContractColors.condition,
            ])
        }
        for marker in decorations.markers where NSLocationInRange(marker.location, characters) && marker.location < storage.length {
            let glyph = glyphIndexForCharacter(at: marker.location)
            let line = lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            let position = location(forGlyphAt: glyph)
            marker.text.draw(at: NSPoint(x: origin.x + line.minX + marker.x, y: origin.y + line.minY + position.y - marker.ascender))
        }
    }
}

// MARK: Kartka w oknie

/// Nagłówek strony jak w PDF (`buildContractHeaderHtml`): logo (rozmiar, położenie) i data „Olsztyn, …” w prawym górnym rogu.
final class ContractSheetHeaderView: NSView {
    var settings = ContractPageLayout.standard
    override var isFlipped: Bool { true }

    private var logo: NSImage? { ContractImageStore.shared.image(settings.selectedLogo) }

    private var logoSize: NSSize {
        guard let logo else { return NSSize(width: 0, height: 15 * ContractPage.mm) }
        let width = min(ContractImageStore.cssWidth(logo), ContractPage.contentWidth * CGFloat(settings.logoScale) / 100)
        return NSSize(width: width, height: width * ContractImageStore.aspect(logo))
    }

    var preferredHeight: CGFloat {
        ContractPage.marginTop + CGFloat(settings.logoPositionY) * ContractPage.mm + logoSize.height + 4 * ContractPage.mm
    }

    static let date: String = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.dateFormat = "d MMMM y"
        return "Olsztyn, " + formatter.string(from: Date())
    }()

    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill()
        bounds.fill()
        let size = logoSize
        let left = ContractPage.marginX
        let right = bounds.width - ContractPage.marginX
        let x = settings.logoPositionX <= 33 ? left : settings.logoPositionX >= 67 ? right - size.width : (bounds.width - size.width) / 2
        let rect = NSRect(x: x, y: ContractPage.marginTop + CGFloat(settings.logoPositionY) * ContractPage.mm, width: size.width, height: size.height)
        logo?.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        let date = NSAttributedString(string: Self.date, attributes: [
            .font: ContractFonts.font(family: "Arial, sans-serif", size: 10, bold: false, italic: false),
            .foregroundColor: NSColor(white: 0.2, alpha: 1),
        ])
        date.draw(at: NSPoint(x: right - date.size().width, y: ContractPage.marginTop))
    }
}

/// Stopka strony jak w PDF (`buildContractFooterHtml`): złota linia, logo po lewej (wariant pełny), dane firmy po prawej.
final class ContractSheetFooterView: NSView {
    var settings = ContractPageLayout.standard
    var fontFamily = "Georgia, serif"
    override var isFlipped: Bool { true }

    private var visible: Bool { settings.selectedFooter != "none" }
    private var logo: NSImage? {
        guard settings.selectedFooter != "minimal" else { return nil }
        let address = settings.footerContent.logoUrl.isEmpty ? settings.selectedLogo : settings.footerContent.logoUrl
        return ContractImageStore.shared.image(address)
    }

    private func info() -> NSAttributedString {
        let footer = settings.footerContent
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .right
        paragraph.paragraphSpacing = 3
        paragraph.lineHeightMultiple = 1.05
        let regular = ContractFonts.font(family: fontFamily, size: 10, bold: false, italic: false)
        let base: [NSAttributedString.Key: Any] = [.font: regular, .foregroundColor: NSColor(white: 0.2, alpha: 1), .paragraphStyle: paragraph]
        let result = NSMutableAttributedString()
        var bold = base
        bold[.font] = ContractFonts.font(family: fontFamily, size: 10, bold: true, italic: false)
        bold[.foregroundColor] = NSColor.black
        result.append(NSAttributedString(string: footer.companyName, attributes: bold))
        if !footer.tagline.isEmpty {
            var italic = base
            italic[.font] = ContractFonts.font(family: fontFamily, size: 10, bold: false, italic: true)
            italic[.foregroundColor] = NSColor(white: 0.4, alpha: 1)
            result.append(NSAttributedString(string: " – ", attributes: base))
            result.append(NSAttributedString(string: footer.tagline, attributes: italic))
        }
        let contact = [footer.website, footer.email].filter { !$0.isEmpty }.joined(separator: " | ")
        if !contact.isEmpty { result.append(NSAttributedString(string: "\n" + contact, attributes: base)) }
        if !footer.phone.isEmpty { result.append(NSAttributedString(string: "\ntel: " + footer.phone, attributes: base)) }
        return result
    }

    private var columnWidth: CGFloat { ContractPage.contentWidth / 2 }

    var preferredHeight: CGFloat {
        guard visible else { return 0 }
        let text = info().boundingRect(with: NSSize(width: columnWidth, height: 400), options: [.usesLineFragmentOrigin]).height
        return max(15 * ContractPage.mm, 3.75 + max(text + 4, logo == nil ? 0 : 37.5))
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill()
        bounds.fill()
        guard visible else { return }
        NSGraphicsContext.current?.saveGraphicsState()
        defer { NSGraphicsContext.current?.restoreGraphicsState() }
        let left = ContractPage.marginX
        let alpha: CGFloat = 0.7
        NSColor(srgbRed: 0.83, green: 0.73, blue: 0.45, alpha: alpha).setFill()
        NSRect(x: left, y: 0, width: ContractPage.contentWidth, height: 0.75).fill()
        if let logo {
            let maxWidth = columnWidth * CGFloat(settings.footerLogoScale) / 100
            var width = 37.5 / max(0.01, ContractImageStore.aspect(logo))
            width = min(width, maxWidth)
            let rect = NSRect(x: left, y: 3.75 + 2, width: width, height: width * ContractImageStore.aspect(logo))
            logo.draw(in: rect, from: .zero, operation: .sourceOver, fraction: alpha, respectFlipped: true, hints: nil)
        }
        let text = NSMutableAttributedString(attributedString: info())
        text.enumerateAttribute(.foregroundColor, in: NSRange(location: 0, length: text.length)) { value, range, _ in
            if let color = value as? NSColor { text.addAttribute(.foregroundColor, value: color.withAlphaComponent(alpha), range: range) }
        }
        text.draw(with: NSRect(x: left + columnWidth, y: 3.75 + 3, width: columnWidth, height: bounds.height), options: [.usesLineFragmentOrigin])
    }
}

/// Kartka (układ od góry: nagłówek, tekst, stopka).
final class ContractSheetPageView: NSView {
    override var isFlipped: Bool { true }
}

/// Dokument przewijania: biała kartka A4 (nagłówek z logo, tekst, stopka) wyśrodkowana na szarym tle, z cieniem.
final class ContractSheetDocumentView: NSView {
    let textView: NSTextView
    let page = ContractSheetPageView()
    let header = ContractSheetHeaderView()
    let footer = ContractSheetFooterView()
    let gutter: CGFloat = 28
    private let bottomPadding = 5 * ContractPage.mm
    override var isFlipped: Bool { true }

    init(textView: NSTextView) {
        self.textView = textView
        super.init(frame: NSRect(x: 0, y: 0, width: ContractPage.width + 56, height: ContractPage.height + 56))
        wantsLayer = true
        page.wantsLayer = true
        page.layer?.backgroundColor = NSColor.white.cgColor
        let shadow = NSShadow()
        shadow.shadowBlurRadius = 10
        shadow.shadowOffset = NSSize(width: 0, height: -2)
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
        page.shadow = shadow
        page.addSubview(header)
        page.addSubview(textView)
        page.addSubview(footer)
        addSubview(page)
    }

    required init?(coder: NSCoder) { nil }

    private var pageHeight: CGFloat {
        max(ContractPage.height, header.preferredHeight + textView.frame.height + footer.preferredHeight + bottomPadding)
    }

    /// Po zmianie układu (logo, stopka) albo pobraniu obrazu: wysokość nagłówka i stopki, minimalna wysokość tekstu.
    func refreshChrome(clipWidth: CGFloat) {
        let minimum = max(80, ContractPage.height - header.preferredHeight - footer.preferredHeight - bottomPadding)
        if abs(textView.minSize.height - minimum) > 0.5 {
            textView.minSize = NSSize(width: ContractPage.width, height: minimum)
            textView.sizeToFit()
        }
        header.needsDisplay = true
        footer.needsDisplay = true
        updateSize(clipWidth: clipWidth)
    }

    override func layout() {
        super.layout()
        let height = pageHeight
        let headerHeight = header.preferredHeight
        let footerHeight = footer.preferredHeight
        page.frame = NSRect(x: max(gutter, (bounds.width - ContractPage.width) / 2), y: gutter, width: ContractPage.width, height: height)
        header.frame = NSRect(x: 0, y: 0, width: ContractPage.width, height: headerHeight)
        textView.setFrameOrigin(NSPoint(x: 0, y: headerHeight))
        footer.frame = NSRect(x: 0, y: height - bottomPadding - footerHeight, width: ContractPage.width, height: footerHeight)
    }

    func updateSize(clipWidth: CGFloat) {
        let size = NSSize(width: max(clipWidth, ContractPage.width + gutter * 2), height: pageHeight + gutter * 2)
        if frame.size != size { setFrameSize(size) }
        needsLayout = true
    }
}

/// Pole tekstu kartki: wklejanie jako tekst (formatowanie z miejsca wklejenia), skróty edytora (⌘B, ⌘I, ⌘U, ⌘Z,
/// ⌘⌥0…4) obsługuje `ContractEditorController`.
final class ContractEditorTextView: NSTextView {
    weak var controller: ContractEditorController?

    override var readablePasteboardTypes: [NSPasteboard.PasteboardType] { [.string] }

    override func paste(_ sender: Any?) {
        if let controller, isEditable { controller.pastePlainText() } else { super.paste(sender) }
    }

    override func pasteAsPlainText(_ sender: Any?) { paste(sender) }
    override func pasteAsRichText(_ sender: Any?) { paste(sender) }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if window?.firstResponder === self, let controller, controller.handleKeyEquivalent(event) { return true }
        return super.performKeyEquivalent(with: event)
    }
}

struct ContractSheetView: NSViewRepresentable {
    let controller: ContractEditorController
    let magnification: CGFloat
    let pageLayout: ContractPageLayout
    let fontFamily: String

    final class Coordinator {
        var observers: [NSObjectProtocol] = []
        var layout: ContractLayoutManager?
        weak var document: ContractSheetDocumentView?
        weak var scroll: NSScrollView?
        var pageLayout: ContractPageLayout?
        var fontFamily: String?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSScrollView {
        let layout = ContractLayoutManager()
        controller.storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: ContractPage.contentWidth, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = false
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)

        let textView = ContractEditorTextView(frame: NSRect(x: 0, y: 0, width: ContractPage.width, height: ContractPage.height), textContainer: container)
        textView.textContainerInset = NSSize(width: ContractPage.marginX, height: 0)
        textView.isEditable = controller.editable
        textView.isSelectable = true
        textView.isRichText = true
        textView.importsGraphics = false
        textView.allowsUndo = false
        textView.usesFontPanel = false
        textView.usesRuler = false
        textView.smartInsertDeleteEnabled = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.drawsBackground = true
        textView.backgroundColor = .white
        textView.insertionPointColor = .black
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.minSize = NSSize(width: ContractPage.width, height: ContractPage.height / 2)
        textView.maxSize = NSSize(width: ContractPage.width, height: CGFloat.greatestFiniteMagnitude)
        textView.autoresizingMask = []
        textView.appearance = NSAppearance(named: .aqua)
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.postsFrameChangedNotifications = true
        textView.controller = controller
        textView.delegate = controller

        let document = ContractSheetDocumentView(textView: textView)
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = true
        scroll.backgroundColor = NSColor(calibratedWhite: 0.24, alpha: 1)
        scroll.allowsMagnification = true
        scroll.minMagnification = 0.5
        scroll.maxMagnification = 3
        scroll.documentView = document
        scroll.contentView.postsFrameChangedNotifications = true
        context.coordinator.document = document
        context.coordinator.layout = layout
        context.coordinator.scroll = scroll
        document.header.settings = pageLayout
        document.footer.settings = pageLayout
        document.footer.fontFamily = fontFamily
        context.coordinator.pageLayout = pageLayout
        context.coordinator.fontFamily = fontFamily
        let resize: @Sendable (Notification) -> Void = { [weak document, weak scroll] _ in
            MainActor.assumeIsolated {
                guard let document, let scroll else { return }
                document.updateSize(clipWidth: scroll.contentView.bounds.width)
            }
        }
        context.coordinator.observers = [
            NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: scroll.contentView, queue: .main, using: resize),
            NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: textView, queue: .main, using: resize),
            NotificationCenter.default.addObserver(forName: ContractImageStore.loaded, object: nil, queue: .main) { [weak document, weak scroll, weak layout, weak textView] _ in
                MainActor.assumeIsolated {
                    guard let document, let scroll else { return }
                    if let layout, let textView, let storage = layout.textStorage, let container = textView.textContainer {
                        layout.invalidateLayout(forCharacterRange: NSRange(location: 0, length: storage.length), actualCharacterRange: nil)
                        layout.ensureLayout(for: container)
                        textView.sizeToFit()
                        textView.needsDisplay = true
                    }
                    document.refreshChrome(clipWidth: scroll.contentView.bounds.width)
                }
            },
        ]
        controller.attach(textView: textView, layout: layout)
        layout.ensureLayout(for: container)
        textView.sizeToFit()
        scroll.magnification = magnification
        document.refreshChrome(clipWidth: scroll.contentView.bounds.width)
        DispatchQueue.main.async { [weak textView] in
            MainActor.assumeIsolated {
                guard let textView else { return }
                textView.window?.makeFirstResponder(textView)
            }
        }
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let document = context.coordinator.document else { return }
        if context.coordinator.pageLayout != pageLayout || context.coordinator.fontFamily != fontFamily {
            context.coordinator.pageLayout = pageLayout
            context.coordinator.fontFamily = fontFamily
            document.header.settings = pageLayout
            document.footer.settings = pageLayout
            document.footer.fontFamily = fontFamily
            document.refreshChrome(clipWidth: scroll.contentView.bounds.width)
        }
        if abs(scroll.magnification - magnification) > 0.001 {
            scroll.magnification = magnification
            document.updateSize(clipWidth: scroll.contentView.bounds.width)
        }
    }

    static func dismantleNSView(_ scroll: NSScrollView, coordinator: Coordinator) {
        coordinator.observers.forEach { NotificationCenter.default.removeObserver($0) }
        coordinator.observers = []
        if let layout = coordinator.layout { layout.textStorage?.removeLayoutManager(layout) }
        coordinator.layout = nil
    }
}
