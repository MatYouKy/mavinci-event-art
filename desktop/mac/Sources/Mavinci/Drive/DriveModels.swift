import Foundation
import SwiftUI
import UniformTypeIdentifiers

// MARK: Dysk — modele 1:1 z `src/lib/drive/driveShared.ts` (`/bridge/native/v1/drive`)
//
// Dysk to ta sama chmura co w Finderze (Mavinci → …) i w CRM (`/crm/materials`): Finanse (firma → Księgowość → rok →
// miesiąc → Sprzedaż, Koszty, Bank, Podatki i ZUS, XML z KSeF; Dokumenty spółki → kategoria; Umowy stałe → umowa — tylko osoby
// z dostępem do finansów firmy), Eventy (pliki eventów), Materiały (baza plików marki), Oferty, Kalkulacje i Umowy (PDF-y z CRM:
// rok → miesiąc), Magazyn (kategoria → sprzęt → zdjęcia, pliki, instrukcja), Pracownicy (pracownik → Zdjęcia, Dokumenty, Umowy).
// Księgowość, Oferty, Kalkulacje i Umowy są tylko do odczytu; pliki można dodawać do sprzętu w Magazynie, do dokumentów
// pracownika oraz do Dokumentów spółki i umów stałych („Finanse — zarządzanie”, które też je usuwa).

