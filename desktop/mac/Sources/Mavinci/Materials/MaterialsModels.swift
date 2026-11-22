import Foundation
import UniformTypeIdentifiers

// MARK: Materiały — dane z `/bridge/native/v1/materials` (`src/lib/materials/materials.server.ts`, typy jak
// `src/components/crm/materials/materialsApi.ts`). Uprawnienia i zakres marek liczy baza (RLS) — aplikacja tylko pokazuje.

struct MaterialAccess: Codable, Equatable {
    var view: Bool
    var manage: Bool
    var admin: Bool
    var employeeId: String?
}

struct MaterialCompany: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var isDefault: Bool
    var access: MaterialAccess
}

struct MaterialFolder: Codable, Identifiable, Hashable {
    var id: String
    var companyId: String
    var parentId: String?
    var name: String
    /// Folder domyślny marki (`brand`, `photos`, `video`, `presentations`, `documents`, `social`) — bez przenoszenia i usuwania.
    var systemKey: String?
    var sortOrder: Int
    var createdAt: String?
    var updatedAt: String?
    var metaVersion: Int
}

struct MaterialFile: Codable, Identifiable, Hashable {
    var id: String
    var companyId: String
    var folderId: String?
    var name: String
    var status: String
    var mime: String
    var kind: String
    var size: Double
    var sha256: String?
    var contentVersion: Int
    var metaVersion: Int
    var width: Int?
    var height: Int?
    var duration: Double?
    var description: String
    var tags: [String]
    var eventId: String?
    var sourceEventFileId: String?
    var thumbnailUrl: String?
    var createdAt: String?
    var createdById: String?
    var createdBy: String?
    var updatedAt: String?
    var updatedById: String?
    var updatedBy: String?
}

struct MaterialsHome: Codable {
    var companies: [MaterialCompany]
    var company: MaterialCompany
    var access: MaterialAccess
    var folders: [MaterialFolder]
    var trashCount: Int
    var eventsAccess: Bool
    var maxBytes: Double
}

struct MaterialsListing: Codable {
    var companyId: String
    var access: MaterialAccess
    var folder: MaterialFolder?
    var path: [MaterialFolder]
    var folders: [MaterialFolder]
    var files: [MaterialFile]
    var total: Int
    var offset: Int
    var limit: Int
}

struct MaterialPathEntry: Codable, Hashable {
    var id: String
    var name: String
}

/// Wynik wyszukiwania w Materiałach: plik, marka i ścieżka folderów.
struct MaterialSearchHit: Decodable, Identifiable {
    let file: MaterialFile
    let companyName: String
    let path: [MaterialPathEntry]
    var id: String { file.id }

    private enum Keys: String, CodingKey { case companyName, path }
    init(from decoder: Decoder) throws {
        file = try MaterialFile(from: decoder)
        let c = try decoder.container(keyedBy: Keys.self)
        companyName = (try? c.decode(String.self, forKey: .companyName)) ?? "Marka"
        path = (try? c.decode([MaterialPathEntry].self, forKey: .path)) ?? []
    }
}

/// Plik wydarzenia w wyszukiwaniu (wg dostępu do wydarzeń) — „Zapisz w Materiałach”.
struct MaterialEventHit: Codable, Identifiable {
    var id: String
    var eventId: String
    var eventName: String
    var eventDate: String?
    var folderId: String?
    var folderName: String?
    var name: String
    var mime: String
    var kind: String
    var size: Double
    var createdAt: String?
    var thumbnailUrl: String?
}

struct MaterialsSearchReply: Decodable {
    var q: String
    var scope: String
    var materials: [MaterialSearchHit]
    var events: [MaterialEventHit]
}

struct MaterialVersion: Codable, Identifiable {
    var id: String
    var contentVersion: Int
    var size: Double
    var mime: String
    var width: Int?
    var height: Int?
    var replacedAt: String?
    var replacedBy: String?
}

