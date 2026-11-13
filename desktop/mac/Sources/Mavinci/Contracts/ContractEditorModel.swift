import Foundation

// MARK: Edycja treści szablonu umowy — dokument jako ciąg akapitów, każdy ze „ścieżką” kontenerów: sekcja warunkowa,
// punkt listy (lista + punkt), komórka tabeli. Taki zapis pasuje do tekstu w edytorze (jeden akapit = jeden wiersz
// tekstu do Enter), a drzewo HTML odtwarza się z niego bez strat: kolejne akapity z tym samym punktem to jeden `<li>`,
// z tą samą listą — jedna `<ol>`. Zasady stylów i zapisu jak w edytorze CRM (`contractStructure`,
// `finalizeContractEditorHtml`, numeracja 1. / 1.1 z `normalizeContractListStructureInElement`).

enum ContractIDs {
    private static var last = 0
    static func next() -> Int {
        last += 1
        return last
    }
}

struct ContractItemLevel: Hashable {
    var listID: Int
    var ordered: Bool
    var listAttributes: [String: String]
    var itemID: Int
    var attributes: [String: String]
}

struct ContractCellLevel: Hashable {
    var tableID: Int
    var tableAttributes: [String: String]
    var row: Int
    var rowAttributes: [String: String]
    var column: Int
    var header: Bool
    var attributes: [String: String]
}

enum ContractContainer: Hashable {
    case section(id: Int, condition: String, attributes: [String: String])
    case item(ContractItemLevel)
    case cell(ContractCellLevel)

    var item: ContractItemLevel? {
        if case .item(let level) = self { return level }
        return nil
    }

    var cell: ContractCellLevel? {
        if case .cell(let level) = self { return level }
        return nil
    }

    var sectionID: Int? {
        if case .section(let id, _, _) = self { return id }
        return nil
    }

    /// Ten sam kontener (sekcja, punkt, komórka) — po identyfikatorach, bez porównywania atrybutów.
    func same(_ other: ContractContainer) -> Bool {
        switch (self, other) {
        case (.section(let first, _, _), .section(let second, _, _)): return first == second
        case (.item(let first), .item(let second)): return first.listID == second.listID && first.itemID == second.itemID
        case (.cell(let first), .cell(let second)): return first.tableID == second.tableID && first.row == second.row && first.column == second.column
        default: return false
        }
    }
}

enum ContractFlatContent: Hashable {
    case text([ContractInline])
    case slot(name: String, attributes: [String: String])
    case rule
    case image(attributes: [String: String])
}

struct ContractFlatParagraph: Hashable {
    var content: ContractFlatContent
    var tag: String
    var attributes: [String: String]
    var path: [ContractContainer]

    var plainText: String {
        guard case .text(let inlines) = content else { return "" }
        return ContractParagraph(tag: tag, attributes: attributes, inlines: inlines).plainText
    }
}

// MARK: Drzewo → akapity

enum ContractFlattener {
    static func flatten(_ blocks: [ContractBlock]) -> [ContractFlatParagraph] {
        var result: [ContractFlatParagraph] = []
        visit(blocks, path: [], into: &result)
        if result.isEmpty { result.append(empty([])) }
        return result
    }

    private static func empty(_ path: [ContractContainer]) -> ContractFlatParagraph {
        ContractFlatParagraph(content: .text([]), tag: "p", attributes: [:], path: path)
    }

