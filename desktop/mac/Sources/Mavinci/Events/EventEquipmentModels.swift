import Foundation
import SwiftUI

// MARK: Zakładka „Sprzęt” — dane z serwera (`src/lib/native/eventEquipment.ts`) i reguły z CRM
// (`useEventEquipment`, `getUiLimits`, `getStatusBadge`, `equipmentChecklist.ts`, `equipmentChecklistUi.ts`).

struct EquipmentAvailability: Decodable, Hashable {
    var total: Double
    var reserved: Double
    var used: Double
    var availableInTerm: Double
    var maxAdd: Double
    var maxSet: Double
    enum CodingKeys: String, CodingKey {
        case total = "total_quantity", reserved = "reserved_quantity", used = "used_by_this_event"
        case availableInTerm = "available_in_term", maxAdd = "max_add", maxSet = "max_set"
    }
}

/// `getUiLimits`: ile jeszcze można dodać, maksymalna ilość, rezerwacje (inne wydarzenia + to wydarzenie) i stan magazynu.
struct EquipmentLimits {
    var used = 0, availableInTerm = 0, maxAdd = 0, maxSet = 0, total = 0, reserved = 0
    init(_ a: EquipmentAvailability?) {
        guard let a else { return }
        used = Int(a.used); availableInTerm = Int(a.availableInTerm); maxAdd = Int(a.maxAdd); maxSet = Int(a.maxSet)
        total = Int(a.total); reserved = Int(a.reserved) + used
    }
}

struct EquipmentTabData: Decodable {
    struct Event: Decodable {
        var name: String
        var start: String?
        var end: String?
        var hasShortage: Bool
        var checklistPdfPath: String?
        var checklistModified: Bool
        var loadingConfirmed: Bool
        var loadingConfirmedAt: String?
    }
    struct LoadedBy: Decodable, Hashable { var name: String; var avatarUrl: String? }
    struct KitItem: Decodable, Hashable { var name: String; var brand: String; var model: String; var category: String; var thumbnail: String?; var quantity: Double }
    struct Row: Decodable, Identifiable, Hashable {
        var id: String
        var kind: String
        var key: String?
        var equipmentId: String?
        var kitId: String?
        var cableId: String?
        var name: String
        var brand: String
        var model: String
        var category: String
        var warehouseCategoryId: String?
        var thumbnail: String?
        var cableLength: Double?
        var unit: String
        var quantity: Double
        var status: String
        var autoAdded: Bool
        var fromOffer: Bool
        var offerId: String?
        var optional: Bool
        var rental: Bool
        var removed: Bool
        var loaded: Bool
        var loadedBy: LoadedBy?
        var expandInChecklist: Bool
        var notes: String
        var kitItems: [KitItem]
        var isKit: Bool { kind == "kit" }
        var isCable: Bool { kind == "cable" }
        var qty: Int { Int(quantity) }
        /// Tekst wyszukiwania (nazwa, marka, model, zestaw i jego zawartość) bez polskich znaków.
        var searchText: String {
            EquipmentSearch.normalize(([name, brand, model] + kitItems.flatMap { [$0.name, $0.brand, $0.model] }).joined(separator: " "))
        }
    }
    struct Review: Decodable, Identifiable, Hashable { var id: String; var equipmentId: String; var name: String; var source: String }
    struct Component: Decodable, Identifiable, Hashable {
        var id: String
        var type: String
        var group: String?
        var kind: String
        var targetId: String?
        var key: String?
        var name: String?
        var brand: String
        var model: String
        var description: String
        var lengthMeters: Double?
        var unit: String
        var thumbnail: String?
        var required: Double
        var existing: Double
        var missing: Double
    }
    struct ComponentGroup: Decodable, Hashable, Identifiable {
        var name: String?
        var required: Bool
        var recommended: Bool
        var components: [Component]
        var id: String { name ?? components.first?.id ?? "" }
    }
    struct Components: Decodable, Hashable { var sourceQuantity: Double; var defined: Bool; var groups: [ComponentGroup] }
    struct External: Decodable, Hashable { var name: String?; var quantity: Double; var unit: String; var description: String }
    struct Note: Codable, Hashable, Identifiable { var id: String; var text: String; var checked: Bool }

