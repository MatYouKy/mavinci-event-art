import Foundation
import SwiftUI
import UniformTypeIdentifiers

// MARK: Dysk — modele 1:1 z `src/lib/drive/driveShared.ts` (`/bridge/native/v1/drive`)
//
// Dysk to ta sama chmura co w Finderze (Mavinci → …), w CRM (`/crm/materials`) i w telefonie: Eventy (pliki wydarzeń),
// Materiały (baza plików marki), Oferty, Kalkulacje i Umowy (PDF-y z CRM: rok → miesiąc), Magazyn (kategoria → sprzęt →
// zdjęcia, pliki, instrukcja), Pracownicy (pracownik → Zdjęcia, Dokumenty, Umowy). Oferty, Kalkulacje i Umowy są tylko
// do odczytu; pliki można dodawać do sprzętu w Magazynie i do dokumentów pracownika.

enum DriveSection: String, Codable, CaseIterable, Identifiable {
    case events, materials, offers, calculations, contracts, warehouse, employees
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .events: return "calendar"
        case .materials: return "archivebox"
        case .offers: return "doc.text"
        case .calculations: return "function"
        case .contracts: return "signature"
        case .warehouse: return "shippingbox"
        case .employees: return "person.2"
        }
    }
    /// Dział przeglądany przez `/bridge/native/v1/drive` (Eventy i Materiały mają własne ekrany).
    var browsable: Bool { ![.events, .materials].contains(self) }
}

/// Dział z uprawnieniami pracownika (`available` — dostęp, `canUpload` — dodawanie plików: sprzęt, dokumenty wszystkich pracowników).
struct DriveSectionInfo: Codable, Identifiable, Hashable {
    let key: String
    let label: String
    let description: String
    let available: Bool
    let canUpload: Bool
    var id: String { key }
    /// Dział znany aplikacji (nowszy serwer może dodać kolejny — wtedy go pomijamy).
    var section: DriveSection? { DriveSection(rawValue: key) }
}

struct DriveRoot: Codable {
    let title: String
    let sections: [DriveSectionInfo]
    var available: [DriveSectionInfo] { sections.filter { $0.available && $0.section != nil } }
}

struct DriveFolder: Codable, Identifiable, Hashable {
    let id: String
    let parentId: String?
    let name: String
    /// `section` | `year` | `month` | `category` | `equipment` | `brand` | `employee` | `group` (Zdjęcia, Dokumenty, Umowy pracownika).
    let kind: String
    let count: Int?
    var symbol: String {
        switch kind {
        case "year", "month": return "calendar"
        case "equipment": return "shippingbox"
        case "category": return "folder"
        case "brand": return "paintpalette"
        case "employee": return "person.crop.circle"
        default: return "folder"
        }
    }
    /// Folder dokumentów pracownika (`employees:<id>:documents`).
    var isEmployeeDocuments: Bool { id.hasPrefix("employees:") && id.hasSuffix(":documents") }
}

struct DriveRecord: Codable, Hashable {
    let type: String
    let id: String
}

struct DriveFile: Codable, Identifiable, Hashable {
    let id: String
    let parentId: String
    let name: String
    let type: String
    let mime: String
    /// Rodzaj jak w Materiałach (`image`, `pdf`, `font`, …).
    let kind: String
    let size: Double?
    let updatedAt: String?
    /// Zmienia się razem z treścią — klucz kopii do podglądu.
    let version: String
    let thumbnailUrl: String?
    let record: DriveRecord?
    let detail: String
    var isImage: Bool { kind == "image" }
    var utType: UTType { MaterialsText.type(of: name) }
}

struct DriveBrandColor: Codable, Hashable {
    let label: String
    let hex: String
    let role: String
}

struct DriveListing: Codable {
    let node: DriveFolder
    let path: [DriveFolder]
    let folders: [DriveFolder]
    let files: [DriveFile]
    let canUpload: Bool
    let colors: [DriveBrandColor]
}

struct DriveDownload: Codable {
    let url: String
    let name: String
    let mime: String
    let size: Double?
}

struct DriveUpload: Codable {
    let bucket: String
    let path: String
    let signedUrl: String
    let token: String
    let target: String
}

struct DriveUploaded: Codable { let file: DriveFile }

/// Wydarzenie w dziale Eventy (`/bridge/native/v1/files?op=events`) — folder „RRRR-MM-DD Nazwa” jak w Finderze.
struct DriveEvent: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let date: String?
    let endDate: String?
    let status: String?
    let updatedAt: String?
}

struct DriveEventsReply: Codable { let events: [DriveEvent] }

enum DriveText {
    static let noDate = "Bez daty"