    private static func visit(_ blocks: [ContractBlock], path: [ContractContainer], into result: inout [ContractFlatParagraph]) {
        for block in blocks {
            switch block {
            case .paragraph(let paragraph):
                result.append(ContractFlatParagraph(content: .text(paragraph.inlines), tag: paragraph.tag, attributes: paragraph.attributes, path: path))
            case .slot(let name, let attributes):
                result.append(ContractFlatParagraph(content: .slot(name: name, attributes: attributes), tag: "div", attributes: [:], path: path))
            case .rule:
                result.append(ContractFlatParagraph(content: .rule, tag: "hr", attributes: [:], path: path))
            case .image(let attributes):
                result.append(ContractFlatParagraph(content: .image(attributes: attributes), tag: "img", attributes: [:], path: path))
            case .section(let condition, let attributes, let children):
                let inner = path + [.section(id: ContractIDs.next(), condition: condition, attributes: attributes)]
                let before = result.count
                visit(children, path: inner, into: &result)
                if result.count == before { result.append(empty(inner)) }
            case .list(let list):
                let listID = ContractIDs.next()
                for item in list.items {
                    let level = ContractItemLevel(listID: listID, ordered: list.ordered, listAttributes: list.attributes, itemID: ContractIDs.next(), attributes: item.attributes)
                    let inner = path + [.item(level)]
                    let before = result.count
                    visit(item.blocks, path: inner, into: &result)
                    if result.count == before { result.append(empty(inner)) }
                }
            case .table(let table):
                let tableID = ContractIDs.next()
                for (rowIndex, row) in table.rows.enumerated() {
                    for (column, cell) in row.cells.enumerated() {
                        let level = ContractCellLevel(tableID: tableID, tableAttributes: table.attributes, row: rowIndex, rowAttributes: row.attributes,
                                                      column: column, header: cell.header, attributes: cell.attributes)
                        let inner = path + [.cell(level)]
                        let before = result.count
                        visit(cell.blocks, path: inner, into: &result)
                        if result.count == before { result.append(empty(inner)) }
                    }
                }
            }
        }
    }
}

// MARK: Akapity → drzewo

enum ContractTreeBuilder {
    static func build(_ paragraphs: [ContractFlatParagraph]) -> [ContractBlock] {
        build(paragraphs[...], depth: 0)
    }

    private static func container(_ paragraph: ContractFlatParagraph, _ depth: Int) -> ContractContainer? {
        depth < paragraph.path.count ? paragraph.path[depth] : nil
    }

    private static func build(_ paragraphs: ArraySlice<ContractFlatParagraph>, depth: Int) -> [ContractBlock] {
        var result: [ContractBlock] = []
        var index = paragraphs.startIndex
        while index < paragraphs.endIndex {
            let current = paragraphs[index]
            guard let level = container(current, depth) else {
                result.append(leaf(current))
                index += 1
                continue
            }
            switch level {
            case .section(let id, let condition, let attributes):
                var end = index + 1
                while end < paragraphs.endIndex, container(paragraphs[end], depth)?.sectionID == id { end += 1 }
                result.append(.section(condition: condition, attributes: attributes, blocks: build(paragraphs[index..<end], depth: depth + 1)))
                index = end
            case .item(let first):
                var end = index + 1
                while end < paragraphs.endIndex, container(paragraphs[end], depth)?.item?.listID == first.listID { end += 1 }
                var items: [ContractDocumentListItem] = []
                var start = index
                while start < end {
                    guard let item = container(paragraphs[start], depth)?.item else { break }
                    var stop = start + 1
                    while stop < end, container(paragraphs[stop], depth)?.item?.itemID == item.itemID { stop += 1 }
                    items.append(ContractDocumentListItem(attributes: item.attributes, blocks: build(paragraphs[start..<stop], depth: depth + 1)))
                    start = stop
                }
                result.append(.list(ContractList(ordered: first.ordered, attributes: first.listAttributes, items: items)))
                index = end
            case .cell(let first):
                var end = index + 1
                while end < paragraphs.endIndex, container(paragraphs[end], depth)?.cell?.tableID == first.tableID { end += 1 }
                var rows: [ContractTableRow] = []
                var start = index
                while start < end {
                    guard let row = container(paragraphs[start], depth)?.cell else { break }
                    var rowEnd = start + 1
                    while rowEnd < end, container(paragraphs[rowEnd], depth)?.cell?.row == row.row { rowEnd += 1 }
                    var cells: [ContractTableCell] = []
                    var cellStart = start
                    while cellStart < rowEnd {
                        guard let cell = container(paragraphs[cellStart], depth)?.cell else { break }
                        var cellEnd = cellStart + 1
                        while cellEnd < rowEnd, container(paragraphs[cellEnd], depth)?.cell?.column == cell.column { cellEnd += 1 }
                        cells.append(ContractTableCell(header: cell.header, attributes: cell.attributes, blocks: build(paragraphs[cellStart..<cellEnd], depth: depth + 1)))
                        cellStart = cellEnd
                    }
                    rows.append(ContractTableRow(attributes: row.rowAttributes, cells: cells))
                    start = rowEnd
                }
                result.append(.table(ContractTable(attributes: first.tableAttributes, rows: rows)))
                index = end
            }
        }
        return result
    }