    var event: Event
    var rows: [Row]
    var availability: [String: EquipmentAvailability]
    var availabilityLoaded: Bool
    var reviews: [Review]
    var components: [String: Components]
    var hasUnresolvedConflicts: Bool
    var latestOfferId: String?
    var calculationId: String?
    var external: [External]
    var notes: [Note]
    var canVerifyInventory: Bool
    var photoBase: String

    func limits(_ row: Row) -> EquipmentLimits { EquipmentLimits(row.key.flatMap { availability[$0] }) }
}

enum EquipmentSearch {
    static func normalize(_ text: String) -> String {
        text.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "pl_PL")).replacingOccurrences(of: "ł", with: "l")
    }
}

/// `getStatusBadge` z zakładki Sprzęt.
enum EquipmentStatusBadge {
    static func badge(_ status: String, conflict: Bool) -> (label: String, color: Color) {
        if conflict { return ("NIEDOSTĘPNY", .red) }
        switch status.lowercased().trimmingCharacters(in: .whitespaces) {
        case "draft": return ("DRAFT (rezerwuje)", Color(red: 0.83, green: 0.73, blue: 0.45))
        case "rental": return ("RENTAL", .purple)
        case "reserved", "reserved_confirmed": return ("ZAREZERWOWANE", .green)
        case "in_use": return ("W UŻYCIU", .cyan)
        case "released": return ("ZWOLNIONE", .secondary)
        case "cancelled": return ("ANULOWANE", .red)
        case "returned": return ("ZWRÓCONE", .secondary)
        case "planned": return ("PLANOWANE", .blue)
        case "reserved_pending": return ("REZERWACJA WSTĘPNA", .yellow)
        default: return ("—", .secondary)
        }
    }
}

// MARK: Katalog do dodania, alternatywy, wynajem, zajętość komponentu

struct EquipmentCatalog: Decodable {
    struct Item: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var brand: String
        var model: String
        var category: String
        var thumbnail: String?
        var total: Double
        var reserved: Double
        var used: Double
        var availableInTerm: Double
        var maxAdd: Double
        var maxSet: Double
    }
    struct KitContent: Codable, Hashable { var id: String; var name: String; var brand: String; var model: String; var lengthMeters: Double?; var quantity: Double }
    struct Kit: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var description: String
        var thumbnail: String?
        var total: Double
        var reserved: Double
        var used: Double
        var availableInTerm: Double
        var maxAdd: Double
        var maxSet: Double
        var contents: [KitContent]
    }
    var items: [Item]
    var kits: [Kit]
    var loaded: Bool
}

struct EquipmentAlternatives: Decodable {
    struct Alternative: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var brand: String
        var model: String
        var thumbnail: String?
        var total: Double
        var available: Double
        var availableInTerm: Double
        var maxAdd: Double
    }
    var alternatives: [Alternative]
    var message: String
}

struct RentalCatalog: Decodable {
    struct Item: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var description: String
        var pricePerDay: Double?
        var quantity: Double
        var thumbnail: String?
        var category: String?
        var subcontractorId: String
        var subcontractorName: String?
        var subcontractorAlias: String?
        var company: String { subcontractorAlias?.nonEmpty ?? subcontractorName?.nonEmpty ?? "Podwykonawca" }
    }
    var items: [Item]
}

struct ComponentConflicts: Decodable {
    struct Conflict: Decodable, Identifiable, Hashable {
        var reservationId: String
        var eventId: String
        var eventName: String
        var start: String
        var end: String
        var quantity: Double
        var source: String
        var id: String { reservationId + source }
    }
    var conflicts: [Conflict]
    var verified: EquipmentAvailability?
}

/// Odpowiedź „Importuj z kalkulacji” — komunikat i braki magazynowe do rozwiązania.
struct EquipmentImportResult: Decodable {
    struct Conflict: Decodable, Hashable { var name: String; var quantity: Double; var available: Double; var equipmentId: String; var type: String }
    var level: String
    var message: String
    var conflicts: [Conflict]
}