struct MaterialFileDetail: Decodable {
    struct Event: Decodable { var id: String; var name: String; var date: String? }
    var file: MaterialFile
    var access: MaterialAccess
    var path: [MaterialFolder]
    var event: Event?
    var versions: [MaterialVersion]
}

struct MaterialTrashItem: Codable, Identifiable {
    var id: String
    var kind: String
    var itemId: String
    var parentId: String?
    /// Element usunięty razem z folderem — wraca z nim (w koszu pokazujemy tylko folder).
    var insideFolder: Bool
    var location: String?
    var contains: Int
    var name: String
    var size: Double
    var mime: String
    var fileKind: String
    var thumbnailUrl: String?
    var batch: String
    var deletedAt: String
    var deletedBy: String?
    var mine: Bool
    var purgeAfter: String
}

struct MaterialTrashReply: Decodable { var items: [MaterialTrashItem] }
struct MaterialFileReply: Decodable { var file: MaterialFile }
struct MaterialFolderCreated: Decodable { var item: MaterialFolder }
struct MaterialCopyReply: Decodable { var file: MaterialFile; var existing: Bool }
struct MaterialUrlReply: Decodable { var url: String; var name: String; var mime: String; var size: Double; var kind: String }

struct MaterialBatchResult: Decodable {
    struct Failed: Decodable { var id: String; var name: String; var error: String }
    var moved: Int?
    var removed: Int?
    var failed: [Failed]
}

/// Wynik kopiowania (`op=copy`): ile elementów skopiowano, błędy i nowe elementy z folderu docelowego.
struct MaterialCopyResult: Decodable {
    var copied: Int
    var failed: [MaterialBatchResult.Failed]
    var items: [MaterialRef]
}

/// Schowek Materiałów: elementy, marka, czy wklejenie przenosi (wytnij) i stan schowka systemu w chwili kopiowania.
struct MaterialsClipboard: Equatable {
    var companyID: String
    var refs: [MaterialRef]
    var cut: Bool
    var changeCount: Int
}

struct MaterialPrepared: Decodable {
    var fileId: String
    var name: String
    var replace: Bool
    var contentVersion: Int
    var path: String
    var uploadUrl: String
    var thumbPath: String?
    var thumbUploadUrl: String?
}

/// Odnośnik do elementu (przenoszenie, kosz, przeciąganie w aplikacji).
struct MaterialRef: Codable, Hashable {
    var kind: String
    var id: String
    var name: String

    var json: JSONValue { .object(["kind": .string(kind), "id": .string(id), "name": .string(name)]) }
}

enum MaterialsSort: String, CaseIterable, Identifiable {
    case name, date, size, type
    var id: String { rawValue }
    var label: String {
        switch self {
        case .name: return "Nazwa"
        case .date: return "Data zmiany"
        case .size: return "Rozmiar"
        case .type: return "Rodzaj"
        }
    }
}

enum MaterialsScope: String, CaseIterable, Identifiable {
    case materials, events
    var id: String { rawValue }
    var label: String { self == .materials ? "Materiały" : "Pliki eventów" }
}

// MARK: Wspólne z CRM (`materialsShared.ts`)

enum MaterialsText {
    /// Najwięcej plików w jednej wysyłce (`MATERIALS_MAX_BATCH`).
    static let maxBatch = 100
    static let trashDays = 30

    static let kindLabels: [String: String] = [
        "image": "Zdjęcie", "video": "Wideo", "audio": "Dźwięk", "pdf": "PDF", "document": "Dokument", "spreadsheet": "Arkusz",
        "presentation": "Prezentacja", "design": "Projekt graficzny", "archive": "Archiwum", "font": "Font", "other": "Plik",
    ]

    static func kindLabel(_ kind: String) -> String { kindLabels[kind] ?? "Plik" }

    static func symbol(_ kind: String) -> String {
        switch kind {
        case "image": return "photo"
        case "video": return "film"
        case "audio": return "waveform"
        case "pdf": return "doc.richtext"
        case "document": return "doc.text"
        case "spreadsheet": return "tablecells"
        case "presentation": return "rectangle.on.rectangle"
        case "design": return "paintpalette"
        case "archive": return "doc.zipper"
        case "font": return "textformat"
        default: return "doc"
        }
    }

