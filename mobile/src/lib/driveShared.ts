/*
 * Dysk — wspólne stałe, typy i funkcje CRM (web), serwera Next i telefonu (kopia 1:1 w `mobile/src/lib/driveShared.ts`,
 * para w `scripts/ci/check-shared-copies.mjs`); Mac — odpowiednik w Swift (`Drive/DriveModels.swift`). Bez importów.
 *
 * Dysk to ta sama chmura, co w Finderze (Mavinci → …): Eventy (pliki wydarzeń), Materiały (baza plików marki), Oferty,
 * Kalkulacje i Umowy (PDF-y z CRM: rok → miesiąc), Magazyn (kategoria → sprzęt → zdjęcia, pliki, instrukcja), Pracownicy
 * (pracownik → Zdjęcia, Dokumenty, Umowy). Oferty, Kalkulacje i Umowy są tylko do odczytu (PDF-y powstają w CRM); pliki
 * można dodawać do sprzętu w Magazynie i do dokumentów pracownika.
 */

export const DRIVE_TITLE = 'Dysk';

export type DriveSection = 'events' | 'materials' | 'offers' | 'calculations' | 'contracts' | 'warehouse' | 'employees';
export type DriveDocumentSection = 'offers' | 'calculations' | 'contracts';

/** Działy w kolejności jak w Finderze. */
export const DRIVE_SECTIONS: ReadonlyArray<{ key: DriveSection; label: string; description: string }> = [
  { key: 'events', label: 'Eventy', description: 'Pliki wydarzeń: rok → wydarzenie → foldery z zakładki Pliki.' },
  { key: 'materials', label: 'Materiały', description: 'Logotypy i księga znaku, zdjęcia, wideo, prezentacje i dokumenty marki.' },
  { key: 'offers', label: 'Oferty', description: 'PDF-y wystawionych ofert: rok → miesiąc.' },
  { key: 'calculations', label: 'Kalkulacje', description: 'PDF-y kalkulacji wydarzeń i zapytań: rok → miesiąc.' },
  { key: 'contracts', label: 'Umowy', description: 'PDF-y umów: rok → miesiąc.' },
  { key: 'warehouse', label: 'Magazyn', description: 'Sprzęt: zdjęcia, pliki i instrukcje — kategoria → sprzęt.' },
  { key: 'employees', label: 'Pracownicy', description: 'Zdjęcia, dokumenty i umowy pracowników — pracownik → Zdjęcia, Dokumenty, Umowy.' },
];

export const DRIVE_DOCUMENT_SECTIONS: readonly DriveDocumentSection[] = ['offers', 'calculations', 'contracts'];

export const DRIVE_MONTHS = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
] as const;

/** Nazwa folderu miesiąca: „11 — listopad” (sortuje się po numerze). */
export const driveMonthName = (month: number) => `${String(month).padStart(2, '0')} — ${DRIVE_MONTHS[Math.min(12, Math.max(1, month)) - 1]}`;

/**
 * Zdjęcie sprzętu do 10 MB (bucket `equipment-images`), inne pliki sprzętu do 50 MB (`equipment-files`) — jak w CRM;
 * dokument pracownika do 50 MB (`employee-documents`).
 */
export const DRIVE_UPLOAD_LIMITS = { image: 10 * 1024 * 1024, file: 50 * 1024 * 1024 } as const;

/** Foldery pracownika w dziale Pracownicy. */
export type DriveEmployeeGroup = 'photos' | 'documents' | 'contracts';
export const DRIVE_EMPLOYEE_GROUPS: ReadonlyArray<{ key: DriveEmployeeGroup; label: string }> = [
  { key: 'photos', label: 'Zdjęcia' },
  { key: 'documents', label: 'Dokumenty' },
  { key: 'contracts', label: 'Umowy' },
];

/** Rodzaj dokumentu pracownika (CRM: profil → Dokumenty; wartości jak w bazie — `employee_documents.document_type`). */
export type EmployeeDocumentType = 'contract' | 'certificate' | 'id_document' | 'medical' | 'training' | 'other';
export const EMPLOYEE_DOCUMENT_TYPES: ReadonlyArray<{ key: EmployeeDocumentType; label: string }> = [
  { key: 'contract', label: 'Umowa' },
  { key: 'certificate', label: 'Certyfikat' },
  { key: 'id_document', label: 'Dokument tożsamości' },
  { key: 'medical', label: 'Badania lekarskie' },
  { key: 'training', label: 'Szkolenie BHP' },
  { key: 'other', label: 'Inny' },
];
/** Limity pól dokumentu pracownika (jak ograniczenia w bazie). */
export const EMPLOYEE_DOCUMENT_LIMITS = { name: 200, description: 2000 } as const;

