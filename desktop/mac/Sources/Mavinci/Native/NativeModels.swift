import Foundation

// MARK: Natywny protokół Mavinci — karty, listy i formularze czynności składane przez serwer CRM
// (`src/lib/native/protocol.ts`, wzór: Wodami / piastpol `native-docs.ts`). Aplikacja tylko rysuje — reguły należą do serwera.

/// Łagodne odczytywanie pól: brak klucza albo inny typ daje wartość domyślną zamiast błędu całej karty.
extension KeyedDecodingContainer {
    func text(_ key: Key, _ fallback: String = "") -> String {
        if let v = try? decodeIfPresent(String.self, forKey: key) { return v }
        if let v = try? decodeIfPresent(Double.self, forKey: key) { return v == v.rounded() && abs(v) < 1e15 ? String(Int64(v)) : String(v) }
        if let v = try? decodeIfPresent(Bool.self, forKey: key) { return v ? "true" : "false" }
        return fallback
    }
    func optText(_ key: Key) -> String? { let v = text(key); return v.isEmpty ? nil : v }
    func flag(_ key: Key) -> Bool { (try? decodeIfPresent(Bool.self, forKey: key)) ?? false }
    func optNumber(_ key: Key) -> Double? { try? decodeIfPresent(Double.self, forKey: key) }
    func lossy<T: Decodable>(_ key: Key) -> [T] { (try? decodeIfPresent(LossyList<T>.self, forKey: key))?.items ?? [] }
    func opt<T: Decodable>(_ type: T.Type, _ key: Key) -> T? { try? decodeIfPresent(type, forKey: key) }
}

/// Lista dekodowana element po elemencie — jeden nieczytelny element nie psuje całego zbioru.
struct LossyList<T: Decodable>: Decodable {
    let items: [T]
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [T] = []
        while !c.isAtEnd {
            if let v = try? c.decode(T.self) { out.append(v) }
            else if (try? c.decode(JSONValue.self)) == nil { break }
        }
        items = out
    }
}

private struct AnyKey: CodingKey {
    var stringValue: String; var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

struct DocFile: Decodable, Equatable, Hashable {
    var kind: String; var id: String; var format: String; var version: Int?; var name: String?
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        kind = c.text(AnyKey("kind")); id = c.text(AnyKey("id")); format = c.text(AnyKey("format"), "pdf")
        version = c.optNumber(AnyKey("version")).map { Int($0) }; name = c.optText(AnyKey("name"))
    }
}

struct DocLink: Decodable, Equatable, Hashable {
    var type: String; var id: String?; var href: String?; var kind: String?; var tab: String?; var file: DocFile?; var action: String?; var filter: String?
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        type = c.text(AnyKey("type")); id = c.optText(AnyKey("id")); href = c.optText(AnyKey("href")); kind = c.optText(AnyKey("kind"))
        tab = c.optText(AnyKey("tab")); file = c.opt(DocFile.self, AnyKey("file")); action = c.optText(AnyKey("action")); filter = c.optText(AnyKey("filter"))
    }
}

struct DocRow: Decodable, Equatable, Hashable {
    var label: String; var value: String; var link: DocLink?
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        label = c.text(AnyKey("label")); value = c.text(AnyKey("value")); link = c.opt(DocLink.self, AnyKey("link"))
    }
}

struct DocTable: Decodable, Equatable, Hashable {
    var columns: [String]; var rows: [[String]]; var links: [DocLink?]
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        columns = (try? c.decode([String].self, forKey: AnyKey("columns"))) ?? []
        rows = ((try? c.decode([[JSONValue]].self, forKey: AnyKey("rows"))) ?? []).map { $0.map(\.plain) }
        links = (try? c.decode([DocLink?].self, forKey: AnyKey("links"))) ?? []
    }
}

struct DocSection: Decodable, Equatable, Hashable, Identifiable {
    var key: String; var span: Int; var title: String; var rows: [DocRow]; var table: DocTable?; var text: String; var tone: String
    var id: String { key.isEmpty ? title : key }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        key = c.text(AnyKey("id")); span = Int(c.optNumber(AnyKey("span")) ?? 1); title = c.text(AnyKey("title"))
        rows = c.lossy(AnyKey("rows")); table = c.opt(DocTable.self, AnyKey("table")); text = c.text(AnyKey("text")); tone = c.text(AnyKey("tone"))
    }
}

