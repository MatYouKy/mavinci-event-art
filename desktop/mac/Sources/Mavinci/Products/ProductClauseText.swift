import AppKit
import SwiftUI

// MARK: Treść klauzuli produktu na Macu — HTML jak po `normalizeContractClausePointListHtml` w CRM: każdy akapit to punkt umowy
// (numeracja 1., 1.1, 1.1.1 wynika z kolejności), „§n” to nagłówek paragrafu, a nagłówek (h1–h3) — tytuł; w tekście
// pogrubienie, kursywa i podkreślenie. Edycja w `NSTextView`: poziom punktu jest atrybutem akapitu, numery rysuje układ tekstu.

enum ClauseBlockKind: Int {
    case point = 0
    case heading = 1
    case title = 2
}

extension NSAttributedString.Key {
    static let clauseKind = NSAttributedString.Key("mavinci.clauseKind")
    static let clauseLevel = NSAttributedString.Key("mavinci.clauseLevel")
}

enum ClauseHTML {
    struct Run: Equatable {
        var text: String
        var bold = false
        var italic = false
        var underline = false
    }
    struct Block {
        var kind: ClauseBlockKind
        var level: Int
        var runs: [Run]
        var text: String { runs.map(\.text).joined() }
    }

    static let fontSize: CGFloat = 13
    static let lineSeparator = "\u{2028}"

