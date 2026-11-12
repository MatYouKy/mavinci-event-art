import FileProvider
import Foundation
import UniformTypeIdentifiers

// MARK: Dane z `/bridge/native/v1/files` (`src/lib/native/finderFiles.ts`)

struct FinderEventDTO: Codable {
    let id: String
    let name: String
    let date: String?
    let endDate: String?
    let status: String?
    let updatedAt: String?
}

struct FinderFolderDTO: Codable {
    let id: String
    let eventId: String
    let parentId: String?
    let name: String
    let formal: Bool?
    let system: Bool?
    let createdAt: String?
    let updatedAt: String?
    let metaVersion: Int?
}

struct FinderFileDTO: Codable {
    let id: String
    let eventId: String
    let parentId: String?
    let name: String
    let size: Double?
    let mime: String?
    let createdAt: String?
    let updatedAt: String?
    let contentVersion: Int?
    let metaVersion: Int?
    let sha256: String?
}

struct FinderEventsReply: Decodable {
    let cursor: String
    let events: [FinderEventDTO]
}

struct FinderListReply: Decodable {
    let cursor: String
    let event: FinderEventDTO
    let folders: [FinderFolderDTO]
    let files: [FinderFileDTO]
}

struct FinderChangesReply: Decodable {
    struct Deleted: Decodable {
        let kind: String
        let id: String
        let eventId: String
    }
    let cursor: String
    let reset: Bool?
    let events: [FinderEventDTO]?
    let folders: [FinderFolderDTO]?
    let files: [FinderFileDTO]?
    let deleted: [Deleted]?
}

struct FinderFolderReply: Decodable { let item: FinderFolderDTO }
struct FinderFileReply: Decodable { let item: FinderFileDTO }
struct FinderDownloadReply: Decodable {
    let url: String
    let item: FinderFileDTO
}

/// Wpis kosza CRM (30 dni) — w Koszu Findera pokazujemy elementy usunięte przez zalogowanego pracownika.
struct FinderTrashDTO: Codable {
    let id: String
    let kind: String
    let itemId: String
    let eventId: String
    let parentId: String?
    let name: String
    let size: Double?
    let mime: String?
    let batch: String
    let deletedAt: String?
    let mine: Bool?
}
struct FinderTrashReply: Decodable { let items: [FinderTrashDTO] }

struct FinderUploadSlots: Decodable {
    struct Slot: Decodable {
        let name: String
        let path: String
        let url: String
    }
    let slots: [Slot]
}

/// Odmowa serwera dla zapisu (`{error, code, item?}`): 409 `conflict` / `exists`, 403 `forbidden`, 400 `crossEvent`…
struct FinderServerError: Error {
    let status: Int
    let code: String?
    let message: String
    let item: FinderFileDTO?
}

// MARK: Identyfikatory elementów: Mavinci → Eventy → rok → wydarzenie → foldery i pliki

enum FinderID {
    static let events = NSFileProviderItemIdentifier(rawValue: "events")
    static func year(_ year: String) -> NSFileProviderItemIdentifier { NSFileProviderItemIdentifier(rawValue: "year:" + year) }
    static func event(_ id: String) -> NSFileProviderItemIdentifier { NSFileProviderItemIdentifier(rawValue: "event:" + id) }
    static func folder(_ id: String) -> NSFileProviderItemIdentifier { NSFileProviderItemIdentifier(rawValue: "folder:" + id) }
    static func file(_ id: String) -> NSFileProviderItemIdentifier { NSFileProviderItemIdentifier(rawValue: "file:" + id) }

    enum Kind {
        case root, workingSet, trash, events
        case year(String), event(String), folder(String), file(String)
        case unknown
    }

    static func parse(_ identifier: NSFileProviderItemIdentifier) -> Kind {
        if identifier == .rootContainer { return .root }
        if identifier == .workingSet { return .workingSet }
        if identifier == .trashContainer { return .trash }
        let raw = identifier.rawValue
        if raw == "events" { return .events }
        guard let colon = raw.firstIndex(of: ":") else { return .unknown }
        let value = String(raw[raw.index(after: colon)...])
        guard !value.isEmpty else { return .unknown }
        switch String(raw[..<colon]) {
        case "year": return .year(value)
        case "event": return .event(value)
        case "folder": return .folder(value)
        case "file": return .file(value)
        default: return .unknown
        }
    }
}

// MARK: Nazwy w Finderze

enum FinderName {
    /// Nazwa z Findera → nazwa w CRM (odwrotność `safe`; „:” w nazwie pliku to „/” wpisany w Finderze).
    static func crm(_ filename: String) -> String {
        filename
            .replacingOccurrences(of: ":", with: "/")
            .replacingOccurrences(of: "\u{2215}", with: "/")
            .replacingOccurrences(of: "\u{2236}", with: ":")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Pliki systemowe i tymczasowe, których nie wysyłamy do CRM (zostają tylko na tym Macu).
    static func excluded(_ filename: String) -> Bool {
        let lower = filename.lowercased()
        return filename.hasPrefix(".") || filename.hasPrefix("~$") || filename == "Icon\r" || lower.hasSuffix(".tmp")
            || lower.hasSuffix(".crdownload") || lower.hasSuffix(".part") || lower.hasSuffix(".download")
    }

    /// Kopia przy konflikcie: „Umowa (konflikt 2026-11-12 19.05).pdf”.
    static func conflictCopy(_ name: String) -> String {
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "pl_PL")
        stamp.dateFormat = "yyyy-MM-dd HH.mm"
        let suffix = " (konflikt \(stamp.string(from: Date())))"
        let ext = (name as NSString).pathExtension
        let base = (name as NSString).deletingPathExtension
        return ext.isEmpty || base.isEmpty ? name + suffix : base + suffix + "." + ext
    }