struct DocOption: Decodable, Equatable, Hashable, Identifiable {
    var id: String; var name: String; var parent: String?; var group: String?; var help: String?
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = c.text(AnyKey("id")); name = c.text(AnyKey("name")); parent = c.optText(AnyKey("parent")); group = c.optText(AnyKey("group")); help = c.optText(AnyKey("help"))
    }
}

struct DocVisibleIf: Decodable, Equatable, Hashable { var field: String; var `in`: [String]?; var notIn: [String]? }

struct DocField: Decodable, Equatable, Identifiable {
    var name: String; var label: String; var type: String; var value: JSONValue; var options: [DocOption]; var required: Bool
    var min: Double?; var max: Double?; var help: String; var dependsOn: String?; var visibleIf: DocVisibleIf?
    var fields: [DocField]; var add: String?; var template: JSONValue; var addLabel: String?; var group: String?
    var id: String { name }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        name = c.text(AnyKey("name")); label = c.text(AnyKey("label")); type = c.text(AnyKey("type"), "text")
        value = (try? c.decodeIfPresent(JSONValue.self, forKey: AnyKey("value"))) ?? .null
        options = c.lossy(AnyKey("options")); required = c.flag(AnyKey("required"))
        min = c.optNumber(AnyKey("min")); max = c.optNumber(AnyKey("max")); help = c.text(AnyKey("help"))
        dependsOn = c.optText(AnyKey("dependsOn")); visibleIf = c.opt(DocVisibleIf.self, AnyKey("visibleIf"))
        fields = c.lossy(AnyKey("fields")); add = c.optText(AnyKey("add"))
        template = (try? c.decodeIfPresent(JSONValue.self, forKey: AnyKey("template"))) ?? .null
        addLabel = c.optText(AnyKey("addLabel")); group = c.optText(AnyKey("group"))
    }
}

struct DocAction: Decodable, Equatable, Identifiable {
    var key: String; var label: String; var role: String?; var icon: String?; var submitLabel: String?; var section: String?
    var confirm: String?; var note: String?; var fields: [DocField]?; var open: String?; var copy: String?; var url: String?
    var file: DocFile?; var data: [String: JSONValue]
    /// Kilka czynności może mieć to samo `id` (np. edycja po sekcjach) — w widoku rozróżnia je etykieta i sekcja.
    var id: String { "\(key)|\(section ?? "")|\(label)" }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        key = c.text(AnyKey("id")); label = c.text(AnyKey("label")); role = c.optText(AnyKey("role")); icon = c.optText(AnyKey("icon"))
        submitLabel = c.optText(AnyKey("submitLabel")); section = c.optText(AnyKey("section")); confirm = c.optText(AnyKey("confirm"))
        note = c.optText(AnyKey("note")); open = c.optText(AnyKey("open")); copy = c.optText(AnyKey("copy")); url = c.optText(AnyKey("url"))
        file = c.opt(DocFile.self, AnyKey("file"))
        fields = (try? c.decodeIfPresent(LossyList<DocField>.self, forKey: AnyKey("fields")))?.items
        data = (try? c.decodeIfPresent([String: JSONValue].self, forKey: AnyKey("data"))) ?? [:]
    }
    var isPrimary: Bool { role == "primary" }
    var isDestructive: Bool { role == "destructive" }
    var symbol: String {
        switch icon {
        case "edit": return "pencil"
        case "settings": return "gearshape"
        case "add": return "plus"
        case "delete": return "trash"
        case "archive": return "archivebox"
        case "send": return "paperplane"
        case "print": return "printer"
        case "download": return "arrow.down.circle"
        case "upload": return "arrow.up.circle"
        case "confirm": return "checkmark.circle"
        case "cancel": return "xmark.circle"
        case "refresh": return "arrow.clockwise"
        case "link": return "link"
        case "user": return "person"
        case "image": return "photo"
        default: return "arrow.up.forward.app"
        }
    }
}