export const employeeDocumentType = (value: unknown): EmployeeDocumentType =>
  (EMPLOYEE_DOCUMENT_TYPES.find((entry) => entry.key === value)?.key || 'other');

export type DriveFolderKind = 'section' | 'year' | 'month' | 'category' | 'equipment' | 'brand' | 'employee' | 'group';

export type DriveFolder = {
  id: string;
  parentId: string | null;
  name: string;
  kind: DriveFolderKind;
  /** Liczba plików (rok, miesiąc) albo pozycji (kategoria) — dla podpowiedzi; `null` — nie liczono. */
  count: number | null;
};

export type DriveFileType =
  | 'offer' | 'calculation' | 'contract' | 'equipment-image' | 'equipment-file' | 'equipment-manual' | 'brand-logo' | 'brand-font' | 'company-logo'
  | 'employee-avatar' | 'employee-background' | 'employee-document' | 'employee-contract';

export type DriveRecordType = 'offer' | 'event' | 'inquiry' | 'contract' | 'equipment' | 'company' | 'employee';

export type DriveFile = {
  id: string;
  parentId: string;
  name: string;
  type: DriveFileType;
  mime: string;
  /** Rodzaj jak w Materiałach (`image`, `pdf`, `font`, …) — ikona i podgląd. */
  kind: string;
  size: number | null;
  updatedAt: string | null;
  /** Zmienia się, gdy zmienia się treść (np. nowy PDF oferty) — Finder pobiera plik od nowa. */
  version: string;
  thumbnailUrl: string | null;
  /** Rekord w CRM, z którego pochodzi plik (otwarcie oferty, wydarzenia, sprzętu…). */
  record: { type: DriveRecordType; id: string } | null;
  /** Krótki opis pod nazwą: status oferty, klient, kategoria… */
  detail: string;
};

export type DriveBrandColor = { label: string; hex: string; role: string };

export type DriveListing = {
  node: DriveFolder;
  path: DriveFolder[];
  folders: DriveFolder[];
  files: DriveFile[];
  /**
   * Czy do tego folderu można dodawać pliki: sprzęt w Magazynie (prawo „Zarządzanie magazynem”), dokumenty pracownika
   * (własne albo z prawem „Pracownicy — zarządzanie”).
   */
  canUpload: boolean;
  /** Kolory z księgi znaku (folder marki). */
  colors: DriveBrandColor[];
};

/** `canUpload` — dodawanie plików w dziale (Magazyn: „Zarządzanie magazynem”; Pracownicy: dokumenty wszystkich pracowników). */
export type DriveSectionInfo = { key: DriveSection; label: string; description: string; available: boolean; canUpload: boolean };
export type DriveRoot = { title: string; sections: DriveSectionInfo[] };
/**
 * Księga znaku marki w Finderze: folder „Z księgi znaku” w folderze „Logotypy i księga znaku” Materiałów (`materialFolderId`),
 * z logotypami i fontami (pliki z `parentId` = `brand:<firma>`) i plikiem „Kolory marki.txt” z kolorów.
 */
export type DriveBrandNode = { companyId: string; companyName: string; materialFolderId: string; colors: DriveBrandColor[] };
export type DriveSync = { cursor: string; sections: DriveSectionInfo[]; folders: DriveFolder[]; files: DriveFile[]; brands: DriveBrandNode[] };
export type DriveDownload = { url: string; name: string; mime: string; size: number | null };
export type DriveUpload = { bucket: string; path: string; signedUrl: string; token: string; target: 'image' | 'file' };