// MARK: Checklista etapów (pola jak `EquipmentChecklist` w CRM)

enum EquipmentStage: String, CaseIterable, Identifiable {
    case dispatch, loadback, giveBack = "return"
    var id: String { rawValue }
    var label: String { self == .dispatch ? "Wydanie" : self == .loadback ? "Po wydarzeniu" : "Zwrot" }
    var owner: String { self == .loadback ? "Kierownik realizacji" : "Magazyn" }
    var done: String { self == .dispatch ? "Załadowane" : self == .loadback ? "Załadowane po wydarzeniu" : "Zwrócone" }
    var fullLabel: String { self == .dispatch ? "Spakowane w całości" : self == .loadback ? "Wraca komplet" : "Wróciło sprawne" }
    var qtyTitle: String { self == .dispatch ? "Spakowana ilość" : self == .loadback ? "Ile wraca po wydarzeniu" : "Ile wróciło sprawne" }
}

struct EquipmentChecklistTab: Decodable {
    var status: String
    var checklist: EquipmentChecklist?
    var error: String?
}

struct EquipmentChecklist: Decodable {
    struct Dispatch: Decodable, Hashable {
        var confirmed_at: String?
        var confirmed_by: String?
        var confirmed_by_name: String?
        var note: String?
        var locked: Bool
        var unlock_requested: Bool
        var unlock_requested_at: String?
        var unlock_reason: String?
        var shortage_requested_at: String?
        var shortage_requested_name: String?
        var shortage_request_note: String?
    }
    struct Loadback: Decodable, Hashable { var confirmed_at: String?; var confirmed_by: String?; var confirmed_by_name: String?; var note: String? }
    struct Return: Decodable, Hashable {
        var confirmed_at: String?
        var confirmed_by: String?
        var confirmed_by_name: String?
        var note: String?
        var issue_count: Int
        var issues_ack_at: String?
        var issues_ack_by: String?
        var issues_ack_name: String?
        var issues_ack_note: String?
    }
    struct Can: Decodable, Hashable {
        var pack: Bool
        var request_approval: Bool
        var approve_shortages: Bool
        var confirm_dispatch: Bool
        var request_unlock: Bool
        var loadback: Bool
        var confirm_loadback: Bool
        var returning: Bool
        var confirm_return: Bool
        var ack_issues: Bool
        var reopen: Bool
        enum CodingKeys: String, CodingKey {
            case pack, request_approval, approve_shortages, confirm_dispatch, request_unlock, loadback, confirm_loadback
            case returning = "return", confirm_return, ack_issues, reopen
        }
    }
    struct Person: Decodable, Hashable { var id: String; var name: String; var avatar_url: String?; var avatar: AvatarCrop? }
    struct Summary: Decodable, Hashable {
        var lines: Int
        var required: Int
        var unchecked_dispatch: Int
        var packed_full: Int
        var shortages: Int
        var shortages_pending: Int
        var shortages_approved: Int
        var shortages_rejected: Int
        var shipped: Int
        var loadback_unchecked: Int
        var loadback_missing: Int
        var return_unchecked: Int
        var return_damaged: Int
        var return_missing: Int
    }
    struct Line: Decodable, Hashable, Identifiable {
        var id: String
        var name: String
        var kind: String
        var category: String?
        var thumbnail_url: String?
        var notes: String?
        var quantity: Int
        var required: Bool
        var optional: Bool
        var external_rental: Bool
        var removed: Bool
        var packed_qty: Int?
        var packed_at: String?
        var packed_by: String?
        var packed_by_name: String?
        var shortage_qty: Int
        var shortage_reason: String?
        var shortage_status: String
        var shortage_decided_by: String?
        var shortage_decided_name: String?
        var shortage_decided_at: String?
        var shortage_decision_note: String?
        var shipped_qty: Int
        var loadback_qty: Int?
        var loadback_note: String?
        var loadback_at: String?
        var loadback_by: String?
        var loadback_by_name: String?
        var return_ok_qty: Int?
        var return_damaged_qty: Int?
        var return_missing_qty: Int?
        var return_note: String?
        var return_photos: [String]
        var returned_at: String?
        var returned_by: String?
        var returned_by_name: String?
    }
    struct LogEntry: Decodable, Identifiable {
        var id: String
        var stage: String
        var action: String
        var line_id: String?
        var line_name: String?
        var details: [String: JSONValue]
        var note: String?
        var actor_name: String?
        var created_at: String
    }
    var event_id: String
    var stage: String
    var dispatch: Dispatch
    var loadback: Loadback
    var returning: Return
    var can: Can
    var blockers: [String]
    var people: [String: Person]
    var summary: Summary
    var lines: [Line]
    var log: [LogEntry]
    enum CodingKeys: String, CodingKey {
        case event_id, stage, dispatch, loadback, returning = "return", can, blockers, people, summary, lines, log
    }
}

