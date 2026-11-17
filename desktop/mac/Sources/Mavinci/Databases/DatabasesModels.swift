import Foundation

// MARK: Bazy danych — odpowiedzi `/bridge/native/v1/databases` (`src/lib/native/databases.ts`): bazy, kolumny, rekordy
// (dane w JSON według identyfikatora kolumny) i udostępnienia.

struct CustomDatabaseAccess: Decodable, Hashable {
    var canManage: Bool
    var isAdmin: Bool
}

struct CustomDatabase: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String
    var createdAt: String
    var updatedAt: String
}

/// Typy kolumn jak w CRM (`text`, `number`, `date`, `boolean`, `phone`, `email`).
enum CustomDatabaseType: String, CaseIterable, Identifiable {
    case text, number, date, boolean, phone, email
    var id: String { rawValue }
    var label: String {
        switch self {
        case .text: return "Tekst"
        case .number: return "Liczba"
        case .date: return "Data"
        case .boolean: return "Tak/Nie"
        case .phone: return "Telefon"
        case .email: return "Email"
        }
    }
}

struct CustomDatabaseColumn: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var type: String
    var order: Int
    var width: Double
    var kind: CustomDatabaseType { CustomDatabaseType(rawValue: type) ?? .text }
}

struct CustomDatabaseRecord: Decodable, Identifiable, Equatable {
    var id: String
    var data: [String: JSONValue]
    var order: Int
    var createdAt: String
    var updatedAt: String
    func value(_ column: CustomDatabaseColumn) -> JSONValue? { data[column.id] }
}

struct CustomDatabaseList: Decodable {
    var access: CustomDatabaseAccess
    var databases: [CustomDatabase]
}

struct CustomDatabaseDetail: Decodable {
    var access: CustomDatabaseAccess
    var database: CustomDatabase
    var columns: [CustomDatabaseColumn]
    var records: [CustomDatabaseRecord]
}

struct CustomDatabasePerson: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var avatarUrl: String?
    var avatar: AvatarCrop?
}

struct CustomDatabaseShare: Decodable, Identifiable, Hashable {
    var id: String
    var employeeId: String
    var canEdit: Bool
    var employee: CustomDatabasePerson
}

struct CustomDatabaseShares: Decodable {
    var shares: [CustomDatabaseShare]
    var employees: [CustomDatabasePerson]
}

/// Wartości komórek: tekst do edycji, tekst do wyświetlenia i „Tak/Nie”.
enum CustomDatabaseValue {
    /// Surowy tekst komórki (jak `String(value || '')` w CRM).
    static func raw(_ value: JSONValue?) -> String {
        switch value {
        case .string(let text): return text
        case .number(let number): return number.rounded() == number && abs(number) < 1e15 ? String(Int64(number)) : String(number)
        case .bool(let flag): return flag ? "true" : "false"
        default: return ""
        }
    }
    /// Komórka „Tak/Nie”: prawda dla `true` i niepustego tekstu innego niż „false/nie/0”.
    static func flag(_ value: JSONValue?) -> Bool {
        switch value {
        case .bool(let flag): return flag
        case .number(let number): return number != 0
        case .string(let text): return !["", "false", "nie", "0", "no"].contains(text.trimmingCharacters(in: .whitespaces).lowercased())
        default: return false
        }
    }
    static func display(_ value: JSONValue?, _ column: CustomDatabaseColumn) -> String {
        switch column.kind {
        case .boolean: return flag(value) ? "Tak" : "Nie"
        case .date:
            let text = raw(value)
            return DayDates.parse(text).map { MeetingDates.format($0, "dd.MM.yyyy") } ?? text
        default: return raw(value)
        }
    }
    /// Wartość do eksportu (CSV, PDF, wydruk).
    static func export(_ value: JSONValue?, _ column: CustomDatabaseColumn) -> String {
        column.kind == .boolean ? (flag(value) ? "Tak" : "Nie") : raw(value)
    }
}
