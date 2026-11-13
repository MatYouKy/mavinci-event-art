import Foundation

// MARK: Treść szablonu umowy jako drzewo bloków — ten sam model co edytor CRM (TipTap, `contractEditorExtensions.ts`):
// akapity ze stylem dokumentu (`data-style`), listy z punktami, tabele, miejsca na klauzule (`data-contract-clause-slot`)
// i sekcje warunkowe (`div[data-contract-if]`). Odczyt z HTML jak `prepareContractHtmlForEditor` (`contractEditorHtml.ts`):
// akapity z `<div>`, tekst wprost w punkcie i w komórce jako akapit, linia nagłówka sekcji (`span[data-contract-keep-with-next]`)
// jako akapit ze znacznikiem. Atrybuty bloków zostają w modelu (zapis w kolejnym etapie odtwarza je bez strat).

struct ContractInlineMarks: Hashable {
    var bold = false
    var italic = false
    var underline = false
    var strike = false
    var link: String?
    var color: String?
    var fontFamily: String?
    var fontSizePt: Double?
}

enum ContractInline: Hashable {
    case text(String, ContractInlineMarks)
    case lineBreak
    case image(String)
}

struct ContractParagraph: Hashable {
    /// `p`, `h1`…`h6` (nagłówki HTML bez stylu dostają styl tytułu albo nagłówka).
    var tag: String
    var attributes: [String: String]
    var inlines: [ContractInline]
    var plainText: String {
        inlines.map { inline -> String in
            switch inline {
            case .text(let text, _): return text
            case .lineBreak: return "\n"
            case .image: return ""
            }
        }.joined()
    }
}

struct ContractDocumentListItem: Hashable {
    var attributes: [String: String]
    var blocks: [ContractBlock]
}

struct ContractList: Hashable {
    var ordered: Bool
    var attributes: [String: String]
    var items: [ContractDocumentListItem]
}

struct ContractTableCell: Hashable {
    var header: Bool
    var attributes: [String: String]
    var blocks: [ContractBlock]
}

struct ContractTableRow: Hashable {
    var attributes: [String: String]
    var cells: [ContractTableCell]
}

struct ContractTable: Hashable {
    var attributes: [String: String]
    var rows: [ContractTableRow]
}

indirect enum ContractBlock: Hashable {
    case paragraph(ContractParagraph)
    case list(ContractList)
    case table(ContractTable)
    /// Miejsce na klauzule produktów (`{{contract_clauses_…}}`) — przy umowie wypełnia je generator.
    case slot(name: String, attributes: [String: String])
    /// Sekcja widoczna tylko w części umów (warunek z `data-contract-if`).
    case section(condition: String, attributes: [String: String], blocks: [ContractBlock])
    case rule
    /// Obraz (logo, grafika) jako osobny blok — jak obraz w edytorze CRM (`<img src style>`).
    case image(attributes: [String: String])
}

struct ContractDocument: Hashable {
    var blocks: [ContractBlock]
}

// MARK: Odczyt HTML

enum ContractHTMLParser {
    static let keepWithNext = "data-contract-keep-with-next"
    static let clauseSlot = "data-contract-clause-slot"
    static let condition = "data-contract-if"
    static let style = "data-style"

    private static let blockTags: Set<String> = ["p", "div", "ol", "ul", "table", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "hr",
                                                  "section", "article", "header", "footer", "li", "thead", "tbody", "tfoot", "tr", "img"]
    private static let dropped: Set<String> = ["style", "script", "meta", "link", "title", "head"]

    static func parse(_ html: String) -> ContractDocument {
        let wrapped = "<html><body>\(html)</body></html>"
        guard let document = try? XMLDocument(xmlString: wrapped, options: [.documentTidyHTML]),
              let root = document.rootElement() else {
            return ContractDocument(blocks: [.paragraph(ContractParagraph(tag: "p", attributes: [:], inlines: [.text(html, ContractInlineMarks())]))])
        }
        let body = root.elements(forName: "body").first ?? root
        return ContractDocument(blocks: blocks(from: body.children ?? []))
    }

    // MARK: Węzły

    private static func name(_ node: XMLNode) -> String { (node.name ?? "").lowercased() }
    private static func asElement(_ node: XMLNode) -> XMLElement? { node.kind == .element ? node as? XMLElement : nil }