/// Reguły checklisty (`equipmentLineTone`, `equipmentStageProgress`, walidacje edytorów, opisy historii).
enum EquipmentRules {
    enum Tone { case unchecked, ok, shortage, pending, damaged, missing, skipped }

    static let stageLabels: [String: String] = [
        "empty": "Brak sprzętu", "dispatch": "Wydanie z magazynu", "loadback": "Załadunek powrotny", "return": "Zwrot na magazyn",
        "issues": "Rozbieżności do przyjęcia", "done": "Zakończone",
    ]
    static let stageHints: [String: String] = [
        "empty": "Wydarzenie nie ma sprzętu na liście.",
        "dispatch": "Magazyn odhacza spakowane ilości. Brak oznacz mniejszą ilością z powodem — wydanie czeka na zgodę sprzedawcy lub administratora.",
        "loadback": "Kierownik realizacji przy załadunku po wydarzeniu odhacza, co wraca z wydanego sprzętu, i zatwierdza listę.",
        "return": "Magazyn wpisuje, ile wróciło sprawne, uszkodzone i czego brakuje (z opisem i zdjęciami), i zatwierdza zwrot.",
        "issues": "Zwrot ma rozbieżności — sprzedawca wydarzenia lub administrator przyjmuje je z decyzją, co dalej.",
        "done": "Sprzęt wrócił i został sprawdzony.",
    ]
    static let logLabels: [String: String] = [
        "packed": "Spakowano", "filled": "Wszystko zgodne", "shortage_requested": "Prośba o zgodę na braki", "shortage_approved": "Zgoda na braki",
        "shortage_rejected": "Brak zgody na braki", "dispatch_confirmed": "Wydanie potwierdzone", "unlock_requested": "Prośba o odblokowanie wydania",
        "reopened": "Cofnięto etap", "loadback_set": "Załadunek powrotny", "loadback_confirmed": "Załadunek powrotny zatwierdzony", "return_set": "Zwrot",
        "return_confirmed": "Zwrot zatwierdzony", "issues_acknowledged": "Rozbieżności przyjęte",
    ]

    static func tone(_ line: EquipmentChecklist.Line, _ stage: EquipmentStage) -> Tone {
        if stage == .dispatch {
            guard let packed = line.packed_qty else { return line.required ? .unchecked : .skipped }
            if packed >= line.quantity { return .ok }
            if !line.required { return packed > 0 ? .ok : .skipped }
            return line.shortage_status == "approved" ? .shortage : line.shortage_status == "rejected" ? .missing : .pending
        }
        if line.shipped_qty <= 0 { return .skipped }
        if stage == .loadback {
            guard let back = line.loadback_qty else { return .unchecked }
            return back >= line.shipped_qty ? .ok : .missing
        }
        guard line.return_ok_qty != nil else { return .unchecked }
        if (line.return_damaged_qty ?? 0) > 0 { return .damaged }
        return (line.return_missing_qty ?? 0) > 0 ? .missing : .ok
    }
    static func done(_ line: EquipmentChecklist.Line, _ stage: EquipmentStage) -> Bool { tone(line, stage) == .ok }
    static func problem(_ tone: Tone) -> Bool { tone == .shortage || tone == .missing || tone == .damaged }