    /// Ikona folderu domyślnego marki.
    static func folderSymbol(_ folder: MaterialFolder) -> String {
        switch folder.systemKey {
        case "brand": return "seal"
        case "photos": return "photo.on.rectangle"
        case "video": return "film.stack"
        case "presentations": return "rectangle.stack"
        case "documents": return "doc.on.doc"
        case "social": return "square.and.arrow.up.on.square"
        default: return "folder"
        }
    }

    /// Rozmiar po polsku: „824 KB”, „1,4 MB”, „2 GB” (jak `formatMaterialBytes`).
    static func bytes(_ value: Double) -> String {
        var size = max(0, value)
        if size < 1024 { return "\(Int(size)) B" }
        let units = ["KB", "MB", "GB", "TB"]
        size /= 1024
        var unit = 0
        while size >= 1024 && unit < units.count - 1 { size /= 1024; unit += 1 }
        let digits = size >= 100 || unit == 0 ? 0 : 1
        var text = String(format: "%.\(digits)f", size).replacingOccurrences(of: ".", with: ",")
        if text.hasSuffix(",0") { text.removeLast(2) }
        return "\(text) \(units[unit])"
    }

    /// Czas trwania „1:05” / „1:02:03”.
    static func duration(_ seconds: Double?) -> String {
        let total = max(0, Int((seconds ?? 0).rounded()))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// „1 plik”, „2 pliki”, „5 plików”.
    static func files(_ count: Int) -> String {
        let tens = count % 100, ones = count % 10
        if count == 1 { return "1 plik" }
        if (2...4).contains(ones) && !(12...14).contains(tens) { return "\(count) pliki" }
        return "\(count) plików"
    }

    private static let parser: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func date(_ value: String?) -> Date? {
        guard var text = value, !text.isEmpty else { return nil }
        if let dot = text.firstIndex(of: ".") {
            let rest = text[text.index(after: dot)...]
            let zone = rest.firstIndex(where: { $0 == "+" || $0 == "-" || $0 == "Z" }) ?? rest.endIndex
            text = String(text[..<dot]) + String(rest[zone...])
        }
        if text.count > 10, text[text.index(text.startIndex, offsetBy: 10)] == " " {
            text.replaceSubrange(text.index(text.startIndex, offsetBy: 10)...text.index(text.startIndex, offsetBy: 10), with: "T")
        }
        if text.hasSuffix("+00") { text += ":00" }
        if text.count == 10 { text += "T00:00:00Z" }
        return parser.date(from: text)
    }

    static func dateLabel(_ value: String?, time: Bool = true) -> String {
        guard let date = date(value) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "pl_PL")
        f.timeZone = TimeZone(identifier: "Europe/Warsaw")
        f.dateFormat = time ? "dd.MM.yyyy, HH:mm" : "dd.MM.yyyy"
        return f.string(from: date)
    }

    /// Typ pliku (ikona systemowa) z nazwy.
    static func type(of name: String) -> UTType {
        UTType(filenameExtension: (name as NSString).pathExtension.lowercased()) ?? .data
    }
}

// MARK: Albumy (Materiały → Albumy) — odnośniki do plików marki, bez kopiowania

struct MaterialAlbum: Codable, Identifiable, Hashable {
    var id: String
    var companyId: String
    var name: String
    var description: String
    var coverFileId: String?
    var sortOrder: Int
    var count: Int
    var coverUrl: String?
    var createdAt: String?
    var updatedAt: String?
}

struct MaterialAlbumsReply: Codable { var albums: [MaterialAlbum] }
struct MaterialAlbumReply: Codable { var album: MaterialAlbum; var files: [MaterialFile] }
struct MaterialAlbumAddReply: Codable { var added: Int; var skipped: Int }