enum DriveSection: String, Codable, CaseIterable, Identifiable {
    case finance, events, materials, offers, calculations, contracts, warehouse, employees
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .finance: return "building.columns"
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
    /// `section` | `year` | `month` | `category` | `equipment` | `brand` | `employee` | `group` (Zdjęcia, Dokumenty, Umowy pracownika)
    /// | `company` | `books` (Księgowość) | `ledger` (Sprzedaż, Koszty, Bank, Podatki i ZUS, XML z KSeF) | `corporate` (Dokumenty spółki)
    /// | `docgroup` (ich kategoria) | `agreements` (Umowy stałe) | `agreement` (jedna umowa) | `assets` (Majątek — rejestr majątku)
    /// | `clarify` (Do wyjaśnienia).
    let kind: String
    let count: Int?
    var symbol: String {
        switch kind {
        case "year", "month": return "calendar"
        case "equipment": return "shippingbox"
        case "category": return "folder"
        case "brand": return "paintpalette"
        case "employee": return "person.crop.circle"
        case "company": return "building.2"
        case "books": return "books.vertical"
        case "ledger": return DriveText.ledgerSymbol(financeGroup)
        case "corporate": return "briefcase"
        case "agreements": return "signature"
        case "agreement": return "doc.text"
        case "assets": return "shippingbox"
        case "clarify": return "exclamationmark.triangle"
        default: return "folder"
        }
    }
    /// Grupa księgowa folderu Finansów (`finance:<firma>:books:RRRR-MM:<grupa>`): `sales`, `costs`, `bank`, `taxes`, `ksef`.
    var financeGroup: String? {
        guard id.hasPrefix("finance:"), kind == "ledger", let last = id.split(separator: ":").last else { return nil }
        return String(last)
    }
    /// Folder w drzewie bez podfolderów: grupa pracownika, teczka miesiąca, kategoria Dokumentów spółki, umowa stała i miesiąc
    /// (poza Finansami, gdzie miesiąc ma teczki).
    var isLeaf: Bool { ["group", "ledger", "docgroup", "agreement", "assets", "clarify"].contains(kind) || (kind == "month" && !id.hasPrefix("finance:")) }
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
    /// Plik można usunąć z Dysku (dokument spółki, plik umowy stałej — „Finanse — zarządzanie”); starszy serwer pola nie wysyła.
    let canDelete: Bool?
    var isImage: Bool { kind == "image" }
    var deletable: Bool { canDelete == true }
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

/// Informacja serwera po dodaniu pliku (`completeUpload`, `completeScan`): odczytane dane, inna teczka miesiąca…
struct DriveUploadNotice: Codable { let notice: String? }

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
        case "event": return "Otwórz event"
        case "inquiry": return "Otwórz zapytanie"
        case "contract": return "Otwórz umowę"
        case "equipment": return "Otwórz sprzęt"
        case "company": return "Otwórz księgę znaku"
        case "employee": return "Otwórz profil pracownika"
        case "invoice": return "Otwórz fakturę"
        case "ksef-invoice": return "Otwórz faktury z KSeF"
        case "external-invoice": return "Otwórz dokumenty spoza KSeF"
        case "finance": return "Otwórz Centrum finansów"
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
        case "invoice": return "/crm/invoices/\(record.id)"
        case "ksef-invoice": return "/crm/invoices?tab=ksef"
        case "external-invoice": return "/crm/invoices?tab=external"
        case "finance": return "/crm/invoices?tab=center"
        default: return "/crm"
        }
    }

    /// Opis pliku pod nazwą: szczegół z serwera, rozmiar, data.
    static func caption(_ file: DriveFile) -> String {
        [file.detail, file.size.map { MaterialsText.bytes($0) } ?? "", MaterialsText.dateLabel(file.updatedAt)]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// Ikona grupy księgowej (jak `ledgerIcons` w CRM).
    static func ledgerSymbol(_ group: String?) -> String {
        switch group {
        case "sales": return "chart.line.uptrend.xyaxis"
        case "costs": return "receipt"
        case "bank": return "building.columns"
        case "taxes": return "percent"
        case "ksef": return "chevron.left.forwardslash.chevron.right"
        default: return "folder"
        }
    }

    /// Pusty folder Finansów (jak `FINANCE_EMPTY` w CRM).
    static func financeEmpty(_ node: DriveFolder?) -> String {
        guard let node else { return "Nie masz dostępu do finansów żadnej firmy." }
        switch node.financeGroup {
        case "sales": return "Brak faktur sprzedaży z tego miesiąca (proformy, szkice i anulowane nie trafiają do księgowości)."
        case "costs": return "Brak dokumentów kosztowych z tego miesiąca — faktur odebranych w KSeF ani dokumentów spoza KSeF."
        case "bank": return "Brak wyciągów bankowych z tego miesiąca. Wyciągi dodaje się w Centrum finansów."
        case "taxes": return "Brak deklaracji i dokumentów podatkowych z tego miesiąca. Dodaje się je w Centrum finansów."
        case "ksef": return "Brak plików XML z KSeF z tego miesiąca."
        default: break
        }
        if node.kind == "books" { return "Brak dokumentów księgowych tej firmy." }
        if node.kind == "docgroup" { return "Brak dokumentów w tej kategorii. Dodaje je osoba z poziomem „Finanse — zarządzanie”." }
        if node.kind == "agreement" { return "Ta umowa nie ma jeszcze plików. Dodaje je osoba z poziomem „Finanse — zarządzanie”." }
        if node.kind == "agreements" { return "Brak umów stałych. Umowy zakłada się w Centrum finansów (najem, leasing, abonamenty, ubezpieczenia, kredyty)." }
        return node.kind == "section" ? "Nie masz dostępu do finansów żadnej firmy." : "Ten folder jest pusty."
    }

    /// Pusty folder — opis zależny od działu.
    static func empty(_ section: DriveSection, node: DriveFolder?, canUpload: Bool) -> String {
        switch section {
        case .finance:
            if canUpload, node?.kind == "ledger", node?.financeGroup == "costs" {
                return "Brak dokumentów kosztowych z tego miesiąca — przeciągnij tu skan albo plik dokumentu spoza KSeF albo użyj „Dodaj pliki”."
            }
            if canUpload, node?.kind == "docgroup" { return "Brak dokumentów w tej kategorii — przeciągnij tu skany i pliki albo użyj „Dodaj pliki”." }
            if canUpload, node?.kind == "agreement" { return "Ta umowa nie ma jeszcze plików — przeciągnij tu umowę, aneksy albo harmonogram płatności albo użyj „Dodaj pliki”." }
            return financeEmpty(node)
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

    /// Dokąd trafiają pliki dodane w folderze: „dokumentów pracownika”, „kosztów”, „dokumentów spółki”, „umowy” albo „sprzętu”.
    static func uploadPlace(_ node: String) -> String {
        if node.hasPrefix("employees:") { return "dokumentów pracownika" }
        if node.hasPrefix("finance:") && node.hasSuffix(":costs") { return "kosztów" }
        if node.hasPrefix("finance:") { return node.contains(":corporate:") ? "dokumentów spółki" : "umowy" }
        return "sprzętu"
    }

    /// Opis panelu wyboru plików i pola upuszczania dla folderu (`name` — nazwa sprzętu albo umowy).
    static func uploadHint(_ node: String, name: String) -> String {
        if node.hasPrefix("employees:") { return "Pliki trafią do dokumentów pracownika (do 50 MB każdy) — nazwę, rodzaj i termin ważności zmienisz w profilu pracownika." }
        if node.hasPrefix("finance:") && node.hasSuffix(":costs") {
            return "Każdy plik stanie się dokumentem spoza KSeF (do 50 MB): AI odczyta dane, a dokument trafi do teczki miesiąca z jego daty."
        }
        if node.hasPrefix("finance:") && node.contains(":corporate:") { return "Pliki trafią do Dokumentów spółki — „\(name)” (do 50 MB każdy)." }
        if node.hasPrefix("finance:") { return "Pliki trafią do umowy stałej „\(name)” (do 50 MB każdy)." }
        return "Pliki trafią do sprzętu „\(name)”: zdjęcia do 10 MB — do galerii, inne pliki do 50 MB."
    }

    /// Napis na polu upuszczania.
    static func dropLabel(_ node: String, name: String) -> String {
        if node.hasPrefix("employees:") { return "Upuść tutaj — do dokumentów pracownika" }
        if node.hasPrefix("finance:") && node.hasSuffix(":costs") { return "Upuść tutaj — do kosztów (dokument spoza KSeF)" }
        if node.hasPrefix("finance:") && node.contains(":corporate:") { return "Upuść tutaj — do Dokumentów spółki („\(name)”)" }
        if node.hasPrefix("finance:") { return "Upuść tutaj — do umowy „\(name)”" }
        return "Upuść tutaj — do sprzętu „\(name)”"
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