    // MARK: HTML → bloki
    static func parse(_ html: String) -> [Block] {
        let source = html.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else { return [] }
        guard source.range(of: "<[a-zA-Z/][^>]*>", options: .regularExpression) != nil else {
            return source.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                .map { Block(kind: .point, level: 0, runs: [Run(text: $0)]) }
        }
        var blocks: [Block] = []
        var current: Block?
        var listDepth = 0
        var bold = 0, italic = 0, underline = 0, skip = 0
        var liOpen = 0

        func flush() {
            guard var block = current else { return }
            current = nil
            block.runs = block.runs.filter { !$0.text.isEmpty }
            while let last = block.runs.last, last.text.hasSuffix(lineSeparator) {
                block.runs[block.runs.count - 1].text.removeLast()
                if block.runs[block.runs.count - 1].text.isEmpty { block.runs.removeLast() }
            }
            let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            blocks.append(contentsOf: split(block))
        }
        func start(_ kind: ClauseBlockKind, _ level: Int) {
            flush()
            current = Block(kind: kind, level: max(0, min(2, level)), runs: [])
        }
        func append(_ text: String) {
            guard skip == 0, !text.isEmpty else { return }
            if current == nil {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
                start(.point, 0)
            }
            let run = Run(text: text, bold: bold > 0, italic: italic > 0, underline: underline > 0)
            if let last = current?.runs.last, last.bold == run.bold, last.italic == run.italic, last.underline == run.underline {
                current?.runs[current!.runs.count - 1].text += text
            } else {
                current?.runs.append(run)
            }
        }

        let pattern = try! NSRegularExpression(pattern: "<!--[\\s\\S]*?-->|<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>", options: [])
        let ns = source as NSString
        var cursor = 0
        for match in pattern.matches(in: source, range: NSRange(location: 0, length: ns.length)) {
            if match.range.location > cursor {
                append(collapse(decode(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))))
            }
            cursor = match.range.location + match.range.length
            guard match.range(at: 2).location != NSNotFound else { continue }
            let closing = ns.substring(with: match.range(at: 1)) == "/"
            let tag = ns.substring(with: match.range(at: 2)).lowercased()
            let attributes = match.range(at: 3).location == NSNotFound ? "" : ns.substring(with: match.range(at: 3))
            switch tag {
            case "script", "style":
                skip += closing ? -1 : 1
                skip = max(0, skip)
            case "ol", "ul":
                if closing { listDepth = max(0, listDepth - 1) } else {
                    // Lista zagnieżdżona w punkcie zaczyna podpunkty — tekst punktu nadrzędnego jest już kompletny.
                    if liOpen > 0 { flush() }
                    listDepth += 1
                }
            case "li":
                if closing {
                    flush()
                    liOpen = max(0, liOpen - 1)
                } else {
                    liOpen += 1
                    let indent = Int(firstMatch("ql-indent-(\\d+)", in: attributes) ?? "") ?? 0
                    start(.point, max(0, listDepth - 1) + indent)
                }
            case "p", "div", "blockquote":
                if closing {
                    if liOpen == 0 { flush() }
                } else if liOpen > 0 && current != nil && (current?.text.isEmpty ?? true) {
                    // Akapit wewnątrz punktu listy — ten sam punkt.
                } else {
                    let heading = attributes.contains("paragraphHeading") || attributes.contains("data-contract-paragraph")
                    let title = attributes.contains("data-clause-role=\"title\"")
                    start(heading ? .heading : title ? .title : .point, liOpen > 0 ? (current?.level ?? 0) : 0)
                }
            case "h1", "h2", "h3", "h4", "h5", "h6":
                if closing { flush() } else {
                    start(attributes.contains("paragraphHeading") ? .heading : .title, 0)
                }
            case "br":
                if !closing { append(lineSeparator) }
            case "strong", "b": bold += closing ? -1 : 1; bold = max(0, bold)
            case "em", "i": italic += closing ? -1 : 1; italic = max(0, italic)
            case "u": underline += closing ? -1 : 1; underline = max(0, underline)
            default: break
            }
        }
        if cursor < ns.length { append(collapse(decode(ns.substring(from: cursor)))) }
        flush()
        return blocks
    }

    /// „§n” w akapicie → nagłówek paragrafu; „§n Tytuł” → nagłówek i tytuł (jak normalizacja klauzul w CRM).
    private static func split(_ block: Block) -> [Block] {
        guard block.kind != .heading else { return [block] }
        let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.range(of: "^§\\s*(n|\\d+)$", options: [.regularExpression, .caseInsensitive]) != nil {
            return [Block(kind: .heading, level: 0, runs: [Run(text: text)])]
        }
        if let heading = firstMatch("^(§\\s*(?:n|\\d+))(?:[.\\-–—:]\\s*|\\s+)(\\S[\\s\\S]*)$", in: text, group: 1),
           let title = firstMatch("^(§\\s*(?:n|\\d+))(?:[.\\-–—:]\\s*|\\s+)(\\S[\\s\\S]*)$", in: text, group: 2) {
            return [Block(kind: .heading, level: 0, runs: [Run(text: heading)]), Block(kind: .title, level: 0, runs: [Run(text: title)])]
        }
        return [block]
    }

    private static func firstMatch(_ pattern: String, in text: String, group: Int = 1) -> String? {
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > group, let range = Range(match.range(at: group), in: text) else { return nil }
        return String(text[range])
    }

    private static func collapse(_ text: String) -> String {
        text.replacingOccurrences(of: "[\\t\\n\\r ]+", with: " ", options: .regularExpression)
    }

    static func decode(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var output = ""
        var index = text.startIndex
        while index < text.endIndex {
            if text[index] == "&", let end = text[index...].firstIndex(of: ";"), text.distance(from: index, to: end) <= 10 {
                let entity = String(text[text.index(after: index)..<end])
                var replacement: String?
                switch entity {
                case "amp": replacement = "&"
                case "lt": replacement = "<"
                case "gt": replacement = ">"
                case "quot": replacement = "\""
                case "apos", "#39": replacement = "'"
                case "nbsp": replacement = "\u{a0}"
                default:
                    if entity.hasPrefix("#x") || entity.hasPrefix("#X"), let code = UInt32(entity.dropFirst(2), radix: 16), let scalar = Unicode.Scalar(code) {
                        replacement = String(Character(scalar))
                    } else if entity.hasPrefix("#"), let code = UInt32(entity.dropFirst()), let scalar = Unicode.Scalar(code) {
                        replacement = String(Character(scalar))
                    }
                }
                if let replacement {
                    output += replacement
                    index = text.index(after: end)
                    continue
                }
            }
            output.append(text[index])
            index = text.index(after: index)
        }
        return output
    }

    // MARK: Bloki → HTML (postać kanoniczna klauzul)
    static func serialize(_ blocks: [Block]) -> String {
        var html = ""
        var index = 0
        while index < blocks.count {
            let block = blocks[index]
            switch block.kind {
            case .heading:
                html += "<p data-contract-paragraph=\"true\" data-clause-role=\"paragraphHeading\">\(inline(block.runs, plain: true))</p>"
                index += 1
            case .title:
                html += "<h3 data-clause-role=\"title\">\(inline(block.runs, plain: true))</h3>"
                index += 1
            case .point:
                var end = index
                while end < blocks.count && blocks[end].kind == .point { end += 1 }
                let items = Array(blocks[index..<end])
                var position = 0
                html += list(items, level: 0, position: &position)
                index = end
            }
        }
        return html
    }

    private static func list(_ items: [Block], level: Int, position: inout Int) -> String {
        var html = "<ol data-clause-marker=\"outline-decimal\">"
        while position < items.count {
            if items[position].level < level { break }
            html += "<li>" + inline(items[position].runs, plain: false)
            position += 1
            if position < items.count && items[position].level > level {
                html += list(items, level: level + 1, position: &position)
            }
            html += "</li>"
        }
        return html + "</ol>"
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\u{a0}", with: "&nbsp;").replacingOccurrences(of: lineSeparator, with: "<br>")
    }

    private static func inline(_ runs: [Run], plain: Bool) -> String {
        var html = ""
        for run in runs where !run.text.isEmpty {
            var text = escape(run.text)
            if run.underline { text = "<u>\(text)</u>" }
            if run.italic { text = "<em>\(text)</em>" }
            if run.bold && !plain { text = "<strong>\(text)</strong>" }
            html += text
        }
        return html.trimmingCharacters(in: .whitespaces)
    }

    // MARK: Bloki ↔ tekst w edytorze
    static func paragraphStyle(_ kind: ClauseBlockKind, _ level: Int) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.paragraphSpacing = 5
        style.lineSpacing = 1
        switch kind {
        case .point:
            let indent = ClauseNumbering.indent(level)
            style.firstLineHeadIndent = indent
            style.headIndent = indent
        case .heading:
            style.alignment = .center
            style.paragraphSpacingBefore = 6
        case .title:
            style.alignment = .center
        }
        return style
    }

    static func font(bold: Bool, italic: Bool) -> NSFont {
        var font = NSFont.systemFont(ofSize: fontSize)
        if bold { font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
        if italic { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
        return font
    }

    static func attributes(_ kind: ClauseBlockKind, _ level: Int, bold: Bool = false, italic: Bool = false, underline: Bool = false) -> [NSAttributedString.Key: Any] {
        var values: [NSAttributedString.Key: Any] = [
            .font: font(bold: bold || kind != .point, italic: italic),
            .foregroundColor: NSColor.textColor,
            .paragraphStyle: paragraphStyle(kind, level),
            .clauseKind: kind.rawValue,
            .clauseLevel: level,
        ]
        if underline { values[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        return values
    }

    static func attributed(_ blocks: [Block]) -> NSAttributedString {
        let result = NSMutableAttributedString()
        for (index, block) in blocks.enumerated() {
            for run in block.runs {
                result.append(NSAttributedString(string: run.text, attributes: attributes(block.kind, block.level, bold: run.bold, italic: run.italic, underline: run.underline)))
            }
            if index < blocks.count - 1 {
                result.append(NSAttributedString(string: "\n", attributes: attributes(block.kind, block.level)))
            }
        }
        return result
    }

    static func blocks(from text: NSAttributedString) -> [Block] {
        let string = text.string as NSString
        var blocks: [Block] = []
        var location = 0
        while location < string.length {
            let range = string.paragraphRange(for: NSRange(location: location, length: 0))
            var content = range
            if content.length > 0, string.character(at: NSMaxRange(content) - 1) == 10 { content.length -= 1 }
            let kind = ClauseBlockKind(rawValue: text.attribute(.clauseKind, at: range.location, effectiveRange: nil) as? Int ?? 0) ?? .point
            let level = text.attribute(.clauseLevel, at: range.location, effectiveRange: nil) as? Int ?? 0
            var runs: [Run] = []
            if content.length > 0 {
                text.enumerateAttributes(in: content) { values, runRange, _ in
                    let font = values[.font] as? NSFont
                    let traits = font.map { NSFontManager.shared.traits(of: $0) } ?? []
                    let underline = (values[.underlineStyle] as? Int ?? 0) != 0
                    runs.append(Run(text: string.substring(with: runRange), bold: kind == .point && traits.contains(.boldFontMask),
                                    italic: traits.contains(.italicFontMask), underline: underline))
                }
            }
            let block = Block(kind: kind, level: kind == .point ? max(0, min(2, level)) : 0, runs: runs)
            if !block.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { blocks.append(block) }
            location = NSMaxRange(range)
        }
        return blocks
    }
}

/// Numery punktów jak w umowie: 1., 1.1, 1.1.1 — nagłówek paragrafu lub tytuł zaczyna nową listę.
enum ClauseNumbering {
    static func indent(_ level: Int) -> CGFloat { [32, 66, 106][max(0, min(2, level))] }

    /// Etykieta dla każdego akapitu (po położeniu początku akapitu w tekście).
    static func labels(_ text: NSAttributedString) -> [Int: (label: String, level: Int)] {
        let string = text.string as NSString
        var result: [Int: (label: String, level: Int)] = [:]
        var counters = [0, 0, 0]
        var previous = -1
        var location = 0
        while location < string.length {
            let range = string.paragraphRange(for: NSRange(location: location, length: 0))
            let kind = ClauseBlockKind(rawValue: text.attribute(.clauseKind, at: range.location, effectiveRange: nil) as? Int ?? 0) ?? .point
            var level = text.attribute(.clauseLevel, at: range.location, effectiveRange: nil) as? Int ?? 0
            let empty = string.substring(with: range).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            if kind != .point {
                counters = [0, 0, 0]
                previous = -1
            } else if !empty {
                level = max(0, min(2, min(level, previous + 1)))
                counters[level] += 1
                for deeper in (level + 1)..<3 { counters[deeper] = 0 }
                for upper in 0..<level where counters[upper] == 0 { counters[upper] = 1 }
                let label = counters[0...level].map(String.init).joined(separator: ".") + (level == 0 ? "." : "")
                result[range.location] = (label, level)
                previous = level
            }
            location = NSMaxRange(range)
        }
        return result
    }
}

/// Układ tekstu klauzuli: numer punktu po lewej stronie akapitu.
final class ClauseLayoutManager: NSLayoutManager {
    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage, storage.length > 0 else { return }
        let labels = ClauseNumbering.labels(storage)
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: ClauseHTML.fontSize, weight: .medium),
            .foregroundColor: NSColor.secondaryLabelColor,
        ]
        for (start, entry) in labels where NSLocationInRange(start, characters) {
            let glyph = glyphIndexForCharacter(at: start)
            guard glyph < numberOfGlyphs else { continue }
            let line = lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            let text = entry.label as NSString
            let size = text.size(withAttributes: attributes)
            let right = ClauseNumbering.indent(entry.level) - 6
            let x = origin.x + max(0, right - size.width) + (textContainers.first?.lineFragmentPadding ?? 0)
            let glyphPoint = location(forGlyphAt: glyph)
            let baselineY = origin.y + line.minY + glyphPoint.y
            let font = attributes[.font] as! NSFont
            text.draw(at: NSPoint(x: x, y: baselineY - font.ascender), withAttributes: attributes)
        }
    }
}