    private static func leaf(_ paragraph: ContractFlatParagraph) -> ContractBlock {
        switch paragraph.content {
        case .text(let inlines): return .paragraph(ContractParagraph(tag: paragraph.tag, attributes: paragraph.attributes, inlines: inlines))
        case .slot(let name, let attributes): return .slot(name: name, attributes: attributes)
        case .rule: return .rule
        case .image(let attributes): return .image(attributes: attributes)
        }
    }
}

// MARK: Struktura: style punktów, numeracja, warunki (jak `contractStructure` w edytorze CRM)

struct ContractParagraphRole {
    var styleID = "body"
    /// Styl wyliczony dla każdego poziomu ścieżki (punkty; dla sekcji i komórek `nil`).
    var levelStyles: [String?] = []
    var levelSections: [Bool] = []
    /// Akapit bezpośrednio w punkcie listy (nie w sekcji czy tabeli w punkcie).
    var inItem = false
    var inCell = false
    var firstInItem = false
    var lastInItem = false
    /// Punkt jest nagłówkiem sekcji („1. Przedmiot umowy” z punktami 1.1, 1.2 pod spodem).
    var section = false
    /// Numer punktu przy pierwszym akapicie punktu („1.”, „1.2”, „a.”, „•”).
    var marker: String?
    /// Warunki widoczności (wyrażenia `data-contract-if`) od zewnętrznej sekcji do akapitu.
    var conditions: [String] = []
    /// Liczba poziomów punktów w akapicie (Punkt = 1, Podpunkt = 2…) — jak `listPosition` w CRM.
    var pointLevel = 0
    var listDepth = 0
}