    static func attributes(_ element: XMLElement) -> [String: String] {
        var result: [String: String] = [:]
        for attribute in element.attributes ?? [] {
            guard let key = attribute.name?.lowercased() else { continue }
            result[key] = attribute.stringValue ?? ""
        }
        return result
    }

    private static func isBlock(_ node: XMLNode) -> Bool {
        guard let element = asElement(node) else { return false }
        return blockTags.contains(name(element))
    }

    private static func hasBlockChild(_ element: XMLElement) -> Bool {
        (element.children ?? []).contains { isBlock($0) }
    }

    private static func isWhitespace(_ node: XMLNode) -> Bool {
        node.kind == .text && (node.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Bloki z listy węzłów; ciągi treści w wierszu (tekst, `<strong>`, `<span>`…) stają się akapitami (z atrybutami
    /// akapitu `inherit`, gdy dzieli go obraz).
    static func blocks(from nodes: [XMLNode], inherit: [String: String] = [:]) -> [ContractBlock] {
        var result: [ContractBlock] = []
        var run: [XMLNode] = []
        func flush() {
            defer { run = [] }
            guard run.contains(where: { !isWhitespace($0) && $0.kind != .comment }) else { return }
            result.append(.paragraph(paragraph(from: run, tag: "p", attributes: inherit)))
        }
        for node in nodes {
            if node.kind == .comment { continue }
            if let element = asElement(node), dropped.contains(name(element)) { continue }
            if isBlock(node), let element = asElement(node) {
                flush()
                result.append(contentsOf: block(from: element))
            } else if node.kind == .text || node.kind == .element {
                run.append(node)
            }
        }
        flush()
        return result
    }

    private static func block(from element: XMLElement) -> [ContractBlock] {
        let tag = name(element)
        var attrs = attributes(element)
        switch tag {
        case "h1":
            if attrs[style] == nil { attrs[style] = "title" }
            return [.paragraph(paragraph(from: element.children ?? [], tag: "h1", attributes: attrs))]
        case "h2", "h3", "h4", "h5", "h6":
            if attrs[style] == nil { attrs[style] = "heading" }
            return [.paragraph(paragraph(from: element.children ?? [], tag: tag, attributes: attrs))]
        case "p", "pre":
            if hasBlockChild(element) { return blocks(from: element.children ?? [], inherit: attrs) }
            return [.paragraph(paragraph(from: element.children ?? [], tag: "p", attributes: attrs))]
        case "div", "blockquote", "section", "article", "header", "footer":
            if let slotName = attrs[self.clauseSlot] { return [.slot(name: slotName, attributes: attrs)] }
            if let expression = attrs[self.condition], hasBlockChild(element) {
                var rest = attrs
                rest.removeValue(forKey: self.condition)
                return [.section(condition: expression, attributes: rest, blocks: blocks(from: element.children ?? []))]
            }
            if hasBlockChild(element) { return blocks(from: element.children ?? []) }
            return [.paragraph(paragraph(from: element.children ?? [], tag: "p", attributes: attrs))]
        case "ol", "ul":
            return [.list(list(from: element, ordered: tag == "ol"))]
        case "table":
            return [.table(table(from: element))]
        case "hr":
            return [.rule]
        case "img":
            return (attrs["src"] ?? "").isEmpty ? [] : [.image(attributes: attrs)]
        case "li":
            // Punkt poza listą (uszkodzona treść) — jako akapit.
            return itemBlocks(from: element.children ?? [])
        case "thead", "tbody", "tfoot", "tr":
            return blocks(from: element.children ?? [])
        default:
            return [.paragraph(paragraph(from: element.children ?? [], tag: "p", attributes: attrs))]
        }
    }

    private static func list(from element: XMLElement, ordered: Bool) -> ContractList {
        var items: [ContractDocumentListItem] = []
        for child in element.children ?? [] {
            if let item = asElement(child), name(item) == "li" {
                items.append(ContractDocumentListItem(attributes: attributes(item), blocks: itemBlocks(from: item.children ?? [])))
            } else if let nested = asElement(child), ["ol", "ul"].contains(name(nested)), !items.isEmpty {
                // Lista zagnieżdżona wprost w liście (HTML z Worda) — należy do poprzedniego punktu.
                items[items.count - 1].blocks.append(.list(list(from: nested, ordered: name(nested) == "ol")))
            } else if !isWhitespace(child) {
                items.append(ContractDocumentListItem(attributes: [:], blocks: itemBlocks(from: [child])))
            }
        }
        return ContractList(ordered: ordered, attributes: attributes(element), items: items)
    }

    /// Treść punktu lub komórki: ciągi w wierszu jako akapity; samotna linia nagłówka sekcji (`span[data-contract-keep-with-next]`)
    /// jako akapit ze znacznikiem. Pierwszy blok jest zawsze akapitem (jak w edytorze CRM).
    static func itemBlocks(from nodes: [XMLNode]) -> [ContractBlock] {
        var result: [ContractBlock] = []
        var run: [XMLNode] = []
        func flush() {
            defer { run = [] }
            let meaningful = run.filter { !isWhitespace($0) && $0.kind != .comment }
            guard !meaningful.isEmpty else { return }
            if meaningful.count == 1, let span = asElement(meaningful[0]), attributes(span)[keepWithNext] != nil {
                var attrs: [String: String] = [keepWithNext: "true"]
                if let styleID = attributes(span)[self.style] { attrs[self.style] = styleID }
                result.append(.paragraph(paragraph(from: span.children ?? [], tag: "p", attributes: attrs)))
            } else {
                result.append(.paragraph(paragraph(from: run, tag: "p", attributes: [:])))
            }
        }
        for node in nodes {
            if node.kind == .comment { continue }
            if isBlock(node), let element = asElement(node) {
                flush()
                result.append(contentsOf: block(from: element))
            } else if node.kind == .text || node.kind == .element {
                run.append(node)
            }
        }
        flush()
        if case .paragraph? = result.first {} else {
            result.insert(.paragraph(ContractParagraph(tag: "p", attributes: [:], inlines: [])), at: 0)
        }
        return result
    }

    private static func table(from element: XMLElement) -> ContractTable {
        var rows: [ContractTableRow] = []
        func collect(_ node: XMLElement) {
            for child in node.children ?? [] {
                guard let part = asElement(child) else { continue }
                switch name(part) {
                case "thead", "tbody", "tfoot": collect(part)
                case "tr":
                    let cells = (part.children ?? []).compactMap { asElement($0) }.filter { ["td", "th"].contains(name($0)) }.map { cell in
                        ContractTableCell(header: name(cell) == "th", attributes: attributes(cell), blocks: itemBlocks(from: cell.children ?? []))
                    }
                    rows.append(ContractTableRow(attributes: attributes(part), cells: cells))
                default: break
                }
            }
        }
        collect(element)
        return ContractTable(attributes: attributes(element), rows: rows)
    }

    // MARK: Treść w wierszu

    static func paragraph(from nodes: [XMLNode], tag: String, attributes: [String: String]) -> ContractParagraph {
        var inlines: [ContractInline] = []
        for node in nodes { collectInlines(node, marks: ContractInlineMarks(), into: &inlines) }
        return ContractParagraph(tag: tag, attributes: attributes, inlines: normalize(inlines))
    }

    private static func collectInlines(_ node: XMLNode, marks: ContractInlineMarks, into result: inout [ContractInline]) {
        if node.kind == .text {
            let text = node.stringValue ?? ""
            if !text.isEmpty { result.append(.text(text, marks)) }
            return
        }
        guard let element = asElement(node) else { return }
        let tag = name(element)
        if dropped.contains(tag) { return }
        var next = marks
        switch tag {
        case "br":
            result.append(.lineBreak)
            return
        case "img":
            result.append(.image(attributes(element)["src"] ?? ""))
            return
        case "strong", "b": next.bold = true
        case "em", "i": next.italic = true
        case "u", "ins": next.underline = true
        case "s", "strike", "del": next.strike = true
        case "a": next.link = attributes(element)["href"]
        default: break
        }
        if let css = attributes(element)["style"] { applyInlineStyle(css, to: &next) }
        if tag == "font", let color = attributes(element)["color"] { next.color = color }
        for child in element.children ?? [] { collectInlines(child, marks: next, into: &result) }
        // Blok wewnątrz wiersza (np. akapit w zagnieżdżonym `<span>`) — nowa linia.
        if blockTags.contains(tag) { result.append(.lineBreak) }
    }

    /// Formatowanie bezpośrednie ze `style` (kolor, czcionka, rozmiar, pogrubienie, kursywa, podkreślenie, przekreślenie).
    static func applyInlineStyle(_ css: String, to marks: inout ContractInlineMarks) {
        for (property, value) in declarations(css) {
            switch property {
            case "color": marks.color = value
            case "font-family": marks.fontFamily = value
            case "font-size": if let size = points(value) { marks.fontSizePt = size }
            case "font-weight": if value == "bold" || value == "bolder" || (Int(value) ?? 400) >= 600 { marks.bold = true }
            case "font-style": if value.contains("italic") { marks.italic = true }
            case "text-decoration", "text-decoration-line":
                if value.contains("underline") { marks.underline = true }
                if value.contains("line-through") { marks.strike = true }
            default: break
            }
        }
    }

    static func declarations(_ css: String) -> [(String, String)] {
        css.split(separator: ";").compactMap { part in
            guard let colon = part.firstIndex(of: ":") else { return nil }
            let property = part[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = part[part.index(after: colon)...].replacingOccurrences(of: "!important", with: "")
                .trimmingCharacters(in: .whitespaces)
            return property.isEmpty || value.isEmpty ? nil : (property, value)
        }
    }

    /// Rozmiar CSS w punktach (`pt`, `px` = 0,75 pt, `em` względem 12 pt).
    static func points(_ value: String) -> Double? {
        let text = value.trimmingCharacters(in: .whitespaces).lowercased()
        if text.hasSuffix("pt"), let number = Double(text.dropLast(2)) { return number }
        if text.hasSuffix("px"), let number = Double(text.dropLast(2)) { return number * 0.75 }
        if text.hasSuffix("em"), let number = Double(text.dropLast(2)) { return number * 12 }
        return Double(text)
    }

    /// Białe znaki jak w HTML: ciągi spacji i nowych linii → jedna spacja, bez spacji na początku i końcu akapitu
    /// i po złamaniu wiersza. Akapit z samym `<br>` jest pusty.
    static func normalize(_ inlines: [ContractInline]) -> [ContractInline] {
        var result: [ContractInline] = []
        var lastSpace = true
        for inline in inlines {
            switch inline {
            case .text(let raw, let marks):
                var text = ""
                for character in raw {
                    if character == " " || character == "\n" || character == "\t" || character == "\r" {
                        if !lastSpace { text.append(" "); lastSpace = true }
                    } else {
                        text.append(character); lastSpace = false
                    }
                }
                guard !text.isEmpty else { continue }
                if case .text(let previous, let previousMarks)? = result.last, previousMarks == marks {
                    result[result.count - 1] = .text(previous + text, marks)
                } else {
                    result.append(.text(text, marks))
                }
            case .lineBreak:
                if case .text(let previous, let marks)? = result.last, previous.hasSuffix(" ") {
                    let trimmed = String(previous.dropLast())
                    if trimmed.isEmpty { result.removeLast() } else { result[result.count - 1] = .text(trimmed, marks) }
                }
                result.append(.lineBreak)
                lastSpace = true
            case .image:
                result.append(inline)
                lastSpace = false
            }
        }
        if case .text(let previous, let marks)? = result.last, previous.hasSuffix(" ") {
            let trimmed = String(previous.dropLast())
            if trimmed.isEmpty { result.removeLast() } else { result[result.count - 1] = .text(trimmed, marks) }
        }
        while case .lineBreak? = result.last { result.removeLast() }
        return result
    }
}

// MARK: Style dokumentu (`page_settings.documentStyles`, `contractDocumentStyles.ts`)

struct ContractDocumentStyle: Codable, Hashable {
    var fontFamily: String
    var fontSizePt: Double
    var bold: Bool
    var italic: Bool
    var underline: Bool
    var color: String
    var textAlign: String
    var lineHeight: Double
    var spaceBeforePt: Double
    var spaceAfterPt: Double
    var indentPt: Double
    var keepWithNext: Bool
}

struct ContractDocumentStyles: Codable, Hashable {
    var version: Int
    var styles: [String: ContractDocumentStyle]

    static let ids = ["title", "heading", "point", "subpoint", "subsubpoint", "body", "table"]
    static let labels: [String: String] = [
        "title": "Tytuł", "heading": "Nagłówek sekcji", "point": "Punkt", "subpoint": "Podpunkt",
        "subsubpoint": "Podpunkt 2. stopnia", "body": "Zwykły", "table": "Tabela",
    ]
    func style(_ id: String) -> ContractDocumentStyle {
        styles[id] ?? styles["body"] ?? ContractDocumentStyle(fontFamily: "Arial, sans-serif", fontSizePt: 8.5, bold: false, italic: false, underline: false,
                                                             color: "#000000", textAlign: "justify", lineHeight: 1.45, spaceBeforePt: 0,
                                                             spaceAfterPt: 4, indentPt: 0, keepWithNext: false)
    }
}

// MARK: Rozpoznanie stylu (`inferContractStyle`)

enum ContractStyleInference {
    static func isStyleID(_ value: String?) -> Bool { value.map { ContractDocumentStyles.ids.contains($0) } ?? false }

    /// Akapit najwyższego poziomu (poza punktem i komórką).
    static func paragraphStyle(_ paragraph: ContractParagraph) -> String {
        if let explicit = paragraph.attributes[ContractHTMLParser.style], isStyleID(explicit) { return explicit }
        if paragraph.tag == "h1" { return "title" }
        if paragraph.tag.hasPrefix("h") { return "heading" }
        if paragraph.attributes["data-contract-paragraph"] == "true"
            || (paragraph.attributes["class"] ?? "").contains("contract-paragraph-heading") { return "heading" }
        let text = paragraph.plainText.replacingOccurrences(of: "\u{00A0}", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count <= 80, text.range(of: #"^§\s*(\d+|n)\b"#, options: .regularExpression) != nil { return "heading" }
        return "body"
    }

    /// Punkt będący sekcją umowy: styl „heading” albo linia nagłówka nad listą punktów.
    static func isSectionItem(_ item: ContractDocumentListItem) -> Bool {
        if item.attributes[ContractHTMLParser.style] == "heading" { return true }
        guard case .paragraph(let first)? = item.blocks.first, first.attributes[ContractHTMLParser.keepWithNext] != nil else { return false }
        return item.blocks.contains { if case .list = $0 { return true } else { return false } }
    }

    /// Styl punktu: zapisany albo z poziomu (sekcje nie zwiększają poziomu punktów).
    static func itemStyle(_ item: ContractDocumentListItem, level: Int) -> String {
        if let explicit = item.attributes[ContractHTMLParser.style], isStyleID(explicit) { return explicit }
        if isSectionItem(item) { return "heading" }
        return level <= 1 ? "point" : level == 2 ? "subpoint" : "subsubpoint"
    }
}

// MARK: Warunki (`describeContractCondition`)

struct ContractOptionItem: Codable, Hashable {
    var key: String
    var label: String
    var defaultOn: Bool
}

enum ContractConditionText {
    static func describe(_ expression: String, options: [ContractOptionItem], fieldLabels: [String: String]) -> String {
        var text = expression.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return "Nieprawidłowy warunek" }
        let list: ([String]) -> String = { $0.joined(separator: " lub ") }
        if let match = text.range(of: #"^([A-Za-z0-9_]+)\s*(!=|=)\s*(.+)$"#, options: .regularExpression), match.lowerBound == text.startIndex {
            let negate = text.contains("!=")
            let separator = negate ? "!=" : "="
            let parts = text.components(separatedBy: separator)
            let variable = parts[0].trimmingCharacters(in: .whitespaces)
            let values = parts.dropFirst().joined(separator: separator).split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            switch variable {
            case "klient":
                let labels = values.map { $0.lowercased() == "osoba" ? "osoba prywatna" : $0.lowercased() == "firma" ? "firma" : $0 }
                return negate ? "Klient inny niż \(list(labels))" : "Klient: \(list(labels))"
            case "kategoria":
                return negate ? "Wydarzenie inne niż \(list(values))" : "Wydarzenie: \(list(values))"
            default:
                let label = fieldLabels[variable] ?? variable
                return "\(label) \(negate ? "≠" : "=") \(list(values))"
            }
        }
        var negate = false
        if text.hasPrefix("!") { negate = true; text = String(text.dropFirst()).trimmingCharacters(in: .whitespaces) }
        if text.hasPrefix("opcja_") {
            let key = String(text.dropFirst("opcja_".count))
            let label = options.first { $0.key == key }?.label ?? key
            return negate ? "Bez opcji: \(label)" : "Opcja: \(label)"
        }
        let label = fieldLabels[text] ?? text
        return negate ? "Gdy puste: \(label)" : "Gdy wypełnione: \(label)"
    }
}