/// Edytor tekstu klauzuli: Tab / Shift+Tab zmienia poziom punktu, ⌘B / ⌘I / ⌘U — pogrubienie, kursywa, podkreślenie.
final class ClauseTextView: NSTextView {
    weak var controller: ClauseEditorController?

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 48, isEditable, let controller {
            controller.shiftLevel(event.modifierFlags.contains(.shift) ? -1 : 1)
            return
        }
        super.keyDown(with: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if isEditable, window?.firstResponder === self, event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, let controller {
            switch event.charactersIgnoringModifiers?.lowercased() {
            case "b": controller.toggleBold(); return true
            case "i": controller.toggleItalic(); return true
            case "u": controller.toggleUnderline(); return true
            default: break
            }
        }
        return super.performKeyEquivalent(with: event)
    }
}

/// Czynności paska narzędzi edytora klauzuli na zaznaczonym tekście.
@MainActor final class ClauseEditorController: ObservableObject {
    weak var textView: ClauseTextView?
    var onChange: () -> Void = {}

    private var selectedParagraphs: NSRange? {
        guard let textView else { return nil }
        return (textView.string as NSString).paragraphRange(for: textView.selectedRange())
    }

    private func change(_ range: NSRange, _ apply: (NSTextStorage) -> Void) {
        guard let textView, let storage = textView.textStorage else { return }
        guard textView.shouldChangeText(in: range, replacementString: nil) else { return }
        storage.beginEditing()
        apply(storage)
        storage.endEditing()
        textView.didChangeText()
        textView.layoutManager?.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: storage.length))
        onChange()
    }

    /// Rodzaj akapitu: punkt na poziomie 0–2, nagłówek „§n” albo tytuł.
    func setKind(_ kind: ClauseBlockKind, level: Int = 0) {
        guard let textView, let range = selectedParagraphs else { return }
        let style = ClauseHTML.paragraphStyle(kind, level)
        if range.length == 0 {
            var typing = textView.typingAttributes
            typing[.clauseKind] = kind.rawValue
            typing[.clauseLevel] = level
            typing[.paragraphStyle] = style
            typing[.font] = ClauseHTML.font(bold: kind != .point, italic: false)
            textView.typingAttributes = typing
            textView.layoutManager?.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: textView.textStorage?.length ?? 0))
            return
        }
        change(range) { storage in
            storage.addAttributes([.clauseKind: kind.rawValue, .clauseLevel: level, .paragraphStyle: style], range: range)
            storage.enumerateAttribute(.font, in: range) { value, runRange, _ in
                let font = value as? NSFont ?? ClauseHTML.font(bold: false, italic: false)
                let next = kind == .point
                    ? NSFontManager.shared.convert(font, toNotHaveTrait: .boldFontMask)
                    : NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask)
                storage.addAttribute(.font, value: next, range: runRange)
            }
        }
    }

    func shiftLevel(_ delta: Int) {
        guard let textView, let range = selectedParagraphs, let storage = textView.textStorage else { return }
        let location = min(range.location, max(0, storage.length - 1))
        let kind = storage.length > 0 ? (storage.attribute(.clauseKind, at: location, effectiveRange: nil) as? Int ?? 0) : (textView.typingAttributes[.clauseKind] as? Int ?? 0)
        guard kind == ClauseBlockKind.point.rawValue else { return }
        let level = storage.length > 0 ? (storage.attribute(.clauseLevel, at: location, effectiveRange: nil) as? Int ?? 0) : (textView.typingAttributes[.clauseLevel] as? Int ?? 0)
        setKind(.point, level: max(0, min(2, level + delta)))
    }

    private func toggleTrait(_ trait: NSFontTraitMask) {
        guard let textView, let storage = textView.textStorage else { return }
        let range = textView.selectedRange()
        if range.length == 0 {
            let font = textView.typingAttributes[.font] as? NSFont ?? ClauseHTML.font(bold: false, italic: false)
            let has = NSFontManager.shared.traits(of: font).contains(trait)
            textView.typingAttributes[.font] = has ? NSFontManager.shared.convert(font, toNotHaveTrait: trait) : NSFontManager.shared.convert(font, toHaveTrait: trait)
            return
        }
        var all = true
        storage.enumerateAttribute(.font, in: range) { value, _, stop in
            if let font = value as? NSFont, !NSFontManager.shared.traits(of: font).contains(trait) { all = false; stop.pointee = true }
        }
        change(range) { storage in
            storage.enumerateAttribute(.font, in: range) { value, runRange, _ in
                let font = value as? NSFont ?? ClauseHTML.font(bold: false, italic: false)
                storage.addAttribute(.font, value: all ? NSFontManager.shared.convert(font, toNotHaveTrait: trait)
                                                       : NSFontManager.shared.convert(font, toHaveTrait: trait), range: runRange)
            }
        }
    }

    func toggleBold() { toggleTrait(.boldFontMask) }
    func toggleItalic() { toggleTrait(.italicFontMask) }

    func toggleUnderline() {
        guard let textView, let storage = textView.textStorage else { return }
        let range = textView.selectedRange()
        if range.length == 0 {
            let has = (textView.typingAttributes[.underlineStyle] as? Int ?? 0) != 0
            textView.typingAttributes[.underlineStyle] = has ? 0 : NSUnderlineStyle.single.rawValue
            return
        }
        var all = true
        storage.enumerateAttribute(.underlineStyle, in: range) { value, _, stop in
            if (value as? Int ?? 0) == 0 { all = false; stop.pointee = true }
        }
        change(range) { storage in
            if all { storage.removeAttribute(.underlineStyle, range: range) }
            else { storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range) }
        }
    }

    /// Zmienna umowy (pogrubiona, jak „Wstaw zmienną” w CRM) w miejscu kursora.
    func insertPlaceholder(_ value: String) {
        guard let textView else { return }
        var attributes = textView.typingAttributes
        let base = attributes[.font] as? NSFont ?? ClauseHTML.font(bold: false, italic: false)
        attributes[.font] = NSFontManager.shared.convert(base, toHaveTrait: .boldFontMask)
        textView.window?.makeFirstResponder(textView)
        textView.insertText(NSAttributedString(string: value, attributes: attributes), replacementRange: textView.selectedRange())
        textView.typingAttributes[.font] = base
        onChange()
    }

    /// Nagłówek paragrafu „§n” nad bieżącym akapitem.
    func insertParagraphHeading() {
        guard let textView, let storage = textView.textStorage else { return }
        let paragraph = (textView.string as NSString).paragraphRange(for: textView.selectedRange())
        let level = storage.length > 0 && paragraph.location < storage.length ? (storage.attribute(.clauseLevel, at: paragraph.location, effectiveRange: nil) as? Int ?? 0) : 0
        let heading = NSMutableAttributedString(string: "§n\n", attributes: ClauseHTML.attributes(.heading, 0))
        if paragraph.location >= storage.length && storage.length > 0 && !(textView.string.hasSuffix("\n")) {
            heading.insert(NSAttributedString(string: "\n", attributes: ClauseHTML.attributes(.point, level)), at: 0)
        }
        let insertion = NSRange(location: paragraph.location, length: 0)
        guard textView.shouldChangeText(in: insertion, replacementString: heading.string) else { return }
        storage.beginEditing()
        storage.replaceCharacters(in: insertion, with: heading)
        storage.endEditing()
        textView.didChangeText()
        textView.setSelectedRange(NSRange(location: insertion.location + heading.length, length: 0))
        textView.typingAttributes = ClauseHTML.attributes(.point, level)
        textView.layoutManager?.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: storage.length))
        onChange()
    }
}