enum ContractStructure {
    static let keepWithNext = ContractHTMLParser.keepWithNext
    static let style = ContractHTMLParser.style
    static let condition = ContractHTMLParser.condition
    static let pointStyles = ["point", "subpoint", "subsubpoint"]
    static let paragraphStyles: Set<String> = ["title", "heading", "body"]
    private static let placeholder = try? NSRegularExpression(pattern: #"^\{\{\s*(?:OFFER_ITEMS_TABLE|offer_items|decision_makers_list)\s*\}\}$"#)

    static func pointStyle(_ level: Int) -> String { pointStyles[max(1, min(level, 3)) - 1] }

    /// Punkt, którego treść to sama tabela pozycji oferty lub lista decydentów — bez numeru (jak w CRM).
    static func isPlaceholder(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let placeholder, !trimmed.isEmpty else { return false }
        return placeholder.firstMatch(in: trimmed, range: NSRange(location: 0, length: (trimmed as NSString).length)) != nil
    }

    /// Lista numerowana „1. / 1.1” (bez innego znacznika jak „a.” czy „i.”).
    static func isOutline(_ level: ContractItemLevel) -> Bool {
        guard level.ordered else { return false }
        return isOutline(listAttributes: level.listAttributes)
    }

    static func isOutline(listAttributes: [String: String]) -> Bool {
        var marker = listAttributes["data-clause-marker"] ?? ""
        if marker.hasSuffix("-paren") { marker = String(marker.dropLast(6)) }
        return marker.isEmpty || marker == "decimal" || marker == "outline-decimal"
    }

    static func samePrefix(_ first: [ContractContainer], _ second: [ContractContainer], count: Int) -> Bool {
        guard count > 0, first.count >= count, second.count >= count else { return count == 0 }
        for index in 0..<count where !first[index].same(second[index]) { return false }
        return true
    }

    static func analyze(paths: [[ContractContainer]], attributes: [[String: String]], isPlaceholder: (Int) -> Bool) -> [ContractParagraphRole] {
        var roles: [ContractParagraphRole] = []
        roles.reserveCapacity(paths.count)
        var runs: [Int: Int] = [:]
        var childContext: [Int: String] = [:]
        var labels: [Int: String] = [:]
        for (index, path) in paths.enumerated() {
            let previous = index > 0 ? paths[index - 1] : []
            let next = index + 1 < paths.count ? paths[index + 1] : []
            var role = ContractParagraphRole()
            var parentSection = false
            var orderedAbove = false
            var cellStyle = "table"
            for (depth, container) in path.enumerated() {
                switch container {
                case .section(_, let expression, _):
                    if !expression.isEmpty { role.conditions.append(expression) }
                    role.levelStyles.append(nil)
                    role.levelSections.append(false)
                    parentSection = false
                case .cell(let cell):
                    role.inCell = true
                    let own = cell.attributes[style]
                    cellStyle = ContractStyleInference.isStyleID(own) ? own ?? "table" : "table"
                    role.levelStyles.append(nil)
                    role.levelSections.append(false)
                    parentSection = false
                case .item(let item):
                    role.listDepth += 1
                    if !parentSection { role.pointLevel += 1 }
                    let section = item.attributes[style] == "heading" && role.listDepth == 1 && item.ordered
                    role.levelStyles.append(section ? "heading" : pointStyle(role.pointLevel))
                    role.levelSections.append(section)
                    if let expression = item.attributes[condition], !expression.isEmpty { role.conditions.append(expression) }

                    // Numeracja: nowy punkt, gdy poprzedni akapit nie leży w tym samym punkcie; nowa lista (od `start`),
                    // gdy poprzedni akapit nie leży w tej samej liście.
                    let continuing = samePrefix(previous, path, count: depth) && previous.count > depth && previous[depth].item?.listID == item.listID
                    let newItem = !(continuing && previous[depth].item?.itemID == item.itemID)
                    if !continuing { runs[depth] = Int(item.listAttributes["start"] ?? "") ?? 1 }
                    if newItem {
                        // Kontekst numeracji 1. / 1.1: lista najwyższego poziomu („”) albo lista w numerowanym punkcie.
                        var context: String?
                        if isOutline(item) {
                            if !orderedAbove { context = "" } else if depth > 0, let parent = path[depth - 1].item { context = childContext[parent.itemID] }
                        }
                        let suppressed = path.count == depth + 1 && isPlaceholder(index)
                        if suppressed {
                            if let context { childContext[item.itemID] = context }
                        } else {
                            let explicit = Int(item.attributes["value"] ?? "") ?? 0
                            let number = explicit > 0 ? explicit : runs[depth] ?? 1
                            runs[depth] = number + 1
                            if let context {
                                let full = context.isEmpty ? "\(number)" : "\(context).\(number)"
                                childContext[item.itemID] = full
                                labels[item.itemID] = context.isEmpty ? "\(full)." : full
                            } else {
                                labels[item.itemID] = ContractNumbering.marker(item, number: number)
                            }
                        }
                    }
                    if item.ordered { orderedAbove = true }
                    parentSection = section
                }
            }
            if let own = attributes[index][condition], !own.isEmpty { role.conditions.append(own) }
            if case .item(let item)? = path.last {
                let depth = path.count - 1
                role.inItem = true
                role.section = role.levelSections.last ?? false
                role.styleID = role.levelStyles.last.flatMap { $0 } ?? "point"
                role.firstInItem = !samePrefix(previous, path, count: depth + 1)
                role.lastInItem = !samePrefix(next, path, count: depth + 1)
                if role.firstInItem { role.marker = labels[item.itemID] }
            } else if role.inCell {
                role.styleID = cellStyle
            } else {
                let own = attributes[index][style] ?? ""
                role.styleID = paragraphStyles.contains(own) ? own : "body"
            }
            roles.append(role)
        }
        return roles
    }

    /// Atrybuty jak po `contractStructure` w CRM: punkt ma styl swojego poziomu (nagłówek sekcji tylko na 1. poziomie
    /// listy numerowanej), akapit w punkcie i w komórce — bez stylu (linia nagłówka sekcji trzyma się punktów pod nią),
    /// akapit poza listą — Tytuł, Nagłówek sekcji albo Zwykły; komórka — styl Tabela, gdy brak innego.
    static func normalize(_ paragraphs: [ContractFlatParagraph]) -> [ContractFlatParagraph] {
        let roles = analyze(paths: paragraphs.map(\.path), attributes: paragraphs.map(\.attributes)) { index in
            isPlaceholder(paragraphs[index].plainText)
        }
        return paragraphs.enumerated().map { index, paragraph in
            var result = paragraph
            let role = roles[index]
            result.path = paragraph.path.enumerated().map { depth, container in
                switch container {
                case .item(var item):
                    if depth < role.levelStyles.count, let computed = role.levelStyles[depth] { item.attributes[style] = computed }
                    return .item(item)
                case .cell(var cell):
                    if !ContractStyleInference.isStyleID(cell.attributes[style]) { cell.attributes[style] = "table" }
                    return .cell(cell)
                case .section:
                    return container
                }
            }
            guard case .text = paragraph.content else { return result }
            if role.inItem || role.inCell {
                result.attributes.removeValue(forKey: style)
                if role.inItem && role.firstInItem && role.section { result.attributes[keepWithNext] = "true" } else { result.attributes.removeValue(forKey: keepWithNext) }
            } else {
                result.attributes[style] = role.styleID
                result.attributes.removeValue(forKey: keepWithNext)
            }
            return result
        }
    }
}

enum ContractNumbering {
    /// Znacznik punktu listy innej niż 1. / 1.1 (jak `list-style-type` w CSS umowy).
    static func marker(_ level: ContractItemLevel, number: Int) -> String {
        guard level.ordered else { return "•" }
        switch level.listAttributes["data-clause-marker"] ?? "" {
        case "bullet": return "•"
        case "lower-alpha", "lower-alpha-paren": return "\(alphabetic(number, upper: false))."
        case "upper-alpha", "upper-alpha-paren": return "\(alphabetic(number, upper: true))."
        case "lower-roman", "lower-roman-paren": return "\(roman(number).lowercased())."
        case "upper-roman", "upper-roman-paren": return "\(roman(number))."
        default:
            switch level.listAttributes["type"] ?? "1" {
            case "a": return "\(alphabetic(number, upper: false))."
            case "A": return "\(alphabetic(number, upper: true))."
            case "i": return "\(roman(number).lowercased())."
            case "I": return "\(roman(number))."
            default: return "\(number)."
            }
        }
    }