export type DriveNode =
  | { section: DriveDocumentSection; year: number | null; month: number | null }
  | { section: 'warehouse'; categoryId: string | null; equipmentId: string | null; uncategorized: boolean }
  | { section: 'employees'; employeeId: string | null; group: DriveEmployeeGroup | null }
  | { section: 'brand'; companyId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identyfikator folderu Dysku: `offers` | `offers:2026` | `offers:2026-11` (tak samo `calculations`, `contracts`),
 * `warehouse` | `warehouse:none` | `warehouse:cat:<id>` | `warehouse:item:<id>`, `employees` | `employees:<pracownik>` |
 * `employees:<pracownik>:photos|documents|contracts`, `brand:<firma>`.
 */
export function parseDriveNode(value: unknown): DriveNode | null {
  const id = String(value ?? '');
  const parts = id.split(':');
  if ((DRIVE_DOCUMENT_SECTIONS as readonly string[]).includes(parts[0])) {
    const section = parts[0] as DriveDocumentSection;
    if (parts.length === 1) return { section, year: null, month: null };
    const match = /^(\d{4})(?:-(\d{2}))?$/.exec(parts[1] || '');
    if (parts.length !== 2 || !match) return null;
    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    if (year < 2000 || year > 2100 || (month !== null && (month < 1 || month > 12))) return null;
    return { section, year, month };
  }
  if (parts[0] === 'warehouse') {
    if (parts.length === 1) return { section: 'warehouse', categoryId: null, equipmentId: null, uncategorized: false };
    if (parts.length === 2 && parts[1] === 'none') return { section: 'warehouse', categoryId: null, equipmentId: null, uncategorized: true };
    if (parts.length === 3 && UUID.test(parts[2])) {
      if (parts[1] === 'cat') return { section: 'warehouse', categoryId: parts[2].toLowerCase(), equipmentId: null, uncategorized: false };
      if (parts[1] === 'item') return { section: 'warehouse', categoryId: null, equipmentId: parts[2].toLowerCase(), uncategorized: false };
    }
    return null;
  }
  if (parts[0] === 'employees') {
    if (parts.length === 1) return { section: 'employees', employeeId: null, group: null };
    if (!UUID.test(parts[1] || '')) return null;
    if (parts.length === 2) return { section: 'employees', employeeId: parts[1].toLowerCase(), group: null };
    const group = DRIVE_EMPLOYEE_GROUPS.find((entry) => entry.key === parts[2])?.key;
    if (parts.length === 3 && group) return { section: 'employees', employeeId: parts[1].toLowerCase(), group };
    return null;
  }
  if (parts[0] === 'brand' && parts.length === 2 && UUID.test(parts[1])) return { section: 'brand', companyId: parts[1].toLowerCase() };
  return null;
}

/** Folder dokumentów pracownika (`employees:<pracownik>:documents`) — jedyny folder działu Pracownicy, do którego dodaje się pliki. */
export const driveEmployeeDocumentsNode = (employeeId: string) => `employees:${employeeId.toLowerCase()}:documents`;

/** Identyfikator pliku Dysku: `<typ>:<uuid>`, np. `offer:…`, `equipment-file:…`. */
export function parseDriveFileId(value: unknown): { type: DriveFileType; id: string } | null {
  const match = /^(offer|calculation|contract|equipment-image|equipment-file|equipment-manual|brand-logo|brand-font|company-logo|employee-avatar|employee-background|employee-document|employee-contract):([0-9a-f-]{36})$/i
    .exec(String(value ?? ''));
  if (!match || !UUID.test(match[2])) return null;
  return { type: match[1].toLowerCase() as DriveFileType, id: match[2].toLowerCase() };
}

/** Nazwa pliku i folderu w Dysku i w Finderze: bez „/ \ : * ? " < > |” i znaków sterujących, jedna spacja, do 180 znaków. */
export function driveName(value: unknown, fallback: string): string {
  const name = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 180)
    .trim();
  return name || fallback;
}

function extensionOf(name: string) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match && match.index > 0 ? match[0] : '';
}

/** Rodzeństwo o tej samej nazwie (wielkość liter bez znaczenia) dostaje „ (2)”, „ (3)”… przed rozszerzeniem — jak w Finderze. */
export function driveUniqueNames<T extends { name: string }>(items: T[]): T[] {
  const used = new Set<string>();
  return items.map((item) => {
    let name = item.name;
    const ext = extensionOf(name);
    const base = ext ? name.slice(0, -ext.length) : name;
    for (let n = 2; used.has(name.toLocaleLowerCase('pl-PL')); n += 1) name = `${base} (${n})${ext}`;
    used.add(name.toLocaleLowerCase('pl-PL'));
    return name === item.name ? item : { ...item, name };
  });
}

/** Adres rekordu w CRM (przycisk „Otwórz w CRM”). */
export function driveRecordPath(record: DriveFile['record']): string | null {
  if (!record) return null;
  switch (record.type) {
    case 'offer': return `/crm/offers/${record.id}`;
    case 'event': return `/crm/events/${record.id}`;
    case 'inquiry': return `/crm/inquiries/${record.id}`;
    case 'contract': return `/crm/contracts/${record.id}`;
    case 'equipment': return `/crm/equipment/${record.id}`;
    case 'company': return `/crm/settings/my-companies/${record.id}/brandbook`;
    case 'employee': return `/crm/employees/${record.id}`;
    default: return null;
  }
}

/** Etykieta przycisku otwarcia rekordu. */
export const DRIVE_RECORD_LABELS: Record<DriveRecordType, string> = {
  offer: 'Otwórz ofertę',
  event: 'Otwórz wydarzenie',
  inquiry: 'Otwórz zapytanie',
  contract: 'Otwórz umowę',
  equipment: 'Otwórz sprzęt',
  company: 'Otwórz księgę znaku',
  employee: 'Otwórz profil pracownika',
};