    static func actor(_ line: EquipmentChecklist.Line, _ stage: EquipmentStage) -> (id: String?, name: String?, at: String?) {
        switch stage {
        case .dispatch: return (line.packed_by, line.packed_by_name, line.packed_at)
        case .loadback: return (line.loadback_by, line.loadback_by_name, line.loadback_at)
        case .giveBack: return (line.returned_by, line.returned_by_name, line.returned_at)
        }
    }
    static func stageQty(_ line: EquipmentChecklist.Line, _ stage: EquipmentStage) -> (value: Int?, of: Int) {
        switch stage {
        case .dispatch: return (line.packed_qty, line.quantity)
        case .loadback: return (line.loadback_qty, line.shipped_qty)
        case .giveBack: return (line.return_ok_qty, line.shipped_qty)
        }
    }
    static func defaultStage(_ c: EquipmentChecklist) -> EquipmentStage {
        if c.stage == "loadback" { return .loadback }
        if ["return", "issues", "done"].contains(c.stage) { return .giveBack }
        return .dispatch
    }
    static func reopenable(_ c: EquipmentChecklist) -> EquipmentStage? {
        if c.returning.confirmed_at != nil && c.returning.confirmed_by_name != "Nic nie wydano z magazynu" { return .giveBack }
        if c.loadback.confirmed_at != nil && c.loadback.confirmed_by_name != "Nic nie wydano z magazynu" { return .loadback }
        if c.dispatch.confirmed_at != nil { return .dispatch }
        return nil
    }
    static func stageLines(_ c: EquipmentChecklist, _ stage: EquipmentStage) -> [EquipmentChecklist.Line] {
        stage == .dispatch ? c.lines : c.lines.filter { $0.shipped_qty > 0 }
    }
    static func progress(_ c: EquipmentChecklist, _ stage: EquipmentStage) -> (done: Int, total: Int, problems: Int) {
        let lines = stageLines(c, stage).filter { stage != .dispatch || $0.required || $0.packed_qty != nil }
        var done = 0, problems = 0
        for line in lines {
            let t = tone(line, stage)
            if t == .ok { done += 1 } else if problem(t) || t == .pending { problems += 1 }
        }
        return (done, lines.count, problems)
    }
    static func confirmation(_ c: EquipmentChecklist, _ stage: EquipmentStage) -> (at: String?, by: String?, name: String?, note: String?) {
        switch stage {
        case .dispatch: return (c.dispatch.confirmed_at, c.dispatch.confirmed_by, c.dispatch.confirmed_by_name, c.dispatch.note)
        case .loadback: return (c.loadback.confirmed_at, c.loadback.confirmed_by, c.loadback.confirmed_by_name, c.loadback.note)
        case .giveBack: return (c.returning.confirmed_at, c.returning.confirmed_by, c.returning.confirmed_by_name, c.returning.note)
        }
    }
    static func decisionLines(_ c: EquipmentChecklist) -> JSONValue {
        .array(c.lines.filter { $0.shortage_status == "pending" || $0.shortage_status == "rejected" }
            .map { .object(["id": .string($0.id), "shortage_qty": .number(Double($0.shortage_qty))]) })
    }

    // Walidacje edytorów (`equipmentPackedError`, `equipmentLoadbackError`, `equipmentReturnError`).
    static func packedError(_ line: EquipmentChecklist.Line, _ qty: Int, _ reason: String) -> String? {
        if qty < 0 || qty > line.quantity { return "Spakowana ilość musi być od 0 do \(line.quantity)." }
        if qty < line.quantity && line.required && reason.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 {
            return "Brakuje \(line.quantity - qty) szt. — opisz powód braku."
        }
        return nil
    }
    static func loadbackError(_ line: EquipmentChecklist.Line, _ qty: Int, _ note: String) -> String? {
        if qty < 0 || qty > line.shipped_qty { return "Ilość musi być od 0 do \(line.shipped_qty) (tyle wydano)." }
        if qty < line.shipped_qty && note.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 { return "Brakuje \(line.shipped_qty - qty) szt. — opisz, co się stało." }
        return nil
    }
    static func returnMissing(_ line: EquipmentChecklist.Line, ok: Int, damaged: Int) -> Int { max(line.shipped_qty - ok - damaged, 0) }
    static func returnError(_ line: EquipmentChecklist.Line, ok: Int, damaged: Int, note: String) -> String? {
        if ok < 0 || damaged < 0 || ok + damaged > line.shipped_qty { return "Sprawne i uszkodzone razem mogą dać najwyżej \(line.shipped_qty) szt." }
        if (damaged > 0 || ok + damaged < line.shipped_qty) && note.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 { return "Opisz uszkodzenia lub brak." }
        return nil
    }