    static func alphabetic(_ number: Int, upper: Bool) -> String {
        var value = max(1, number)
        var letters = ""
        while value > 0 {
            value -= 1
            letters = String(UnicodeScalar(UInt8(97 + value % 26))) + letters
            value /= 26
        }
        return upper ? letters.uppercased() : letters
    }

    static func roman(_ number: Int) -> String {
        let table: [(Int, String)] = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
                                      (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
        var value = max(1, min(number, 3999))
        var result = ""
        for (amount, symbol) in table {
            while value >= amount {
                result += symbol
                value -= amount
            }
        }
        return result
    }
}

// MARK: Drzewo → HTML zapisywany w szablonie (`finalizeContractEditorHtml` + numery 1. / 1.1)

enum ContractHTMLWriter {
    private static let keep = ContractHTMLParser.keepWithNext
    private static let style = ContractHTMLParser.style
    private static let outlineNumber = "data-contract-outline-number"
    private static let outlineSuppressed = "data-contract-outline-suppressed"

    static func html(_ document: [ContractBlock]) -> String {
        var blocks = document
        // Puste akapity na końcu dokumentu (bez warunku) — jak w CRM nie zapisujemy (pusta linia pod podpisami).
        while case .paragraph(let last)? = blocks.last, last.inlines.isEmpty, last.attributes[ContractHTMLParser.condition] == nil {
            blocks.removeLast()
        }
        return write(blocks, nested: false, insideOrdered: false)
    }

    // MARK: Bloki

    /// `nested` — w punkcie listy lub komórce tabeli (pusty akapit bez `<br>`, tytuł bez `<h1>`).
    private static func write(_ blocks: [ContractBlock], nested: Bool, insideOrdered: Bool) -> String {
        var html = ""
        for block in blocks {
            switch block {
            case .paragraph(let paragraph):
                let title = !nested && paragraph.attributes[style] == "title"
                let tag = title ? "h1" : "p"
                var content = inlines(paragraph.inlines)
                if content.isEmpty && !nested && !title { content = "<br>" }
                html += "<\(tag)\(attributes(paragraph.attributes))>\(content)</\(tag)>"
            case .list(let list):
                html += writeList(list, insideOrdered: insideOrdered, context: nil)
            case .table(let table):
                html += writeTable(table, insideOrdered: insideOrdered)
            case .slot(let name, let own):
                var all = own
                all[ContractHTMLParser.clauseSlot] = name
                html += "<div\(attributes(all, first: ContractHTMLParser.clauseSlot))>{{\(escapeText(name))}}</div>"
            case .section(let expression, let own, let children):
                var all = own
                all[ContractHTMLParser.condition] = expression
                html += "<div\(attributes(all, first: ContractHTMLParser.condition))>\(write(children, nested: nested, insideOrdered: insideOrdered))</div>"
            case .rule:
                html += "<hr>"
            case .image(let own):
                html += "<img\(attributes(own, first: "src"))>"
            }
        }
        return html
    }