    /// Nazwa z CRM → nazwa pliku na dysku: „/” i „:” zamieniamy na podobne znaki (∕ i ∶), bo system plików ich nie dopuszcza.
    static func safe(_ name: String) -> String {
        var value = name
            .replacingOccurrences(of: "/", with: "\u{2215}")
            .replacingOccurrences(of: ":", with: "\u{2236}")
            .replacingOccurrences(of: "\u{0}", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty || value == "." || value == ".." { value = "bez nazwy" }
        return String(value.prefix(240))
    }

    /// Unikalne nazwy w jednym folderze (APFS nie rozróżnia wielkości liter): „Plik.pdf”, „Plik (2).pdf”…
    static func unique(_ entries: [(id: String, name: String)]) -> [String: String] {
        var used = Set<String>()
        var result: [String: String] = [:]
        let ordered = entries.sorted { lhs, rhs in
            let l = lhs.name.lowercased(), r = rhs.name.lowercased()
            return l == r ? lhs.id < rhs.id : l < r
        }
        for entry in ordered {
            var candidate = entry.name
            var number = 2
            while used.contains(candidate.lowercased()) {
                candidate = numbered(entry.name, number)
                number += 1
            }
            used.insert(candidate.lowercased())
            result[entry.id] = candidate
        }
        return result
    }

    static func numbered(_ name: String, _ number: Int) -> String {
        let ext = (name as NSString).pathExtension
        let base = (name as NSString).deletingPathExtension
        return ext.isEmpty || base.isEmpty ? "\(name) (\(number))" : "\(base) (\(number)).\(ext)"
    }
}

enum FinderDate {
    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    /// Daty z Postgresa (`2026-11-12T17:20:24.673944+00:00`) — ułamki sekund pomijamy.
    static func parse(_ value: String?) -> Date? {
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
        return formatter.date(from: text)
    }
}

// MARK: Element w Finderze

final class FinderItem: NSObject, NSFileProviderItem {
    let itemIdentifier: NSFileProviderItemIdentifier
    let parentItemIdentifier: NSFileProviderItemIdentifier
    let filename: String
    let contentType: UTType
    let capabilities: NSFileProviderItemCapabilities
    let itemVersion: NSFileProviderItemVersion
    let documentSize: NSNumber?
    let creationDate: Date?
    let contentModificationDate: Date?

    /// Co wolno zrobić z elementem w Finderze (uprawnienia i tak sprawdza serwer — odmowa cofa zmianę).
    enum Role {
        /// Mavinci, Eventy, rok — tylko przeglądanie.
        case structure
        /// Folder wydarzenia — można dodawać pliki i foldery, nie można go zmieniać.
        case event
        /// Folder z zakładki Pliki.
        case folder
        /// Plik z zakładki Pliki.
        case file
        /// Element w Koszu Findera (kosz CRM): przywrócenie albo usunięcie na zawsze.
        case trashed
    }

    init(identifier: NSFileProviderItemIdentifier, parent: NSFileProviderItemIdentifier, filename: String, folder: Bool,
         role: Role? = nil, size: Int64? = nil, created: Date? = nil, modified: Date? = nil, contentVersion: String = "1") {
        itemIdentifier = identifier
        parentItemIdentifier = parent
        self.filename = filename
        let ext = (filename as NSString).pathExtension
        contentType = folder ? .folder : (ext.isEmpty ? .data : (UTType(filenameExtension: ext) ?? .data))
        switch role ?? (folder ? .folder : .file) {
        case .structure:
            capabilities = [.allowsReading, .allowsContentEnumerating]
        case .event:
            capabilities = [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems]
        case .folder:
            capabilities = [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems, .allowsRenaming, .allowsReparenting,
                            .allowsTrashing, .allowsDeleting]
        case .file:
            capabilities = [.allowsReading, .allowsWriting, .allowsRenaming, .allowsReparenting, .allowsTrashing, .allowsDeleting]
        case .trashed:
            capabilities = folder ? [.allowsReading, .allowsContentEnumerating, .allowsReparenting, .allowsDeleting]
                                  : [.allowsReading, .allowsReparenting, .allowsDeleting]
        }
        // Zmiana nazwy lub folderu musi zmienić wersję metadanych, inaczej Finder zostawi starą nazwę.
        itemVersion = NSFileProviderItemVersion(contentVersion: Data(contentVersion.utf8),
                                                metadataVersion: Data("\(parent.rawValue)|\(filename)".utf8))
        documentSize = size.map { NSNumber(value: $0) }
        creationDate = created
        contentModificationDate = modified
        super.init()
    }

    static let root = FinderItem(identifier: .rootContainer, parent: .rootContainer, filename: FinderShared.domainName, folder: true, role: .structure)
    static let eventsRoot = FinderItem(identifier: FinderID.events, parent: .rootContainer, filename: "Eventy", folder: true, role: .structure)
}