/// Edytor treści klauzuli (zmienia `html` przy każdej zmianie tekstu).
struct ClauseEditorView: NSViewRepresentable {
    @Binding var html: String
    let editable: Bool
    let controller: ClauseEditorController

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ClauseEditorView
        init(_ parent: ClauseEditorView) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView, let storage = view.textStorage else { return }
            let html = ClauseHTML.serialize(ClauseHTML.blocks(from: storage))
            if parent.html != html { parent.html = html }
            view.layoutManager?.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: storage.length))
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let storage = NSTextStorage(attributedString: ClauseHTML.attributed(ClauseHTML.parse(html)))
        let layout = ClauseLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: 400, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        let textView = ClauseTextView(frame: .zero, textContainer: container)
        textView.isRichText = true
        textView.allowsUndo = true
        textView.isEditable = editable
        textView.isSelectable = true
        textView.drawsBackground = true
        textView.backgroundColor = NSColor.textBackgroundColor
        textView.textContainerInset = NSSize(width: 8, height: 10)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.typingAttributes = storage.length > 0 ? storage.attributes(at: max(0, storage.length - 1), effectiveRange: nil) : ClauseHTML.attributes(.point, 0)
        textView.delegate = context.coordinator
        textView.controller = controller
        controller.textView = textView
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.documentView = textView
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scroll.documentView as? ClauseTextView else { return }
        textView.isEditable = editable
        controller.textView = textView
        textView.controller = controller
    }
}

