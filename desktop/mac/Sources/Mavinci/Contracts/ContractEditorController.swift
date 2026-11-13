import AppKit
import SwiftUI

// MARK: Edytor szablonu umowy na Macu — treść, polecenia jak w edytorze CRM (galeria stylów, Enter / Tab / Backspace
// w punktach, pogrubienie…, wyrównanie, pola i miejsca na klauzule), cofanie i zapis w formacie CRM.
//
// Polecenia zmieniają tekst i miejsce akapitów (`ContractParagraphInfo`) bezpośrednio w `NSTextStorage`; wygląd
// (czcionki, wcięcia, numery) wylicza potem `ContractFormatter`. Cofanie to migawki całego tekstu (pisanie łączy się
// w jedną zmianę), więc każde polecenie cofa się w całości.

@MainActor final class ContractEditorController: NSObject, ObservableObject, NSTextViewDelegate, NSTextStorageDelegate {
    let templateID: String
    let payload: ContractTemplateDocumentPayload
    private(set) var context: ContractRenderContext
    let editable: Bool
    let storage = NSTextStorage()
    let undo: UndoManager = {
        let manager = UndoManager()
        manager.levelsOfUndo = 200
        return manager
    }()
    private let formatter: ContractFormatter
    private weak var textView: ContractEditorTextView?
    private weak var layout: ContractLayoutManager?
    private var decorations = ContractFormatter.Decorations()

    @Published private(set) var updatedAt: String?
    @Published private(set) var dirty = false
    @Published private(set) var stats = ContractDocumentStats(ContractDocument(blocks: []))
    @Published private(set) var styleID = "body"
    @Published private(set) var marks = ContractInlineMarks()
    @Published private(set) var alignment = "justify"
    @Published private(set) var inItem = false
    @Published private(set) var inCell = false
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false
    @Published var saving = false
    /// Układ strony (logo w nagłówku, stopka) — zapisywany razem z treścią.
    @Published private(set) var pageLayout = ContractPageLayout.standard
    /// Zapisane szablony stopek (edytor stopek odświeża listę po zapisie).
    @Published private(set) var footerTemplates: [ContractTemplateDocumentPayload.FooterTemplate] = []
    /// Opcje umowy szablonu (np. nocleg) — przełączane przy każdej umowie, używane w warunkach.
    @Published private(set) var options: [ContractOptionItem] = []
    /// Warunek najbliższego akapitu, punktu albo sekcji pod kursorem.
    @Published private(set) var conditionAtCursor: String?
    /// „Pokaż jako” — klient, kategoria i opcje; `nil` — cała treść.
    @Published var simulation: ContractSimulation? {
        didSet { if simulation != oldValue { applySimulation() } }
    }
    /// Obraz pod kursorem (rozmiar w %, wyrównanie) — do przycisków obrazu na wstążce.
    @Published private(set) var selectedImage: (width: Double, align: String)?
    var documentFont: String { context.styles.style("body").fontFamily }
    /// Licznik zmian — zapis zdejmuje „niezapisane zmiany” tylko, gdy w trakcie zapisu nic się nie zmieniło.
    private(set) var revision = 0

    private static let style = ContractHTMLParser.style
    private static let keep = ContractHTMLParser.keepWithNext

    init(templateID: String, payload: ContractTemplateDocumentPayload) {
        self.templateID = templateID
        self.payload = payload
        editable = payload.canEdit && payload.format == "word"
        let renderContext = ContractRenderContext(styles: payload.documentStyles, fieldLabels: payload.fieldLabels, slotLabels: payload.slotLabels, options: payload.options)
        context = renderContext
        formatter = ContractFormatter(context: renderContext)
        super.init()
        updatedAt = payload.updatedAt
        pageLayout = payload.layout ?? .standard
        footerTemplates = payload.footerTemplates ?? []
        options = payload.options
        let document = ContractHTMLParser.parse(payload.format == "word" ? payload.html : "")
        stats = ContractDocumentStats(document)
        storage.beginEditing()
        storage.setAttributedString(ContractDocumentBuilder.build(ContractFlattener.flatten(document.blocks), context: renderContext))
        decorations = formatter.format(storage, edited: nil)
        storage.endEditing()
        storage.delegate = self
    }

    func attach(textView: ContractEditorTextView, layout: ContractLayoutManager) {
        self.textView = textView
        self.layout = layout
        layout.decorations = decorations
        updateSelectionState()
    }

    // MARK: Formatowanie po każdej zmianie

    nonisolated func textStorage(_ textStorage: NSTextStorage, willProcessEditing editedMask: NSTextStorageEditActions, range editedRange: NSRange, changeInLength delta: Int) {
        MainActor.assumeIsolated {
            decorations = formatter.format(storage, edited: editedRange)
            layout?.decorations = decorations
            textView?.needsDisplay = true
        }
    }

    // MARK: Zapis

    /// HTML treści w formie zapisywanej przez edytor CRM.
    func html() -> String {
        let paragraphs = ContractDocumentSerializer.paragraphs(storage)
        return ContractHTMLWriter.html(ContractTreeBuilder.build(ContractStructure.normalize(paragraphs)))
    }

    /// Układ strony i style dokumentu do zapisu (JSON jak `page_settings` w CRM).
    func settingsPayload() -> (layout: JSONValue, styles: JSONValue) {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let layout = (try? encoder.encode(pageLayout)).flatMap { try? decoder.decode(JSONValue.self, from: $0) } ?? .null
        let styles = (try? encoder.encode(context.styles)).flatMap { try? decoder.decode(JSONValue.self, from: $0) } ?? .null
        return (layout, styles)
    }

    var optionsPayload: JSONValue {
        .array(options.map { .object(["key": .string($0.key), "label": .string($0.label), "defaultOn": .bool($0.defaultOn)]) })
    }

    func markSaved(updatedAt next: String, html: String, revision saved: Int) {
        updatedAt = next
        if revision == saved { dirty = false }
        stats = ContractDocumentStats(ContractHTMLParser.parse(html))
    }

    // MARK: Cofanie (migawki tekstu)

    private struct Snapshot {
        let text: NSAttributedString
        let selection: NSRange
    }

    private enum EditKind {
        case insert
        case delete
        case command
    }

    private var lastKind: EditKind?
    private var lastLocation = -1
    private var lastTime = Date.distantPast
    private var inCommand = false

    private func checkpoint(_ kind: EditKind, location: Int) {
        guard !inCommand else { return }
        let coalesce = kind != .command && kind == lastKind && location == lastLocation && Date().timeIntervalSince(lastTime) < 3
        if !coalesce { pushUndo() }
        lastKind = kind
        lastTime = Date()
    }

    private func snapshot() -> Snapshot {
        Snapshot(text: NSAttributedString(attributedString: storage), selection: textView?.selectedRange() ?? NSRange(location: 0, length: 0))
    }

    private func pushUndo() {
        let saved = snapshot()
        undo.registerUndo(withTarget: self) { target in MainActor.assumeIsolated { target.restore(saved) } }
        refreshUndoState()
    }

    private func restore(_ saved: Snapshot) {
        let current = snapshot()
        undo.registerUndo(withTarget: self) { target in MainActor.assumeIsolated { target.restore(current) } }
        storage.setAttributedString(saved.text)
        let location = min(saved.selection.location, storage.length)
        textView?.setSelectedRange(NSRange(location: location, length: min(saved.selection.length, storage.length - location)))
        textView?.scrollRangeToVisible(textView?.selectedRange() ?? NSRange(location: 0, length: 0))
        lastKind = nil
        changed()
    }

    func undoChange() {
        guard undo.canUndo else { NSSound.beep(); return }
        undo.undo()
        refreshUndoState()
    }

    func redoChange() {
        guard undo.canRedo else { NSSound.beep(); return }
        undo.redo()
        refreshUndoState()
    }