    /// `context` — numer punktu nadrzędnego dla listy 1. / 1.1 w numerowanym punkcie („” — lista najwyższego poziomu).
    private static func writeList(_ list: ContractList, insideOrdered: Bool, context inherited: String?) -> String {
        let outline = list.ordered && ContractStructure.isOutline(listAttributes: list.attributes)
        let context: String? = outline ? (inherited ?? (insideOrdered ? nil : "")) : nil
        var next = Int(list.attributes["start"] ?? "") ?? 1
        let tag = list.ordered ? "ol" : "ul"
        var html = "<\(tag)\(attributes(list.attributes))>"
        for item in list.items {
            var own = item.attributes
            own.removeValue(forKey: outlineNumber)
            own.removeValue(forKey: outlineSuppressed)
            var childContext: String?
            if let context {
                if ContractStructure.isPlaceholder(ownText(item)) {
                    own[outlineSuppressed] = "true"
                    childContext = context
                } else {
                    let explicit = Int(own["value"] ?? "") ?? 0
                    let number = explicit > 0 ? explicit : next
                    let full = context.isEmpty ? "\(number)" : "\(context).\(number)"
                    own[outlineNumber] = context.isEmpty ? "\(full)." : full
                    next = number + 1
                    childContext = full
                }
            }
            let heading = own[style] == "heading"
            html += "<li\(attributes(own))>\(writeItem(item.blocks, heading: heading, insideOrdered: insideOrdered || list.ordered, context: childContext))</li>"
        }
        return html + "</\(tag)>"
    }

    private static func writeItem(_ blocks: [ContractBlock], heading: Bool, insideOrdered: Bool, context: String?) -> String {
        var html = ""
        for (index, block) in blocks.enumerated() {
            switch block {
            case .paragraph(let paragraph):
                var own = paragraph.attributes
                if index == 0 && heading {
                    // Linia nagłówka sekcji — `<span>` nieodrywany od punktów pod nim.
                    own.removeValue(forKey: keep)
                    own.removeValue(forKey: style)
                    own[keep] = "true"
                    html += "<span\(attributes(own))>\(inlines(paragraph.inlines))</span>"
                    continue
                }
                own.removeValue(forKey: keep)
                if index == 0 && own.isEmpty {
                    html += inlines(paragraph.inlines)
                } else {
                    html += "<p\(attributes(own))>\(inlines(paragraph.inlines))</p>"
                }
            case .list(let list):
                html += writeList(list, insideOrdered: insideOrdered, context: context)
            default:
                html += write([block], nested: true, insideOrdered: insideOrdered)
            }
        }
        return html
    }

    private static func writeTable(_ table: ContractTable, insideOrdered: Bool) -> String {
        var html = "<table\(attributes(withoutMinWidth(table.attributes)))><tbody>"
        for row in table.rows {
            html += "<tr\(attributes(row.attributes))>"
            for cell in row.cells {
                let tag = cell.header ? "th" : "td"
                var own = withoutMinWidth(cell.attributes)
                if !ContractStyleInference.isStyleID(own[style]) { own[style] = "table" }
                var blocks = cell.blocks
                // Pusty akapit na końcu komórki (dodany przez edytor) — bez zapisu.
                if blocks.count > 1, case .paragraph(let last)? = blocks.last, last.inlines.isEmpty, last.attributes.isEmpty { blocks.removeLast() }
                var content = ""
                for (index, block) in blocks.enumerated() {
                    if index == 0, case .paragraph(let first) = block, first.attributes.isEmpty {
                        content += inlines(first.inlines)
                    } else if case .list(let list) = block {
                        content += writeList(list, insideOrdered: insideOrdered, context: nil)
                    } else {
                        content += write([block], nested: true, insideOrdered: insideOrdered)
                    }
                }
                html += "<\(tag)\(attributes(own))>\(content)</\(tag)>"
            }
            html += "</tr>"
        }
        return html + "</tbody></table>"
    }

    private static func withoutMinWidth(_ attributes: [String: String]) -> [String: String] {
        guard let css = attributes["style"] else { return attributes }
        var result = attributes
        let kept = ContractHTMLParser.declarations(css).filter { $0.0 != "min-width" }.map { "\($0.0): \($0.1)" }
        if kept.isEmpty { result.removeValue(forKey: "style") } else { result["style"] = kept.joined(separator: "; ") }
        return result
    }