/// Podgląd treści klauzuli (bez przewijania; wysokość według tekstu).
struct ClausePreviewView: NSViewRepresentable {
    let html: String

    func makeNSView(context: Context) -> NSTextView {
        let storage = NSTextStorage()
        let layout = ClauseLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: 400, height: CGFloat.greatestFiniteMagnitude))
        layout.addTextContainer(container)
        let view = NSTextView(frame: .zero, textContainer: container)
        view.isEditable = false
        view.isSelectable = true
        view.drawsBackground = false
        view.textContainerInset = NSSize(width: 0, height: 2)
        storage.setAttributedString(ClauseHTML.attributed(ClauseHTML.parse(html)))
        return view
    }

    func updateNSView(_ view: NSTextView, context: Context) {
        let next = ClauseHTML.attributed(ClauseHTML.parse(html))
        if !(view.textStorage?.isEqual(to: next) ?? false) { view.textStorage?.setAttributedString(next) }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSTextView, context: Context) -> CGSize? {
        let width = max(100, proposal.width ?? 400)
        guard let container = nsView.textContainer, let layout = nsView.layoutManager else { return nil }
        container.containerSize = NSSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        let height = layout.usedRect(for: container).height + nsView.textContainerInset.height * 2
        return CGSize(width: width, height: max(18, ceil(height)))
    }
}