    private func refreshUndoState() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            if canUndo != undo.canUndo { canUndo = undo.canUndo }
            if canRedo != undo.canRedo { canRedo = undo.canRedo }
        }
    }

    private func changed() {
        revision += 1
        if !dirty { dirty = true }
        updateSelectionState()
        refreshUndoState()
    }

    /// Polecenie edytora: jedna migawka do cofnięcia, zmiany w jednej edycji tekstu, potem kursor (`body` zwraca zaznaczenie).
    private func perform(_ body: () -> NSRange?) {
        guard editable else { NSSound.beep(); return }
        checkpoint(.command, location: -1)
        inCommand = true
        storage.beginEditing()
        let selection = body()
        storage.endEditing()
        inCommand = false
        lastKind = nil
        if let selection, let textView {
            let location = min(max(0, selection.location), storage.length)
            textView.setSelectedRange(NSRange(location: location, length: min(selection.length, storage.length - location)))
            textView.scrollRangeToVisible(textView.selectedRange())
        }
        changed()
    }

    // MARK: Delegat pola tekstu

    func textView(_ textView: NSTextView, shouldChangeTextInRanges affectedRanges: [NSValue], replacementStrings: [String]?) -> Bool {
        guard editable else { return false }
        guard !inCommand else { return true }
        let range = affectedRanges.first?.rangeValue ?? NSRange(location: 0, length: 0)
        let text = replacementStrings?.first ?? ""
        let length = (text as NSString).length
        if text.isEmpty && range.length <= 1 && affectedRanges.count == 1 {
            checkpoint(.delete, location: NSMaxRange(range))
            lastLocation = range.location
        } else if length == 1 && range.length == 0 && text != "\n" && affectedRanges.count == 1 {
            checkpoint(.insert, location: range.location)
            lastLocation = range.location + 1
        } else {
            checkpoint(.command, location: -1)
            lastKind = nil
        }
        return true
    }

    func textDidChange(_ notification: Notification) {
        changed()
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        updateSelectionState()
        if let textView, textView.selectedRange().length > 0 || textView.selectedRange().location != lastLocation { lastKind = nil }
    }

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        guard editable else { return false }
        switch selector {
        case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
            return handleNewline()
        case #selector(NSResponder.insertLineBreak(_:)):
            insertLineBreak()
            return true
        case #selector(NSResponder.insertTab(_:)):
            return handleTab(outdent: false)
        case #selector(NSResponder.insertBacktab(_:)):
            return handleTab(outdent: true)
        case #selector(NSResponder.deleteBackward(_:)):
            return handleDeleteBackward()
        case #selector(NSResponder.deleteForward(_:)):
            return handleDeleteForward()
        default:
            return false
        }
    }

    /// Skróty edytora (jak w CRM): ⌘B ⌘I ⌘U, ⌘⇧X przekreślenie, ⌘Z / ⌘⇧Z, ⌘⌥0 Zwykły, ⌘⌥1 Nagłówek sekcji, ⌘⌥2…4 punkty.
    func handleKeyEquivalent(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .option, .shift, .control])
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
        if flags == [.command] {
            switch key {
            case "b": toggle(\.bold)
            case "i": toggle(\.italic)
            case "u": toggle(\.underline)
            case "z": undoChange()
            default: return false
            }
            return true
        }
        if flags == [.command, .shift] {
            switch key {
            case "z": redoChange()
            case "x": toggle(\.strike)
            default: return false
            }
            return true
        }
        if flags == [.command, .option] {
            let styles: [UInt16: String] = [29: "body", 82: "body", 18: "heading", 83: "heading", 19: "point", 84: "point",
                                            20: "subpoint", 85: "subpoint", 21: "subsubpoint", 86: "subsubpoint"]
            if let style = styles[event.keyCode] {
                applyStyle(style)
                return true
            }
        }
        return false
    }

    // MARK: Stan pod kursorem (wstążka)

    private func updateSelectionState() {
        guard let textView, storage.length > 0 else { return }
        let selection = textView.selectedRange()
        let location = min(selection.location, storage.length - 1)
        let paragraph = text.paragraphRange(for: NSRange(location: location, length: 0))
        let anchor = max(paragraph.location, min(NSMaxRange(paragraph) - 1, storage.length - 1))
        let info = storage.attribute(.contractBlock, at: anchor, effectiveRange: nil) as? ContractParagraphInfo
        let nextStyle = storage.attribute(.contractStyleID, at: paragraph.location, effectiveRange: nil) as? String ?? "body"
        if styleID != nextStyle { styleID = nextStyle }
        let cell = info?.path.contains { $0.cell != nil } ?? false
        if inCell != cell { inCell = cell }
        let item = info?.path.contains { $0.item != nil } ?? false
        if inItem != item { inItem = item }
        let own = ContractHTMLParser.declarations(info?.attributes["style"] ?? "").last { $0.0 == "text-align" }?.1
        let nextAlignment = own ?? context.styles.style(nextStyle).textAlign
        if alignment != nextAlignment { alignment = nextAlignment }
        let box = selection.length == 0
            ? textView.typingAttributes[.contractMarks]
            : storage.attribute(.contractMarks, at: min(selection.location, storage.length - 1), effectiveRange: nil)
        let nextMarks = (box as? ContractMarksBox)?.marks ?? ContractInlineMarks()
        if marks != nextMarks { marks = nextMarks }
        var image: (width: Double, align: String)?
        if case .image(let attributes)? = (storage.attribute(.contractObject, at: paragraph.location, effectiveRange: nil) as? ContractObjectBox)?.content {
            image = (ContractImageLayout.widthPercent(attributes) ?? 100, ContractImageLayout.alignment(attributes))
        }
        if selectedImage?.width != image?.width || selectedImage?.align != image?.align { selectedImage = image }
        let expression = info.flatMap { conditionTarget(of: $0)?.expression }
        if conditionAtCursor != expression { conditionAtCursor = expression }
    }

    // MARK: Akapity — pomocnicze

    private typealias Paragraph = ContractFormatter.Paragraph

    /// Tekst bez kopiowania (`storage.string` w Swifcie kopiuje całą treść).
    private var text: NSString { storage.mutableString }

    private func paragraphs() -> [Paragraph] { ContractFormatter.paragraphs(storage, repair: false) }

    private func roles(_ list: [Paragraph]) -> [ContractParagraphRole] {
        ContractFormatter.roles(list, string: text)
    }

    private func paragraphIndex(_ list: [Paragraph], at location: Int) -> Int {
        guard !list.isEmpty else { return 0 }
        var low = 0
        var high = list.count - 1
        while low < high {
            let middle = (low + high + 1) / 2
            if list[middle].range.location <= location { low = middle } else { high = middle - 1 }
        }
        return low
    }

    private func set(_ info: ContractParagraphInfo, on range: NSRange) {
        guard range.length > 0 else { return }
        storage.addAttribute(.contractBlock, value: info, range: range)
    }

    private func nearestItem(_ path: [ContractContainer]) -> (depth: Int, level: ContractItemLevel)? {
        for depth in stride(from: path.count - 1, through: 0, by: -1) {
            if let level = path[depth].item { return (depth, level) }
        }
        return nil
    }

    private func cellKey(_ path: [ContractContainer]) -> String? {
        for container in path.reversed() { if let cell = container.cell { return ContractFormatter.cellKey(cell) } }
        return nil
    }

    private func contains(_ paragraph: Paragraph, depth: Int, item: ContractItemLevel) -> Bool {
        paragraph.info.path.count > depth && paragraph.info.path[depth].same(.item(item))
    }

    private func itemRange(_ list: [Paragraph], depth: Int, item: ContractItemLevel, around position: Int) -> Range<Int> {
        var start = position
        while start > 0, contains(list[start - 1], depth: depth, item: item) { start -= 1 }
        var end = position + 1
        while end < list.count, contains(list[end], depth: depth, item: item) { end += 1 }
        return start..<end
    }

    /// Atrybuty wstawianego tekstu: formatowanie znaku przed kursorem (w tym samym akapicie) i miejsce akapitu.
    private func insertionAttributes(at location: Int, info: ContractParagraphInfo) -> [NSAttributedString.Key: Any] {
        var marks = ContractMarksBox.plain
        let string = text
        if location > 0, location <= string.length, string.character(at: location - 1) != 10,
           let box = storage.attribute(.contractMarks, at: location - 1, effectiveRange: nil) as? ContractMarksBox {
            marks = box
        }
        return [.contractMarks: marks, .contractBlock: info]
    }

    private static let itemComputed = ["value", "data-contract-outline-number", "data-contract-outline-suppressed"]

    // MARK: Enter

    private func handleNewline() -> Bool {
        guard let textView else { return false }
        if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
            insertLineBreak()
            return true
        }
        let selection = textView.selectedRange()
        let list = paragraphs()
        guard !list.isEmpty else { return false }
        let position = paragraphIndex(list, at: selection.location)
        let current = list[position]
        let role = roles(list)[position]
        // Enter w pustym punkcie — punkt wychodzi poziom wyżej (jak w Wordzie i w CRM).
        if selection.length == 0, role.inItem, current.contentLength == 0, !current.object, selection.location == current.range.location {
            perform {
                liftItem(at: current.range.location)
                return NSRange(location: current.range.location, length: 0)
            }
            return true
        }
        perform {
            if selection.length > 0 { storage.deleteCharacters(in: selection) }
            return NSRange(location: split(at: selection.location, interactive: true), length: 0)
        }
        return true
    }

    private func insertLineBreak() {
        guard let textView else { return }
        textView.insertText("\u{2028}", replacementRange: textView.selectedRange())
    }

    /// Nowy akapit w miejscu `location` (Enter) — zwraca położenie kursora. Punkt listy dzieli się na dwa punkty (dalsza
    /// treść punktu przechodzi do nowego), za nagłówkiem sekcji zaczyna się pierwszy punkt sekcji, za tytułem
    /// i nagłówkiem — zwykły akapit.
    private func split(at location: Int, interactive: Bool) -> Int {
        let list = paragraphs()
        let string = text
        guard !list.isEmpty else {
            storage.insert(NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain, .contractBlock: ContractParagraphInfo()]), at: 0)
            return 1
        }
        let position = paragraphIndex(list, at: location)
        let current = list[position]
        let info = current.info
        let plain: [NSAttributedString.Key: Any] = [.contractMarks: ContractMarksBox.plain]

        // Kursor w pustym wierszu za ostatnim akapitem.
        if location >= string.length, current.hasTerminator, NSMaxRange(current.range) <= location {
            var attributes = plain
            attributes[.contractBlock] = ContractParagraphInfo(tag: "p", attributes: [Self.style: "body"], path: [])
            storage.insert(NSAttributedString(string: "\n", attributes: attributes), at: string.length)
            return location
        }
        // Przy miejscu na klauzule — pusty akapit przed nim albo za nim.
        if current.object {
            var attributes = plain
            attributes[.contractBlock] = ContractParagraphInfo(tag: "p", attributes: [:], path: info.path)
            if location <= current.range.location {
                storage.insert(NSAttributedString(string: "\n", attributes: attributes), at: current.range.location)
                return current.range.location
            }
            let end = NSMaxRange(current.range)
            storage.insert(NSAttributedString(string: "\n", attributes: attributes), at: end)
            return end
        }

        let role = roles(list)[position]
        let atEnd = location >= current.contentsEnd
        var second = info.with(tag: "p", attributes: info.attributes.filter { $0.key != Self.keep })
        var moved: (old: ContractItemLevel, new: ContractItemLevel, depth: Int)?
        if role.inItem, case .item(let level)? = info.path.last {
            let depth = info.path.count - 1
            if interactive && role.section && role.firstInItem && atEnd {
                let next = position + 1 < list.count ? list[position + 1].info.path : []
                if next.count > depth + 1, next[depth].same(.item(level)), let nested = next[depth + 1].item {
                    let fresh = ContractItemLevel(listID: nested.listID, ordered: nested.ordered, listAttributes: nested.listAttributes, itemID: ContractIDs.next(), attributes: [:])
                    second = ContractParagraphInfo(tag: "p", attributes: [:], path: Array(info.path.prefix(depth + 1)) + [.item(fresh)])
                } else {
                    let fresh = ContractItemLevel(listID: ContractIDs.next(), ordered: true, listAttributes: [:], itemID: ContractIDs.next(), attributes: [:])
                    second = ContractParagraphInfo(tag: "p", attributes: [:], path: info.path + [.item(fresh)])
                }
            } else {
                var attributes = level.attributes
                Self.itemComputed.forEach { attributes.removeValue(forKey: $0) }
                let fresh = ContractItemLevel(listID: level.listID, ordered: level.ordered, listAttributes: level.listAttributes, itemID: ContractIDs.next(), attributes: attributes)
                var path = info.path
                path[depth] = .item(fresh)
                second = second.with(path: path)
                moved = (level, fresh, depth)
            }
        } else if !role.inCell, atEnd, role.styleID == "title" || role.styleID == "heading" {
            var attributes = info.attributes
            attributes[Self.style] = "body"
            attributes.removeValue(forKey: Self.keep)
            attributes.removeValue(forKey: "style")
            second = info.with(tag: "p", attributes: attributes)
        }

        storage.insert(NSAttributedString(string: "\n", attributes: insertionAttributes(at: location, info: info)), at: location)
        set(info, on: NSRange(location: current.range.location, length: location + 1 - current.range.location))
        let secondEnd = NSMaxRange(current.range) + 1
        set(second, on: NSRange(location: location + 1, length: secondEnd - location - 1))
        if let moved {
            // Dalsza treść dzielonego punktu (kolejne akapity, podpunkty) należy do nowego punktu.
            var next = position + 1
            while next < list.count, contains(list[next], depth: moved.depth, item: moved.old) {
                let paragraph = list[next]
                var path = paragraph.info.path
                path[moved.depth] = .item(moved.new)
                set(paragraph.info.with(path: path), on: NSRange(location: paragraph.range.location + 1, length: paragraph.range.length))
                next += 1
            }
        }
        return location + 1
    }

    // MARK: Tab / Shift-Tab — poziom punktu, przejście między komórkami

    private func handleTab(outdent: Bool) -> Bool {
        guard let textView else { return false }
        let selection = textView.selectedRange()
        let list = paragraphs()
        guard !list.isEmpty else { return true }
        let position = paragraphIndex(list, at: selection.location)
        let path = list[position].info.path
        let item = nearestItem(path)
        let cellDepth = path.lastIndex { $0.cell != nil }
        if let cellDepth, item.map({ $0.depth < cellDepth }) ?? true {
            moveToCell(forward: !outdent, from: position, list: list)
            return true
        }
        guard item != nil else {
            NSSound.beep()
            return true
        }
        changeLevel(outdent: outdent, selection: selection)
        return true
    }

    func indent() { if let textView { changeLevel(outdent: false, selection: textView.selectedRange()) } }
    func outdent() { if let textView { changeLevel(outdent: true, selection: textView.selectedRange()) } }

    private func changeLevel(outdent: Bool, selection: NSRange) {
        perform {
            var handled = Set<Int>()
            var location = selection.location
            let end = NSMaxRange(selection)
            var failed = false
            repeat {
                let list = paragraphs()
                guard !list.isEmpty else { break }
                let position = paragraphIndex(list, at: location)
                if case let (_, level)? = nearestItem(list[position].info.path), handled.insert(level.itemID).inserted {
                    let done = outdent ? liftItem(at: location) : sinkItem(at: location)
                    if !done { failed = true }
                }
                location = NSMaxRange(list[position].range)
            } while location < end && location < storage.length
            if failed { NSSound.beep() }
            return selection
        }
    }

    private func moveToCell(forward: Bool, from position: Int, list: [Paragraph]) {
        guard let key = cellKey(list[position].info.path) else { return }
        let table = key.split(separator: ":").first.map(String.init)
        func sameTable(_ paragraph: Paragraph) -> Bool { cellKey(paragraph.info.path)?.split(separator: ":").first.map(String.init) == table }
        var target: Int?
        if forward {
            var next = position + 1
            while next < list.count, cellKey(list[next].info.path) == key { next += 1 }
            if next < list.count, sameTable(list[next]) { target = next }
        } else {
            var previous = position - 1
            while previous >= 0, cellKey(list[previous].info.path) == key { previous -= 1 }
            if previous >= 0, sameTable(list[previous]), let previousKey = cellKey(list[previous].info.path) {
                var start = previous
                while start > 0, cellKey(list[start - 1].info.path) == previousKey { start -= 1 }
                target = start
            }
        }
        guard let target, let textView else { NSSound.beep(); return }
        textView.setSelectedRange(NSRange(location: list[target].range.location, length: list[target].contentLength))
        textView.scrollRangeToVisible(textView.selectedRange())
    }

    /// Punkt staje się podpunktem poprzedniego punktu tej samej listy (dołącza do jego listy podpunktów).
    @discardableResult private func sinkItem(at location: Int) -> Bool {
        let list = paragraphs()
        guard !list.isEmpty else { return false }
        let position = paragraphIndex(list, at: location)
        guard case let (depth, level)? = nearestItem(list[position].info.path) else { return false }
        let range = itemRange(list, depth: depth, item: level, around: position)
        guard range.lowerBound > 0 else { return false }
        let before = list[range.lowerBound - 1].info.path
        guard before.count > depth, let parent = before[depth].item, parent.listID == level.listID,
              ContractStructure.samePrefix(before, list[position].info.path, count: depth) else { return false }
        let join = before.count > depth + 1 ? before[depth + 1].item : nil
        var attributes = level.attributes
        Self.itemComputed.forEach { attributes.removeValue(forKey: $0) }
        if attributes[Self.style] == "heading" { attributes.removeValue(forKey: Self.style) }
        let sunk = ContractItemLevel(listID: join?.listID ?? ContractIDs.next(), ordered: join?.ordered ?? level.ordered,
                                     listAttributes: join?.listAttributes ?? [:], itemID: level.itemID, attributes: attributes)
        for index in range {
            let paragraph = list[index]
            var path = Array(paragraph.info.path.prefix(depth))
            path.append(before[depth])
            path.append(.item(sunk))
            path.append(contentsOf: paragraph.info.path.dropFirst(depth + 1))
            set(paragraph.info.with(path: path), on: paragraph.range)
        }
        return true
    }

    /// Punkt wychodzi poziom wyżej: do listy nadrzędnej (kolejne punkty jego listy stają się jego podpunktami) albo —
    /// na pierwszym poziomie — poza listę jako zwykły akapit.
    @discardableResult private func liftItem(at location: Int) -> Bool {
        let list = paragraphs()
        guard !list.isEmpty else { return false }
        let position = paragraphIndex(list, at: location)
        let path = list[position].info.path
        guard case let (depth, level)? = nearestItem(path) else { return false }
        let range = itemRange(list, depth: depth, item: level, around: position)
        var attributes = level.attributes
        Self.itemComputed.forEach { attributes.removeValue(forKey: $0) }
        if depth > 0, let parent = path[depth - 1].item {
            let lifted = ContractItemLevel(listID: parent.listID, ordered: parent.ordered, listAttributes: parent.listAttributes, itemID: level.itemID, attributes: attributes)
            for index in range {
                let paragraph = list[index]
                var next = Array(paragraph.info.path.prefix(depth - 1))
                next.append(.item(lifted))
                next.append(contentsOf: paragraph.info.path.dropFirst(depth + 1))
                set(paragraph.info.with(path: next), on: paragraph.range)
            }
            var index = range.upperBound
            while index < list.count {
                let paragraph = list[index]
                guard paragraph.info.path.count > depth, paragraph.info.path[depth - 1].same(.item(parent)),
                      paragraph.info.path[depth].item?.listID == level.listID else { break }
                var next = Array(paragraph.info.path.prefix(depth - 1))
                next.append(.item(lifted))
                next.append(contentsOf: paragraph.info.path.dropFirst(depth))
                set(paragraph.info.with(path: next), on: paragraph.range)
                index += 1
            }
        } else {
            for index in range {
                let paragraph = list[index]
                var next = paragraph.info.path
                next.remove(at: depth)
                var own = paragraph.info.attributes
                if next.count == depth && !paragraph.object {
                    if !ContractStructure.paragraphStyles.contains(own[Self.style] ?? "") { own[Self.style] = "body" }
                    own.removeValue(forKey: Self.keep)
                }
                set(paragraph.info.with(attributes: own, path: next), on: paragraph.range)
            }
        }
        return true
    }

    // MARK: Backspace / Delete na granicy akapitów

    private func sameCell(_ first: Paragraph, _ second: Paragraph) -> Bool { cellKey(first.info.path) == cellKey(second.info.path) }

    private func handleDeleteBackward() -> Bool {
        guard let textView else { return false }
        let selection = textView.selectedRange()
        guard selection.length == 0, selection.location > 0 else { return false }
        let list = paragraphs()
        guard !list.isEmpty else { return false }
        let position = paragraphIndex(list, at: selection.location)
        let current = list[position]
        guard selection.location == current.range.location else { return false }
        let role = roles(list)[position]
        if role.inItem && role.firstInItem {
            // Backspace na początku punktu — punkt wychodzi poziom wyżej (numer znika jak w Wordzie).
            perform {
                liftItem(at: selection.location)
                return selection
            }
            return true
        }
        guard position > 0 else { return true }
        let previous = list[position - 1]
        guard sameCell(previous, current) else { NSSound.beep(); return true }
        if previous.object {
            perform {
                storage.deleteCharacters(in: previous.range)
                return NSRange(location: previous.range.location, length: 0)
            }
            return true
        }
        if current.object {
            if previous.contentLength == 0 {
                perform {
                    storage.deleteCharacters(in: previous.range)
                    return NSRange(location: previous.range.location, length: 0)
                }
            } else {
                NSSound.beep()
            }
            return true
        }
        // Scalenie z poprzednim akapitem — zostaje jego styl i miejsce w liście.
        perform {
            let terminator = NSRange(location: previous.contentsEnd, length: NSMaxRange(previous.range) - previous.contentsEnd)
            storage.deleteCharacters(in: terminator)
            set(previous.info, on: NSRange(location: previous.range.location, length: previous.contentLength + current.range.length))
            return NSRange(location: previous.contentsEnd, length: 0)
        }
        return true
    }

    private func handleDeleteForward() -> Bool {
        guard let textView else { return false }
        let selection = textView.selectedRange()
        guard selection.length == 0 else { return false }
        let list = paragraphs()
        guard !list.isEmpty else { return false }
        let position = paragraphIndex(list, at: selection.location)
        let current = list[position]
        guard selection.location == current.contentsEnd, current.hasTerminator, position + 1 < list.count else { return false }
        let next = list[position + 1]
        guard sameCell(current, next) else { NSSound.beep(); return true }
        if next.object {
            perform {
                storage.deleteCharacters(in: next.range)
                return selection
            }
            return true
        }
        if current.object {
            if next.contentLength == 0 {
                perform {
                    storage.deleteCharacters(in: next.range)
                    return selection
                }
            } else {
                NSSound.beep()
            }
            return true
        }
        perform {
            let terminator = NSRange(location: current.contentsEnd, length: NSMaxRange(current.range) - current.contentsEnd)
            storage.deleteCharacters(in: terminator)
            set(current.info, on: NSRange(location: current.range.location, length: current.contentLength + next.range.length))
            return selection
        }
        return true
    }

    // MARK: Wklejanie (tekst; każdy wiersz jak po Enter)

    func pastePlainText() {
        guard editable, let textView, var text = NSPasteboard.general.string(forType: .string) else { return }
        text = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\u{2029}", with: "\n").replacingOccurrences(of: "\t", with: " ")
            .replacingOccurrences(of: "\u{FFFC}", with: "")
        guard !text.isEmpty else { return }
        let selection = textView.selectedRange()
        perform {
            if selection.length > 0 { storage.deleteCharacters(in: selection) }
            var location = selection.location
            for (number, line) in text.components(separatedBy: "\n").enumerated() {
                if number > 0 { location = split(at: location, interactive: false) }
                guard !line.isEmpty else { continue }
                let list = paragraphs()
                let info = list.isEmpty ? ContractParagraphInfo() : list[paragraphIndex(list, at: location)].info
                storage.insert(NSAttributedString(string: line, attributes: insertionAttributes(at: location, info: info)), at: location)
                location += (line as NSString).length
            }
            return NSRange(location: location, length: 0)
        }
    }

    // MARK: Style dokumentu (galeria stylów jak `applyContractStyle` w CRM)

    func applyStyle(_ id: String) {
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            var handled = Set<Int>()
            var location = selection.location
            let end = NSMaxRange(selection)
            repeat {
                let list = paragraphs()
                guard !list.isEmpty else { break }
                let position = paragraphIndex(list, at: location)
                let range = list[position].range
                applyStyle(id, at: range.location, handled: &handled)
                location = NSMaxRange(range)
            } while location < end && location < storage.length
            return selection
        }
    }

    private func applyStyle(_ id: String, at location: Int, handled: inout Set<Int>) {
        var list = paragraphs()
        var position = paragraphIndex(list, at: location)
        let role = roles(list)[position]
        guard !role.inCell, !list[position].object else { return }
        switch id {
        case "title", "body":
            liftOutOfLists(at: location)
            setParagraphStyle(id, at: location)
        case "heading":
            if case let (depth, level)? = nearestItem(list[position].info.path), role.listDepth == 1, level.ordered {
                guard handled.insert(level.itemID).inserted else { return }
                updateItem(level, depth: depth) { $0[Self.style] = "heading" }
            } else {
                liftOutOfLists(at: location)
                setParagraphStyle("heading", at: location)
            }
        default:
            guard let target = ContractStructure.pointStyles.firstIndex(of: id).map({ $0 + 1 }) else { return }
            if nearestItem(list[position].info.path) == nil { wrapInList(at: location) }
            list = paragraphs()
            position = paragraphIndex(list, at: location)
            guard case let (depth, level)? = nearestItem(list[position].info.path), handled.insert(level.itemID).inserted else { return }
            if level.attributes[Self.style] == "heading" { updateItem(level, depth: depth) { $0[Self.style] = "point" } }
            var guardCount = 6
            while guardCount > 0, pointLevel(at: location) < target, sinkItem(at: location) { guardCount -= 1 }
            while guardCount > 0, pointLevel(at: location) > target, liftItem(at: location) { guardCount -= 1 }
        }
    }

    private func pointLevel(at location: Int) -> Int {
        let list = paragraphs()
        guard !list.isEmpty else { return 0 }
        return roles(list)[paragraphIndex(list, at: location)].pointLevel
    }

    private func liftOutOfLists(at location: Int) {
        var guardCount = 10
        while guardCount > 0 {
            let list = paragraphs()
            guard !list.isEmpty, nearestItem(list[paragraphIndex(list, at: location)].info.path) != nil, liftItem(at: location) else { return }
            guardCount -= 1
        }
    }

    private func setParagraphStyle(_ id: String, at location: Int) {
        let list = paragraphs()
        guard !list.isEmpty else { return }
        let paragraph = list[paragraphIndex(list, at: location)]
        var own = paragraph.info.attributes
        own[Self.style] = id
        own.removeValue(forKey: Self.keep)
        set(paragraph.info.with(tag: "p", attributes: own), on: paragraph.range)
    }

    /// Zmiana atrybutów punktu we wszystkich jego akapitach (punkt to ten sam poziom w ścieżce każdego z nich).
    private func updateItem(_ level: ContractItemLevel, depth: Int, _ change: (inout [String: String]) -> Void) {
        var attributes = level.attributes
        change(&attributes)
        var updated = level
        updated.attributes = attributes
        for paragraph in paragraphs() where contains(paragraph, depth: depth, item: level) {
            var path = paragraph.info.path
            path[depth] = .item(updated)
            set(paragraph.info.with(path: path), on: paragraph.range)
        }
    }

    /// Akapit staje się punktem listy numerowanej — dołącza do listy bezpośrednio przed nim albo za nim (jak w CRM).
    private func wrapInList(at location: Int) {
        let list = paragraphs()
        guard !list.isEmpty else { return }
        let position = paragraphIndex(list, at: location)
        let paragraph = list[position]
        let path = paragraph.info.path
        let depth = path.count
        func joinable(_ other: Int) -> ContractItemLevel? {
            guard other >= 0, other < list.count else { return nil }
            let otherPath = list[other].info.path
            guard otherPath.count > depth, ContractStructure.samePrefix(otherPath, path, count: depth),
                  let level = otherPath[depth].item, level.ordered else { return nil }
            return level
        }
        let previous = joinable(position - 1)
        let next = joinable(position + 1)
        let base = previous ?? next
        let level = ContractItemLevel(listID: base?.listID ?? ContractIDs.next(), ordered: true, listAttributes: base?.listAttributes ?? [:],
                                      itemID: ContractIDs.next(), attributes: [:])
        var own = paragraph.info.attributes
        own.removeValue(forKey: Self.style)
        own.removeValue(forKey: Self.keep)
        set(paragraph.info.with(tag: "p", attributes: own, path: path + [.item(level)]), on: paragraph.range)
        // Dwie sąsiednie listy łączą się w jedną.
        if let previous, let next, next.listID != previous.listID {
            var index = position + 1
            while index < list.count {
                let other = list[index]
                guard other.info.path.count > depth, ContractStructure.samePrefix(other.info.path, path, count: depth),
                      var item = other.info.path[depth].item, item.listID == next.listID else { break }
                item.listID = previous.listID
                item.ordered = previous.ordered
                item.listAttributes = previous.listAttributes
                var otherPath = other.info.path
                otherPath[depth] = .item(item)
                set(other.info.with(path: otherPath), on: other.range)
                index += 1
            }
        }
    }

    // MARK: Formatowanie znaków i wyrównanie

    func toggle(_ mark: WritableKeyPath<ContractInlineMarks, Bool>) {
        guard editable, let textView else { return }
        let selection = textView.selectedRange()
        if selection.length == 0 {
            var current = (textView.typingAttributes[.contractMarks] as? ContractMarksBox)?.marks ?? ContractInlineMarks()
            current[keyPath: mark].toggle()
            var typing = textView.typingAttributes
            typing[.contractMarks] = ContractMarksBox(current)
            typing.merge(ContractFormatter.characterAttributes(current, style: context.styles.style(styleID))) { _, new in new }
            textView.typingAttributes = typing
            marks = current
            return
        }
        let string = text
        var all = true
        storage.enumerateAttribute(.contractMarks, in: selection, options: []) { value, range, stop in
            if string.substring(with: range).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
            if (value as? ContractMarksBox)?.marks[keyPath: mark] != true {
                all = false
                stop.pointee = true
            }
        }
        perform {
            storage.enumerateAttribute(.contractMarks, in: selection, options: []) { value, range, _ in
                var next = (value as? ContractMarksBox)?.marks ?? ContractInlineMarks()
                next[keyPath: mark] = !all
                storage.addAttribute(.contractMarks, value: ContractMarksBox(next), range: range)
            }
            return selection
        }
    }

    func setAlignment(_ value: String) {
        if selectedImage != nil {
            updateImage(alignment: value == "justify" ? "center" : value)
            return
        }
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            var location = selection.location
            let end = NSMaxRange(selection)
            repeat {
                let list = paragraphs()
                guard !list.isEmpty else { break }
                let paragraph = list[paragraphIndex(list, at: location)]
                if !paragraph.object {
                    let styleID = storage.attribute(.contractStyleID, at: paragraph.range.location, effectiveRange: nil) as? String ?? "body"
                    var declarations = ContractHTMLParser.declarations(paragraph.info.attributes["style"] ?? "").filter { $0.0 != "text-align" }
                    if value != context.styles.style(styleID).textAlign { declarations.append(("text-align", value)) }
                    var own = paragraph.info.attributes
                    own["style"] = declarations.isEmpty ? nil : declarations.map { "\($0.0): \($0.1)" }.joined(separator: "; ")
                    set(paragraph.info.with(attributes: own), on: paragraph.range)
                }
                location = NSMaxRange(paragraph.range)
            } while location < end && location < storage.length
            return selection
        }
    }

    // MARK: Wstaw

    /// Pole umowy (`{{klucz}}`) albo numer paragrafu („§n”) w miejscu kursora.
    func insertField(_ text: String) {
        guard editable, let textView else { NSSound.beep(); return }
        textView.window?.makeFirstResponder(textView)
        textView.insertText(text, replacementRange: textView.selectedRange())
    }

    /// Miejsce na klauzule produktów — w pustym akapicie zamiast niego, w innym — pod nim.
    func insertSlot(_ name: String, label: String) {
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard !list.isEmpty else { return nil }
            let current = list[paragraphIndex(list, at: selection.location)]
            let piece = NSMutableAttributedString(attributedString: ContractDocumentBuilder.object(
                .slot(name: name, attributes: [ContractHTMLParser.clauseSlot: name, "data-clause-label": label]), context: context))
            piece.append(NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain]))
            piece.addAttribute(.contractBlock, value: ContractParagraphInfo(tag: "div", attributes: [:], path: current.info.path), range: NSRange(location: 0, length: piece.length))
            if current.contentLength == 0 && !current.object && current.hasTerminator {
                storage.replaceCharacters(in: current.range, with: piece)
                return NSRange(location: current.range.location + piece.length, length: 0)
            }
            var at = NSMaxRange(current.range)
            if !current.hasTerminator {
                storage.insert(NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain, .contractBlock: current.info]), at: at)
                at += 1
            }
            storage.insert(piece, at: at)
            return NSRange(location: at + piece.length, length: 0)
        }
    }

    // MARK: Obrazy w treści

    /// Obraz (logo, grafika) jako osobny akapit — w pustym akapicie zamiast niego, w innym — pod nim.
    func insertImage(_ source: String, width: Double, alignment: String = "center") {
        guard let textView else { return }
        textView.window?.makeFirstResponder(textView)
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard !list.isEmpty else { return nil }
            let current = list[paragraphIndex(list, at: selection.location)]
            let attributes = ContractImageLayout.with(["src": source, "alt": "Obraz"], width: width, alignment: alignment)
            let piece = NSMutableAttributedString(attributedString: ContractDocumentBuilder.object(.image(attributes: attributes), context: context))
            piece.append(NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain]))
            piece.addAttribute(.contractBlock, value: ContractParagraphInfo(tag: "img", attributes: [:], path: current.info.path), range: NSRange(location: 0, length: piece.length))
            if current.contentLength == 0 && !current.object && current.hasTerminator {
                storage.replaceCharacters(in: current.range, with: piece)
                return NSRange(location: current.range.location, length: 0)
            }
            var at = NSMaxRange(current.range)
            if !current.hasTerminator {
                storage.insert(NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain, .contractBlock: current.info]), at: at)
                at += 1
            }
            storage.insert(piece, at: at)
            return NSRange(location: at, length: 0)
        }
    }

    /// Rozmiar (% szerokości tekstu) i wyrównanie obrazu pod kursorem.
    func updateImage(width: Double? = nil, alignment: String? = nil) {
        guard let textView, let current = selectedImage else { return }
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard !list.isEmpty else { return nil }
            let paragraph = list[paragraphIndex(list, at: selection.location)]
            guard paragraph.object,
                  case .image(let attributes)? = (storage.attribute(.contractObject, at: paragraph.range.location, effectiveRange: nil) as? ContractObjectBox)?.content
            else { return nil }
            let next = ContractImageLayout.with(attributes, width: width ?? current.width, alignment: alignment ?? current.align)
            let piece = NSMutableAttributedString(attributedString: ContractDocumentBuilder.object(.image(attributes: next), context: context))
            piece.addAttribute(.contractBlock, value: paragraph.info, range: NSRange(location: 0, length: piece.length))
            storage.replaceCharacters(in: NSRange(location: paragraph.range.location, length: 1), with: piece)
            return NSRange(location: paragraph.range.location, length: 0)
        }
    }

    // MARK: Układ strony i czcionka dokumentu

    /// Zmiana układu strony (logo w nagłówku, stopka) — zapis razem z treścią.
    func updateLayout(_ change: (inout ContractPageLayout) -> Void) {
        guard editable else { return }
        var next = pageLayout
        change(&next)
        guard next != pageLayout else { return }
        pageLayout = next
        changed()
    }

    /// Dane stopki z zapisanego szablonu stopki (jak „Stopka” w zakładce „Układ” w CRM); `nil` — dane z szablonu umowy.
    func selectFooterTemplate(_ id: String?) {
        guard let id, let footer = footerTemplates.first(where: { $0.id == id }) else {
            updateLayout { $0.selectedFooterTemplateId = nil }
            return
        }
        updateLayout {
            $0.selectedFooterTemplateId = id
            $0.footerContent = ContractPageLayout.Footer(companyName: footer.companyName, tagline: footer.tagline, website: footer.website,
                                                         email: footer.email, phone: footer.phone, logoUrl: footer.logoUrl)
            $0.footerLogoScale = footer.logoScale
        }
    }

    func replaceFooterTemplates(_ list: [ContractTemplateDocumentPayload.FooterTemplate]) {
        footerTemplates = list
        if let id = pageLayout.selectedFooterTemplateId, !list.contains(where: { $0.id == id }) {
            updateLayout { $0.selectedFooterTemplateId = nil }
        }
    }

    /// Stopka z edytora stopek: dane, rozmiar logo, wariant i (gdy dane są z zapisanego szablonu) jego identyfikator.
    func applyFooter(_ footer: ContractPageLayout.Footer, logoScale: Double, variant: String, templateID: String?) {
        updateLayout {
            $0.footerContent = footer
            $0.footerLogoScale = logoScale
            $0.selectedFooter = variant
            $0.selectedFooterTemplateId = templateID
        }
    }

    /// Czcionka we wszystkich stylach dokumentu (jak „Czcionka dokumentu” w CRM).
    func setDocumentFont(_ family: String) {
        guard editable, family != documentFont else { return }
        var styles = context.styles
        for id in Array(styles.styles.keys) { styles.styles[id]?.fontFamily = family }
        context.styles = styles
        formatter.context = context
        storage.beginEditing()
        storage.edited(.editedAttributes, range: NSRange(location: 0, length: storage.length), changeInLength: 0)
        storage.endEditing()
        changed()
    }

    // MARK: Warunki (jak zakładka „Warunki” w CRM)

    enum ConditionTarget {
        case paragraph(String)
        case item(depth: Int, level: ContractItemLevel, String)
        case section(id: Int, String)

        var expression: String {
            switch self {
            case .paragraph(let value), .item(_, _, let value), .section(_, let value): return value
            }
        }
    }

    /// Najbliższy element z warunkiem: akapit, punkt listy albo sekcja (od środka na zewnątrz).
    func conditionTarget(of info: ContractParagraphInfo) -> ConditionTarget? {
        if let own = info.attributes[ContractHTMLParser.condition], !own.isEmpty { return .paragraph(own) }
        for depth in stride(from: info.path.count - 1, through: 0, by: -1) {
            switch info.path[depth] {
            case .item(let level):
                if let value = level.attributes[ContractHTMLParser.condition], !value.isEmpty { return .item(depth: depth, level: level, value) }
            case .section(let id, let value, _):
                return .section(id: id, value)
            case .cell:
                break
            }
        }
        return nil
    }

    private func selectionParagraphs(_ list: [Paragraph], _ selection: NSRange) -> ClosedRange<Int> {
        let first = paragraphIndex(list, at: selection.location)
        let last = selection.length > 0 ? paragraphIndex(list, at: NSMaxRange(selection) - 1) : first
        return first...max(first, last)
    }

    /// Opis miejsca warunku do okna („Akapit”, „Punkt listy”, „Sekcja”, „Zaznaczone akapity (sekcja)”).
    func conditionScope(editing: Bool) -> String {
        guard let textView else { return "Akapit" }
        let list = paragraphs()
        guard !list.isEmpty else { return "Akapit" }
        let range = selectionParagraphs(list, textView.selectedRange())
        let info = list[range.lowerBound].info
        if editing, range.count == 1, let target = conditionTarget(of: info) {
            switch target {
            case .paragraph: return "Akapit"
            case .item: return "Punkt listy"
            case .section: return "Sekcja"
            }
        }
        if range.count > 1 { return sameListItems(list, range) != nil ? "Zaznaczone punkty listy" : "Zaznaczone akapity (sekcja)" }
        return nearestItem(info.path) != nil ? "Punkt listy" : "Akapit"
    }

    /// Wspólny początek ścieżek zaznaczonych akapitów.
    private func commonDepth(_ list: [Paragraph], _ range: ClosedRange<Int>) -> Int {
        var depth = list[range.lowerBound].info.path.count
        for index in range { depth = min(depth, list[index].info.path.count) }
        while depth > 0, !range.allSatisfy({ ContractStructure.samePrefix(list[$0].info.path, list[range.lowerBound].info.path, count: depth) }) { depth -= 1 }
        return depth
    }

    /// Zaznaczone akapity leżą w punktach jednej listy — warunek dostaje każdy z tych punktów (numeracja zostaje).
    private func sameListItems(_ list: [Paragraph], _ range: ClosedRange<Int>) -> (depth: Int, items: [ContractItemLevel])? {
        let depth = commonDepth(list, range)
        var listID: Int?
        var items: [ContractItemLevel] = []
        for index in range {
            let path = list[index].info.path
            guard path.count > depth, let level = path[depth].item else { return nil }
            if listID == nil { listID = level.listID }
            guard level.listID == listID else { return nil }
            if !items.contains(where: { $0.itemID == level.itemID }) { items.append(level) }
        }
        return items.isEmpty ? nil : (depth, items)
    }

    /// Nadaje warunek: bez zaznaczenia — istniejącemu warunkowi w tym miejscu, punktowi listy albo akapitowi;
    /// zaznaczonym punktom jednej listy — każdemu punktowi; innym zaznaczonym akapitom — nowa sekcja warunkowa.
    func setCondition(_ expression: String) {
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard !list.isEmpty else { return nil }
            let range = selectionParagraphs(list, selection)
            let current = list[range.lowerBound]
            if range.count == 1 {
                if let target = conditionTarget(of: current.info) {
                    replaceCondition(target, with: expression, paragraph: current)
                } else if case let (depth, level)? = nearestItemTuple(current.info.path) {
                    updateItem(level, depth: depth) { $0[ContractHTMLParser.condition] = expression }
                } else {
                    var own = current.info.attributes
                    own[ContractHTMLParser.condition] = expression
                    set(current.info.with(attributes: own), on: current.range)
                }
                return selection
            }
            if case let (depth, items)? = sameListItems(list, range) {
                for level in items {
                    let fresh = paragraphs().first { $0.info.path.count > depth && $0.info.path[depth].same(.item(level)) }
                    if let fresh, let latest = fresh.info.path[depth].item { updateItem(latest, depth: depth) { $0[ContractHTMLParser.condition] = expression } }
                }
                return selection
            }
            // Sekcja: całe punkty, tabele i sekcje na wspólnym poziomie zaznaczenia.
            let depth = commonDepth(list, range)
            var first = range.lowerBound
            var last = range.upperBound
            if list[first].info.path.count > depth {
                while first > 0, ContractStructure.samePrefix(list[first - 1].info.path, list[first].info.path, count: depth + 1) { first -= 1 }
            }
            if list[last].info.path.count > depth {
                while last + 1 < list.count, ContractStructure.samePrefix(list[last + 1].info.path, list[last].info.path, count: depth + 1) { last += 1 }
            }
            let section = ContractContainer.section(id: ContractIDs.next(), condition: expression, attributes: [:])
            for index in first...last {
                var path = list[index].info.path
                path.insert(section, at: depth)
                set(list[index].info.with(path: path), on: list[index].range)
            }
            return selection
        }
    }

    private func nearestItemTuple(_ path: [ContractContainer]) -> (Int, ContractItemLevel)? {
        guard let found = nearestItem(path) else { return nil }
        return (found.depth, found.level)
    }

    private func replaceCondition(_ target: ConditionTarget, with expression: String?, paragraph: Paragraph) {
        switch target {
        case .paragraph:
            var own = paragraph.info.attributes
            own[ContractHTMLParser.condition] = expression
            set(paragraph.info.with(attributes: own), on: paragraph.range)
        case .item(let depth, let level, _):
            updateItem(level, depth: depth) { $0[ContractHTMLParser.condition] = expression }
        case .section(let id, _):
            for other in paragraphs() {
                guard let depth = other.info.path.firstIndex(where: { $0.sectionID == id }) else { continue }
                var path = other.info.path
                if let expression, case .section(_, _, let attributes) = path[depth] {
                    path[depth] = .section(id: id, condition: expression, attributes: attributes)
                } else {
                    path.remove(at: depth)
                }
                set(other.info.with(path: path), on: other.range)
            }
        }
    }

    /// Usuwa warunek z miejsca kursora (sekcja znika, jej treść zostaje).
    func removeCondition() {
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard !list.isEmpty else { return nil }
            let current = list[paragraphIndex(list, at: selection.location)]
            guard let target = conditionTarget(of: current.info) else { return nil }
            replaceCondition(target, with: nil, paragraph: current)
            return selection
        }
    }

    // MARK: Opcje umowy i „Pokaż jako”

    /// Ile warunków w treści używa każdej opcji (użytej nie da się usunąć — jak w CRM).
    func optionUsage() -> [String: Int] {
        var usage: [String: Int] = [:]
        var counted = Set<String>()
        func count(_ expression: String?, key: String) {
            guard let condition = ContractCondition.parse(expression), condition.kind == .option, counted.insert(key).inserted else { return }
            usage[String(condition.variable.dropFirst(ContractCondition.optionPrefix.count)), default: 0] += 1
        }
        for paragraph in paragraphs() {
            count(paragraph.info.attributes[ContractHTMLParser.condition], key: "p\(paragraph.range.location)")
            for container in paragraph.info.path {
                switch container {
                case .item(let level): count(level.attributes[ContractHTMLParser.condition], key: "i\(level.itemID)")
                case .section(let id, let expression, _): count(expression, key: "s\(id)")
                case .cell: break
                }
            }
        }
        return usage
    }

    func saveOptions(_ list: [ContractOptionItem]) {
        guard editable, list != options else { return }
        options = list
        context.options = list
        formatter.context = context
        if simulation != nil { applySimulation() } else { refreshDecorations() }
        changed()
    }

    func simulationVariables(_ value: ContractSimulation) -> [String: String] {
        var variables = [ContractCondition.clientVariable: value.client, ContractCondition.categoryVariable: value.category]
        for option in options {
            variables[ContractCondition.optionPrefix + option.key] = (value.options[option.key] ?? option.defaultOn) ? "tak" : ""
        }
        return variables
    }

    private func applySimulation() {
        formatter.simulation = simulation.map(simulationVariables)
        refreshDecorations()
    }

    /// Ponowne wyliczenie numerów, warunków i przygaszenia bez zmiany treści.
    private func refreshDecorations() {
        guard storage.length > 0 else { return }
        storage.beginEditing()
        storage.edited(.editedAttributes, range: NSRange(location: 0, length: 1), changeInLength: 0)
        storage.endEditing()
        textView?.needsDisplay = true
    }

    // MARK: Tabele (jak „Tabela” i „Podpisy” w CRM)

    private struct TableContext {
        let depth: Int
        let cell: ContractCellLevel
        let rows: [Int: [Int]]          // wiersz → indeksy akapitów
        let range: ClosedRange<Int>     // akapity całej tabeli
    }

    private func tableContext(_ list: [Paragraph], at location: Int) -> TableContext? {
        guard !list.isEmpty else { return nil }
        let position = paragraphIndex(list, at: location)
        let path = list[position].info.path
        guard let depth = path.lastIndex(where: { $0.cell != nil }), let cell = path[depth].cell else { return nil }
        func inTable(_ index: Int) -> Bool {
            let other = list[index].info.path
            return other.count > depth && other[depth].cell?.tableID == cell.tableID && ContractStructure.samePrefix(other, path, count: depth)
        }
        var first = position
        while first > 0, inTable(first - 1) { first -= 1 }
        var last = position
        while last + 1 < list.count, inTable(last + 1) { last += 1 }
        var rows: [Int: [Int]] = [:]
        for index in first...last { if let row = list[index].info.path[depth].cell?.row { rows[row, default: []].append(index) } }
        return TableContext(depth: depth, cell: cell, rows: rows, range: first...last)
    }

    private func setCell(_ paragraph: Paragraph, depth: Int, _ change: (inout ContractCellLevel) -> Void) {
        guard var level = paragraph.info.path[depth].cell else { return }
        change(&level)
        var path = paragraph.info.path
        path[depth] = .cell(level)
        set(paragraph.info.with(path: path), on: paragraph.range)
    }

    private func emptyCellParagraph(_ base: [ContractContainer], _ cell: ContractCellLevel, text: String = "", attributes: [String: String] = [:]) -> NSAttributedString {
        let piece = NSMutableAttributedString(string: text + "\n", attributes: [.contractMarks: ContractMarksBox.plain])
        piece.addAttribute(.contractBlock, value: ContractParagraphInfo(tag: "p", attributes: attributes, path: base + [.cell(cell)]), range: NSRange(location: 0, length: piece.length))
        return piece
    }

    /// Nowa tabela 2 × 2 albo miejsca na podpisy stron pod akapitem z kursorem (w pustym akapicie — zamiast niego).
    func insertTable(signatures: Bool) {
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard !list.isEmpty else { return nil }
            let current = list[paragraphIndex(list, at: selection.location)]
            guard !current.info.path.contains(where: { $0.cell != nil }) else { NSSound.beep(); return nil }
            let base = current.info.path
            let tableID = ContractIDs.next()
            let tableAttributes = signatures ? ["style": "width:100%;margin-top:14pt;border-collapse:collapse;"] : [:]
            let cellAttributes = signatures ? ["style": "width:50%;", "data-style": "table"] : ["data-style": "table"]
            let piece = NSMutableAttributedString()
            let rows = signatures ? 1 : 2
            for row in 0..<rows {
                for column in 0..<2 {
                    let cell = ContractCellLevel(tableID: tableID, tableAttributes: tableAttributes, row: row, rowAttributes: [:], column: column, header: false, attributes: cellAttributes)
                    if signatures {
                        piece.append(emptyCellParagraph(base, cell, text: column == 0 ? "ZAMAWIAJĄCY" : "WYKONAWCA"))
                        piece.append(emptyCellParagraph(base, cell, text: "……………………………………", attributes: ["style": "padding-top:35pt;"]))
                    } else {
                        piece.append(emptyCellParagraph(base, cell))
                    }
                }
            }
            var at = NSMaxRange(current.range)
            if current.contentLength == 0 && !current.object && current.hasTerminator && current.range.location > 0 {
                at = current.range.location
                storage.deleteCharacters(in: current.range)
            } else if !current.hasTerminator {
                storage.insert(NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain, .contractBlock: current.info]), at: at)
                at += 1
            }
            storage.insert(piece, at: at)
            // Akapit za tabelą, gdy tabela kończy dokument — żeby dało się pisać dalej.
            if at + piece.length >= storage.length {
                let after = NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain,
                                                                         .contractBlock: ContractParagraphInfo(tag: "p", attributes: [ContractHTMLParser.style: "body"], path: base)])
                storage.insert(after, at: storage.length)
            }
            return NSRange(location: at, length: 0)
        }
    }

    /// Wiersz pod bieżącym (`add`) albo usunięcie bieżącego wiersza.
    func tableRow(add: Bool) {
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard let table = tableContext(list, at: selection.location) else { NSSound.beep(); return nil }
            let row = table.cell.row
            guard let current = table.rows[row], let lastIndex = current.last else { return nil }
            if !add && table.rows.count <= 1 { removeTable(list, table); return NSRange(location: list[table.range.lowerBound].range.location, length: 0) }
            for index in table.range {
                guard let other = list[index].info.path[table.depth].cell, other.row > row else { continue }
                setCell(list[index], depth: table.depth) { $0.row += add ? 1 : -1 }
            }
            let base = Array(list[table.range.lowerBound].info.path.prefix(table.depth))
            if add {
                var columns: [ContractCellLevel] = []
                for index in current {
                    guard let cell = list[index].info.path[table.depth].cell, !columns.contains(where: { $0.column == cell.column }) else { continue }
                    var fresh = cell
                    fresh.row = row + 1
                    fresh.header = false
                    fresh.attributes = cell.attributes.filter { $0.key == ContractHTMLParser.style || $0.key == "style" }
                    columns.append(fresh)
                }
                let piece = NSMutableAttributedString()
                columns.forEach { piece.append(emptyCellParagraph(base, $0)) }
                let at = NSMaxRange(list[lastIndex].range)
                storage.insert(piece, at: at)
                return NSRange(location: at, length: 0)
            }
            let start = list[current[0]].range.location
            storage.deleteCharacters(in: NSRange(location: start, length: NSMaxRange(list[lastIndex].range) - start))
            return NSRange(location: min(start, storage.length), length: 0)
        }
    }

    /// Kolumna z prawej bieżącej (`add`) albo usunięcie bieżącej kolumny.
    func tableColumn(add: Bool) {
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard let table = tableContext(list, at: selection.location) else { NSSound.beep(); return nil }
            let column = table.cell.column
            let columns = Set(table.range.compactMap { list[$0].info.path[table.depth].cell?.column })
            if !add && columns.count <= 1 { removeTable(list, table); return NSRange(location: list[table.range.lowerBound].range.location, length: 0) }
            for index in table.range {
                guard let other = list[index].info.path[table.depth].cell, other.column > column else { continue }
                setCell(list[index], depth: table.depth) { $0.column += add ? 1 : -1 }
            }
            let base = Array(list[table.range.lowerBound].info.path.prefix(table.depth))
            // Od ostatniego wiersza — wstawianie i usuwanie nie przesuwa jeszcze nieobsłużonych wierszy.
            for row in table.rows.keys.sorted(by: >) {
                guard let indices = table.rows[row] else { continue }
                let inColumn = indices.filter { list[$0].info.path[table.depth].cell?.column == column }
                if add {
                    let anchor = inColumn.last ?? indices.last
                    guard let anchor, let cell = list[anchor].info.path[table.depth].cell else { continue }
                    var fresh = cell
                    fresh.column = column + 1
                    fresh.header = false
                    fresh.attributes = cell.attributes.filter { $0.key == ContractHTMLParser.style }
                    storage.insert(emptyCellParagraph(base, fresh), at: NSMaxRange(list[anchor].range))
                } else if let first = inColumn.first, let last = inColumn.last {
                    let start = list[first].range.location
                    storage.deleteCharacters(in: NSRange(location: start, length: NSMaxRange(list[last].range) - start))
                }
            }
            return selection.location <= storage.length ? NSRange(location: selection.location, length: 0) : nil
        }
    }

    func deleteTable() {
        guard let textView else { return }
        let selection = textView.selectedRange()
        perform {
            let list = paragraphs()
            guard let table = tableContext(list, at: selection.location) else { NSSound.beep(); return nil }
            removeTable(list, table)
            return NSRange(location: min(list[table.range.lowerBound].range.location, storage.length), length: 0)
        }
    }

    private func removeTable(_ list: [Paragraph], _ table: TableContext) {
        let start = list[table.range.lowerBound].range.location
        storage.deleteCharacters(in: NSRange(location: start, length: NSMaxRange(list[table.range.upperBound].range) - start))
        if storage.length == 0 {
            storage.insert(NSAttributedString(string: "\n", attributes: [.contractMarks: ContractMarksBox.plain,
                                                                       .contractBlock: ContractParagraphInfo(tag: "p", attributes: [ContractHTMLParser.style: "body"], path: [])]), at: 0)
        }
    }

    /// Kursor w tabeli (przyciski wierszy i kolumn na wstążce).
    var inTable: Bool { inCell }
}

/// „Pokaż jako” — klient, kategoria wydarzenia i stan opcji umowy.
struct ContractSimulation: Equatable {
    var client = "osoba"
    var category = ""
    var options: [String: Bool] = [:]
}