    /// Tekst punktu bez list zagnieżdżonych (do rozpoznania punktu z tabelą pozycji oferty).
    private static func ownText(_ item: ContractDocumentListItem) -> String {
        item.blocks.map { block -> String in
            switch block {
            case .paragraph(let paragraph): return paragraph.plainText
            case .slot(let name, _): return "{{\(name)}}"
            default: return ""
            }
        }.joined()
    }

    // MARK: Treść w wierszu

    static func inlines(_ inlines: [ContractInline]) -> String {
        var html = ""
        for inline in inlines {
            switch inline {
            case .lineBreak:
                html += "<br>"
            case .image(let source):
                html += "<img src=\"\(escapeAttribute(source))\">"
            case .text(let text, let marks):
                var content = escapeText(text)
                var css: [String] = []
                if let color = marks.color { css.append("color: \(color)") }
                if let family = marks.fontFamily { css.append("font-family: \(family)") }
                if let size = marks.fontSizePt { css.append("font-size: \(String(format: "%g", size))pt") }
                if !css.isEmpty { content = "<span style=\"\(escapeAttribute(css.joined(separator: "; ")))\">\(content)</span>" }
                if marks.strike { content = "<s>\(content)</s>" }
                if marks.underline { content = "<u>\(content)</u>" }
                if marks.italic { content = "<em>\(content)</em>" }
                if marks.bold { content = "<strong>\(content)</strong>" }
                if let link = marks.link { content = "<a href=\"\(escapeAttribute(link))\">\(content)</a>" }
                html += content
            }
        }
        return html
    }

    private static func attributes(_ values: [String: String], first: String? = nil) -> String {
        let ordered = values.sorted { lhs, rhs in
            if lhs.key == first { return true }
            if rhs.key == first { return false }
            return lhs.key < rhs.key
        }
        return ordered.map { " \($0.key)=\"\(escapeAttribute($0.value))\"" }.joined()
    }

    static func escapeText(_ text: String) -> String {
        var result = ""
        result.reserveCapacity(text.count)
        for character in text {
            switch character {
            case "&": result += "&amp;"
            case "<": result += "&lt;"
            case ">": result += "&gt;"
            case "\u{00A0}": result += "&nbsp;"
            default: result.append(character)
            }
        }
        return result
    }

    static func escapeAttribute(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }
}

// MARK: Obraz w treści — rozmiar (% szerokości tekstu) i wyrównanie w `style` (jak zapisuje edytor CRM: styl bloku)

enum ContractImageLayout {
    private static let managed: Set<String> = ["width", "max-width", "height", "display", "margin", "margin-left", "margin-right"]

    static func declarations(_ attributes: [String: String]) -> [String: String] {
        Dictionary(ContractHTMLParser.declarations(attributes["style"] ?? ""), uniquingKeysWith: { _, last in last })
    }

    /// Szerokość w % szerokości tekstu (`style="width: 40%"` albo `width="40%"`); `nil` — rozmiar naturalny.
    static func widthPercent(_ attributes: [String: String]) -> Double? {
        let value = declarations(attributes)["width"] ?? attributes["width"] ?? ""
        guard value.hasSuffix("%"), let number = Double(value.dropLast().trimmingCharacters(in: .whitespaces)) else { return nil }
        return min(100, max(5, number))
    }

    static func alignment(_ attributes: [String: String]) -> String {
        let css = declarations(attributes)
        let left = css["margin-left"] ?? ""
        let right = css["margin-right"] ?? ""
        if let margin = css["margin"], margin.contains("auto") { return "center" }
        if left == "auto" && right == "auto" { return "center" }
        if left == "auto" { return "right" }
        return "left"
    }

    /// Atrybuty obrazu z nowym rozmiarem i wyrównaniem (pozostałe deklaracje `style` bez zmian).
    static func with(_ attributes: [String: String], width: Double, alignment: String) -> [String: String] {
        var result = attributes
        result.removeValue(forKey: "width")
        result.removeValue(forKey: "height")
        var css = ContractHTMLParser.declarations(attributes["style"] ?? "").filter { !managed.contains($0.0) }
        css.append(("display", "block"))
        css.append(("width", "\(Int(width.rounded()))%"))
        css.append(("max-width", "100%"))
        css.append(("height", "auto"))
        css.append(("margin-left", alignment == "left" ? "0" : "auto"))
        css.append(("margin-right", alignment == "right" ? "0" : "auto"))
        result["style"] = css.map { "\($0.0): \($0.1)" }.joined(separator: "; ")
        return result
    }
}