    // Daty i podpisy (`formatEquipmentDate`, `equipmentByLine`, `firstName`).
    static func date(_ iso: String?) -> String {
        guard let iso, let d = MeetingDates.parse(iso) else { return "" }
        return d.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year().hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "pl_PL")))
    }
    static func shortDate(_ iso: String?) -> String {
        guard let iso, let d = MeetingDates.parse(iso) else { return "" }
        return d.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "pl_PL")))
    }
    static func byLine(_ name: String?, _ at: String?) -> String {
        [name?.nonEmpty, date(at).nonEmpty].compactMap { $0 }.joined(separator: " · ")
    }
    static func firstName(_ name: String?) -> String { (name ?? "").split(separator: " ").first.map(String.init) ?? "" }

    static func logLabel(_ entry: EquipmentChecklist.LogEntry) -> String { logLabels[entry.action] ?? "Zmiana checklisty" }
    static func logDetail(_ entry: EquipmentChecklist.LogEntry) -> String {
        let d = entry.details
        func n(_ key: String) -> Int? {
            switch d[key] {
            case .number(let v)?: return v.isFinite ? Int(v) : nil
            case .string(let v)?: return Int(v.trimmingCharacters(in: .whitespaces))
            default: return nil
            }
        }
        func t(_ key: String) -> String? { d[key]?.text.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty }
        switch entry.action {
        case "packed":
            guard let packed = n("packed_qty") else { return "odznaczono" }
            let of = n("quantity").map { String($0) } ?? "?"
            return String(packed) + "/" + of + " szt."
        case "loadback_set":
            guard let qty = n("loadback_qty") else { return "odznaczono" }
            let of = n("shipped_qty").map { String($0) } ?? "?"
            return "wraca " + String(qty) + "/" + of + " szt."
        case "return_set":
            let photos = n("photos") ?? 0
            guard let ok = n("ok") else { return photos > 0 ? "zdjęcia: \(photos)" : "odznaczono" }
            var parts = ["sprawne \(ok)"]
            if let v = n("damaged"), v != 0 { parts.append("uszkodzone \(v)") }
            if let v = n("missing"), v != 0 { parts.append("brak \(v)") }
            if let v = n("photos"), v != 0 { parts.append("zdjęcia \(v)") }
            return parts.joined(separator: ", ")
        case "filled":
            if let v = n("count"), v != 0 { return "pozycji: \(v)" }
            return ""
        case "shortage_requested", "shortage_approved", "shortage_rejected", "dispatch_confirmed":
            return t("shortages").map { "Braki: \($0)" } ?? ""
        case "loadback_confirmed":
            return t("missing").map { "Rozbieżności: \($0)" } ?? "komplet"
        case "return_confirmed":
            if let issues = n("issues"), issues != 0 {
                let list = t("list") ?? ""
                return ("Rozbieżności (\(issues)): " + list).trimmingCharacters(in: .whitespaces)
            }
            return "bez rozbieżności"
        default:
            return ""
        }
    }
}

/// Pozycja katalogu „Dodaj sprzęt” z kopii na dysku (zbiór synchronizowany koszykami, `op=equipmentCatalog`).
struct EquipmentCatalogEntry: Codable, Hashable, SyncKeyed {
    var kind: String
    var id: String
    var name: String
    var brand: String?
    var model: String?
    var category: String?
    var description: String?
    var thumbnail: String?
    var total: Double
    var reserved: Double
    var used: Double
    var availableInTerm: Double
    var maxAdd: Double
    var maxSet: Double
    var contents: [EquipmentCatalog.KitContent]?
    var loaded: Bool
    var syncKey: String { "\(kind):\(id)" }
}