struct DocFilterTag: Decodable, Equatable, Hashable { var id: String; var label: String; var tone: String? }
struct DocAlert: Decodable, Equatable, Hashable { var text: String; var tone: String; var filter: String?; var query: String? }

struct DocRecord: Decodable, Equatable, Identifiable {
    var id: String; var kind: String; var number: String; var title: String; var subtitle: String
    var status: String; var statusLabel: String; var tone: String; var open: Bool
    var date: String; var dateText: String; var createdAt: String; var amountGrosz: Double?; var amountText: String
    var channelLabel: String; var search: String; var revision: Int; var updatedAt: String; var panelHref: String
    var sections: [DocSection]; var actions: [DocAction]; var filters: [DocFilterTag]
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = c.text(AnyKey("id")); kind = c.text(AnyKey("kind")); number = c.text(AnyKey("number")); title = c.text(AnyKey("title"))
        subtitle = c.text(AnyKey("subtitle")); status = c.text(AnyKey("status")); statusLabel = c.text(AnyKey("statusLabel"))
        tone = c.text(AnyKey("tone"), "new"); open = c.flag(AnyKey("open")); date = c.text(AnyKey("date")); dateText = c.text(AnyKey("dateText"))
        createdAt = c.text(AnyKey("createdAt")); amountGrosz = c.optNumber(AnyKey("amountGrosz")); amountText = c.text(AnyKey("amountText"))
        channelLabel = c.text(AnyKey("channelLabel")); search = c.text(AnyKey("search")); revision = Int(c.optNumber(AnyKey("revision")) ?? 0)
        updatedAt = c.text(AnyKey("updatedAt")); panelHref = c.text(AnyKey("panelHref"))
        sections = c.lossy(AnyKey("sections")); actions = c.lossy(AnyKey("actions")); filters = c.lossy(AnyKey("filters"))
    }
}

struct DocBoardColumn: Decodable, Equatable, Hashable { var id: String; var label: String; var tone: String?; var closed: Bool?; var hint: String? }
struct DocBoard: Decodable, Equatable { var columns: [DocBoardColumn]; var moveAction: String; var amountLabel: String?; var defaultView: String? }

/// Opis podstrony: 6 nagłówków listy (numer, tytuł, opis, data, status, kwota), filtr „otwarte”, podpowiedź, czynności tworzenia.
struct DocSectionMeta: Decodable, Equatable, Identifiable {
    var id: String; var title: String; var href: String; var headers: [String]; var openLabel: String; var hint: String
    var icon: String; var create: [DocAction]; var single: Bool; var group: String?; var alerts: [DocAlert]; var board: DocBoard?
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = c.text(AnyKey("id")); title = c.text(AnyKey("title")); href = c.text(AnyKey("href"))
        let h = (try? c.decode([String].self, forKey: AnyKey("headers"))) ?? []
        headers = h.count == 6 ? h : ["Numer", "Nazwa", "Opis", "Data", "Status", "Kwota"]
        openLabel = c.text(AnyKey("openLabel")); hint = c.text(AnyKey("hint")); icon = c.text(AnyKey("icon"), "doc.text")
        create = c.lossy(AnyKey("create")); single = c.flag(AnyKey("single")); group = c.optText(AnyKey("group"))
        alerts = c.lossy(AnyKey("alerts")); board = c.opt(DocBoard.self, AnyKey("board"))
    }
}

extension JSONValue {
    /// Wartość jako tekst (pola formularza, komórki tabel, warunki `visibleIf`): liczby bez zbędnych zer, przełącznik „true” / „false”.
    var plain: String {
        switch self {
        case .string(let v): return v
        case .number(let v): return v == v.rounded() && abs(v) < 1e15 ? String(Int64(v)) : String(v)
        case .bool(let v): return v ? "true" : "false"
        default: return ""
        }
    }
}

/// Wyszukiwanie po polsku jak na serwerze (`searchText`): bez wielkości liter, bez ogonków, „ł” jak „l”.
enum SearchText {
    static func fold(_ value: String) -> String {
        value.replacingOccurrences(of: "ł", with: "l").replacingOccurrences(of: "Ł", with: "l")
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL")).lowercased()
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