    /// Rok wydarzenia (folder w Eventy); bez daty — „Bez daty”.
    static func year(_ event: DriveEvent) -> String {
        guard let date = event.date, date.count >= 4, Int(date.prefix(4)) != nil else { return noDate }
        return String(date.prefix(4))
    }

    /// Folder wydarzenia: „2026-11-21 Gala firmowa” (jak w Finderze i w CRM).
    static func eventFolder(_ event: DriveEvent) -> String {
        guard let date = event.date, date.count >= 10 else { return event.name }
        return "\(date.prefix(10)) \(event.name)"
    }

    /// Przycisk otwarcia rekordu (jak `DRIVE_RECORD_LABELS`).
    static func recordLabel(_ record: DriveRecord) -> String {
        switch record.type {
        case "offer": return "Otwórz ofertę"
        case "event": return "Otwórz wydarzenie"
        case "inquiry": return "Otwórz zapytanie"
        case "contract": return "Otwórz umowę"
        case "equipment": return "Otwórz sprzęt"
        case "company": return "Otwórz księgę znaku"
        case "employee": return "Otwórz profil pracownika"
        default: return "Otwórz w CRM"
        }
    }

    /// Adres rekordu w CRM (jak `driveRecordPath`).
    static func recordPath(_ record: DriveRecord) -> String {
        switch record.type {
        case "offer": return "/crm/offers/\(record.id)"
        case "event": return "/crm/events/\(record.id)"
        case "inquiry": return "/crm/inquiries/\(record.id)"
        case "contract": return "/crm/contracts/\(record.id)"
        case "equipment": return "/crm/equipment/\(record.id)"
        case "company": return "/crm/settings/my-companies/\(record.id)/brandbook"
        case "employee": return "/crm/employees/\(record.id)"
        default: return "/crm"
        }
    }

    /// Opis pliku pod nazwą: szczegół z serwera, rozmiar, data.
    static func caption(_ file: DriveFile) -> String {
        [file.detail, file.size.map { MaterialsText.bytes($0) } ?? "", MaterialsText.dateLabel(file.updatedAt)]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// Pusty folder — opis zależny od działu.
    static func empty(_ section: DriveSection, node: DriveFolder?, canUpload: Bool) -> String {
        switch section {
        case .offers: return node?.kind == "month" ? "W tym miesiącu nie wystawiono ofert z PDF-em." : "Brak ofert z wygenerowanym PDF-em."
        case .calculations: return node?.kind == "month" ? "W tym miesiącu nie ma kalkulacji z PDF-em." : "Brak kalkulacji z wygenerowanym PDF-em."
        case .contracts: return node?.kind == "month" ? "W tym miesiącu nie wystawiono umów z PDF-em." : "Brak umów z wygenerowanym PDF-em."
        case .warehouse:
            if node?.kind == "equipment" {
                return canUpload ? "Ten sprzęt nie ma jeszcze plików — przeciągnij tu zdjęcia, instrukcje albo inne pliki." : "Ten sprzęt nie ma jeszcze plików."
            }
            return "Brak sprzętu w tej kategorii."
        case .employees:
            guard let node else { return "Brak aktywnych pracowników." }
            if node.id.hasSuffix(":photos") { return "Pracownik nie ma jeszcze zdjęcia profilowego ani zdjęcia w tle." }
            if node.id.hasSuffix(":contracts") { return "Brak dokumentów umów. Dokument powstaje w profilu pracownika: „Umowy i rozliczenia” → „Generuj dokument”." }
            if node.isEmployeeDocuments {
                return canUpload ? "Brak dokumentów — przeciągnij tu skany i pliki albo użyj „Dodaj pliki”." : "Brak dokumentów pracownika."
            }
            return node.kind == "section" ? "Brak aktywnych pracowników." : "Ten folder jest pusty."
        case .events, .materials: return "Ten folder jest pusty."
        }
    }

    /// Dokąd trafiają pliki dodane w folderze: „dokumentów pracownika” albo „sprzętu” (komunikaty wysyłki).
    static func uploadPlace(_ node: String) -> String {
        node.hasPrefix("employees:") ? "dokumentów pracownika" : "sprzętu"
    }
}

/// Rodzaj dokumentu pracownika (jak `EMPLOYEE_DOCUMENT_TYPES` w `driveShared.ts`).
enum EmployeeDocumentType: String, CaseIterable, Identifiable {
    case contract, certificate, id_document, medical, training, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .contract: return "Umowa"
        case .certificate: return "Certyfikat"
        case .id_document: return "Dokument tożsamości"
        case .medical: return "Badania lekarskie"
        case .training: return "Szkolenie BHP"
        case .other: return "Inny"
        }
    }
}
