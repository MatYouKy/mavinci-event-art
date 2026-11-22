/*
 * Dysk — wspólne stałe, typy i funkcje CRM (web), serwera Next i telefonu (kopia 1:1 w `mobile/src/lib/driveShared.ts`,
 * para w `scripts/ci/check-shared-copies.mjs`); Mac — odpowiednik w Swift (`Drive/DriveModels.swift`). Bez importów.
 *
 * Dysk to ta sama chmura, co w Finderze (Mavinci → …): Finanse (firma → Księgowość → rok → miesiąc → Sprzedaż, Koszty, Bank,
 * Podatki i ZUS, XML z KSeF, w miesiącu — lista zamknięcia miesiąca; Dokumenty spółki; Umowy stałe; Majątek; Do wyjaśnienia — tylko
 * osoby z dostępem do finansów firmy), Eventy (pliki eventów),
 * Materiały (baza plików marki), Oferty, Kalkulacje i Umowy (PDF-y z CRM: rok → miesiąc), Magazyn (kategoria → sprzęt → zdjęcia,
 * pliki, instrukcja), Pracownicy (pracownik → Zdjęcia, Dokumenty, Umowy). Oferty, Kalkulacje i Umowy oraz Sprzedaż, Bank,
 * Podatki i XML w Księgowości są tylko do odczytu (dokumenty powstają w CRM); pliki można dodawać do sprzętu w Magazynie, do
 * dokumentów pracownika oraz w Finansach do Kosztów miesiąca (dokument spoza KSeF), Dokumentów spółki i Umów stałych („Finanse —
 * zarządzanie”). Aplikacja na telefonie i tablecie nie przegląda Finansów — skanuje dokumenty do wybranego folderu. Programy —
 * instalatory aplikacji Mavinci (zawsze najnowsza wersja z `yarn dmg`) dla każdego pracownika; na telefonie i tablecie ukryte.
 */

export const DRIVE_TITLE = 'Dysk';

export type DriveSection = 'finance' | 'events' | 'materials' | 'offers' | 'calculations' | 'contracts' | 'warehouse' | 'employees' | 'programs';
export type DriveDocumentSection = 'offers' | 'calculations' | 'contracts';

/** Działy w kolejności jak w Finderze. */
export const DRIVE_SECTIONS: ReadonlyArray<{ key: DriveSection; label: string; description: string }> = [
  {
    key: 'finance', label: 'Finanse',
    description: 'Księgowość firm (rok → miesiąc → sprzedaż, koszty, bank, podatki i ZUS, XML z KSeF), dokumenty spółki i umowy stałe. Widzą osoby z dostępem do finansów firmy.',
  },
  { key: 'events', label: 'Eventy', description: 'Pliki eventów: rok → event → foldery z zakładki Pliki.' },
  { key: 'materials', label: 'Materiały', description: 'Logotypy i księga znaku, zdjęcia, wideo, prezentacje i dokumenty marki.' },
  { key: 'offers', label: 'Oferty', description: 'PDF-y wystawionych ofert: rok → miesiąc.' },
  { key: 'calculations', label: 'Kalkulacje', description: 'PDF-y kalkulacji eventów i zapytań: rok → miesiąc.' },
  { key: 'contracts', label: 'Umowy', description: 'PDF-y umów: rok → miesiąc.' },
  { key: 'warehouse', label: 'Magazyn', description: 'Sprzęt: zdjęcia, pliki i instrukcje — kategoria → sprzęt.' },
  { key: 'employees', label: 'Pracownicy', description: 'Zdjęcia, dokumenty i umowy pracowników — pracownik → Zdjęcia, Dokumenty, Umowy.' },
  { key: 'programs', label: 'Programy', description: 'Instalatory aplikacji Mavinci — zawsze najnowsza wersja (aplikacja na Maca).' },
];

export const DRIVE_DOCUMENT_SECTIONS: readonly DriveDocumentSection[] = ['offers', 'calculations', 'contracts'];

/** Folder firmy w Finansach: „Księgowość” (rok → miesiąc → teczka miesiąca). */
export const DRIVE_FINANCE_BOOKS = 'Księgowość';

/**
 * Teczka miesiąca w Księgowości — te same dokumenty co przekazanie księgowej (Finanse → „Dla księgowej”): sprzedaż i koszty
 * według daty wystawienia (dokumenty spoza KSeF — daty dokumentu), wyciągi według miesiąca wyciągu, deklaracje według okresu.
 * `level` — najniższy poziom dostępu do finansów firmy, który widzi folder (jak RLS: faktury albo podgląd finansów).
 */
export type DriveFinanceGroup = 'sales' | 'costs' | 'bank' | 'taxes' | 'ksef';
export const DRIVE_FINANCE_GROUPS: ReadonlyArray<{ key: DriveFinanceGroup; label: string; description: string; level: 'invoices' | 'finance_view' }> = [
  { key: 'sales', label: 'Sprzedaż', description: 'Faktury wystawione: VAT, zaliczkowe, końcowe i korekty (CRM i KSeF).', level: 'invoices' },
  { key: 'costs', label: 'Koszty', description: 'Faktury kosztowe z KSeF i dokumenty spoza KSeF (zagraniczne, paragony, polisy) — tu dodaje się skany i pliki.', level: 'invoices' },
  { key: 'bank', label: 'Bank', description: 'Wyciągi ze wszystkich rachunków firmy.', level: 'finance_view' },
  { key: 'taxes', label: 'Podatki i ZUS', description: 'Pliki deklaracji VAT, ZUS, PIT i CIT za ten okres.', level: 'finance_view' },
  { key: 'ksef', label: 'XML z KSeF', description: 'Oryginały faktur z KSeF (sprzedaż i koszty) — dokumentem jest faktura w KSeF.', level: 'invoices' },
];

/**
 * Dokumenty spółki — folder firmy w Finansach obok Księgowości (od „Finanse — podgląd”, dodawanie i usuwanie — „Finanse —
 * zarządzanie”). Klucz kategorii jak `company_documents.category` w bazie.
 */
export const DRIVE_FINANCE_CORPORATE = 'Dokumenty spółki';
export type DriveCorporateCategory = 'founding' | 'resolutions' | 'statements' | 'registrations' | 'powers' | 'other';
export const DRIVE_CORPORATE_CATEGORIES: ReadonlyArray<{ key: DriveCorporateCategory; label: string; description: string }> = [
  { key: 'founding', label: 'Umowa spółki i KRS', description: 'Umowa spółki, akt założycielski, odpisy i zmiany w KRS, wpis do CRBR.' },
  { key: 'resolutions', label: 'Uchwały i protokoły', description: 'Uchwały wspólników i zarządu, protokoły zgromadzeń.' },
  { key: 'statements', label: 'Sprawozdania finansowe', description: 'Roczne sprawozdania finansowe, ich zatwierdzenie i złożenie.' },
  { key: 'registrations', label: 'Rejestracje i zaświadczenia', description: 'NIP, REGON, VAT-R, zaświadczenia z urzędu skarbowego i ZUS.' },
  { key: 'powers', label: 'Pełnomocnictwa', description: 'Pełnomocnictwa i upoważnienia (UPL-1, PPS-1, bank, urzędy).' },
  { key: 'other', label: 'Inne', description: 'Pozostałe dokumenty spółki.' },
];
export const driveCorporateCategory = (value: unknown): DriveCorporateCategory =>
  (DRIVE_CORPORATE_CATEGORIES.find((entry) => entry.key === value)?.key || 'other');

/** Umowy stałe — folder firmy w Finansach (umowa → pliki); umowy zakłada się w Centrum finansów, pliki można dodawać też tu. */
export const DRIVE_FINANCE_AGREEMENTS = 'Umowy stałe';

/**
 * Majątek — folder firmy w Finansach (od „Finanse — podgląd”): rejestr majątku (PDF i CSV dla księgowej) ze sprzętu w Magazynie
 * przypisanego do firmy (sprzęt → „Zakup” → własność i dokument zakupu).
 */
export const DRIVE_FINANCE_ASSETS = 'Majątek';
export const driveAssetsNodeId = (companyId: string) => `finance:${companyId.toLowerCase()}:assets`;

/**
 * Do wyjaśnienia — folder firmy w Finansach (od „Finanse — podgląd”): raport otwartych spraw (niezamknięte miesiące, dokumenty
 * do uzupełnienia, płatności czekające na dokument, faktury z KSeF bez XML, sprzęt bez dokumentu albo bez ustalonej własności).
 * W każdym miesiącu Księgowości — „Zamknięcie miesiąca” (lista kontrolna przed przekazaniem i zamknięciem miesiąca).
 */
export const DRIVE_FINANCE_CLARIFY = 'Do wyjaśnienia';
export const driveClarifyNodeId = (companyId: string) => `finance:${companyId.toLowerCase()}:clarify`;
/** Plik „Zamknięcie miesiąca” w folderze miesiąca: `month-close:<firma>:RRRR-MM`. */
export const driveMonthCloseFileId = (companyId: string, year: number, month: number) =>
  `month-close:${companyId.toLowerCase()}:${year}-${String(month).padStart(2, '0')}`;

/** Folder Dokumentów spółki firmy albo jego kategoria. */
export const driveCorporateNodeId = (companyId: string, category?: DriveCorporateCategory) =>
  `finance:${companyId.toLowerCase()}:corporate${category ? `:${category}` : ''}`;
/** Folder Umów stałych firmy albo folder jednej umowy. */
export const driveAgreementsNodeId = (companyId: string, contractId?: string) =>
  `finance:${companyId.toLowerCase()}:contracts${contractId ? `:${contractId.toLowerCase()}` : ''}`;

/** Identyfikator folderu Finansów: firma, Księgowość, rok, miesiąc albo teczka miesiąca. */
export function driveFinanceNodeId(companyId: string, place: { books?: boolean; year?: number; month?: number; group?: DriveFinanceGroup } = {}) {
  const company = `finance:${companyId.toLowerCase()}`;
  if (!place.books && place.year === undefined) return company;
  if (place.year === undefined) return `${company}:books`;
  if (place.month === undefined) return `${company}:books:${place.year}`;
  const month = `${company}:books:${place.year}-${String(place.month).padStart(2, '0')}`;
  return place.group ? `${month}:${place.group}` : month;
}

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

/**
 * `company` — firma w Finansach, `books` — Księgowość, `ledger` — teczka miesiąca (Sprzedaż, Koszty, Bank, Podatki i ZUS, XML
 * z KSeF), `corporate` — Dokumenty spółki, `docgroup` — ich kategoria, `agreements` — Umowy stałe, `agreement` — jedna umowa,
 * `assets` — Majątek (rejestr majątku), `clarify` — Do wyjaśnienia.
 */
export type DriveFolderKind =
  | 'section' | 'year' | 'month' | 'category' | 'equipment' | 'brand' | 'employee' | 'group' | 'company' | 'books' | 'ledger'
  | 'corporate' | 'docgroup' | 'agreements' | 'agreement' | 'assets' | 'clarify';

export type DriveFolder = {
  id: string;
  parentId: string | null;
  name: string;
  kind: DriveFolderKind;
  /** Liczba plików (rok, miesiąc) albo pozycji (kategoria) — dla podpowiedzi; `null` — nie liczono. */
  count: number | null;
  /** Synchronizacja Findera: do folderu można dodawać pliki (Koszty miesiąca, Dokumenty spółki, Umowy stałe — „Finanse — zarządzanie”). */
  upload?: boolean;
};

export type DriveFileType =
  | 'offer' | 'calculation' | 'contract' | 'equipment-image' | 'equipment-file' | 'equipment-manual' | 'brand-logo' | 'brand-font' | 'company-logo'
  | 'employee-avatar' | 'employee-background' | 'employee-document' | 'employee-contract'
  | 'sales-invoice' | 'ksef-invoice' | 'ksef-xml' | 'cost-document' | 'bank-statement' | 'tax-document' | 'company-document' | 'agreement-file'
  | 'asset-register' | 'asset-register-csv' | 'month-close' | 'clarify-report' | 'program';

export type DriveRecordType =
  | 'offer' | 'event' | 'inquiry' | 'contract' | 'equipment' | 'company' | 'employee' | 'invoice' | 'ksef-invoice' | 'external-invoice' | 'finance';

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
  /** Plik można usunąć z Dysku (dokument spółki, plik umowy stałej — „Finanse — zarządzanie”). */
  canDelete?: boolean;
};

export type DriveBrandColor = { label: string; hex: string; role: string };

export type DriveListing = {
  node: DriveFolder;
  path: DriveFolder[];
  folders: DriveFolder[];
  files: DriveFile[];
  /**
   * Czy do tego folderu można dodawać pliki: sprzęt w Magazynie (prawo „Zarządzanie magazynem”), dokumenty pracownika
   * (własne albo z prawem „Pracownicy — zarządzanie”), Koszty miesiąca, Dokumenty spółki i umowa stała („Finanse — zarządzanie” w firmie).
   */
  canUpload: boolean;
  /** Kolory z księgi znaku (folder marki). */
  colors: DriveBrandColor[];
};

/** `canUpload` — dodawanie plików w dziale (Magazyn: „Zarządzanie magazynem”; Pracownicy: dokumenty wszystkich pracowników). */
export type DriveSectionInfo = { key: DriveSection; label: string; description: string; available: boolean; canUpload: boolean };
/** `storage` — pracownik widzi „Miejsce na Dysku” (administrator; starszy serwer pola nie wysyła). */
export type DriveRoot = { title: string; sections: DriveSectionInfo[]; storage?: boolean };
/**
 * Księga znaku marki w Finderze: folder „Z księgi znaku” w folderze „Logotypy i księga znaku” Materiałów (`materialFolderId`),
 * z logotypami i fontami (pliki z `parentId` = `brand:<firma>`) i plikiem „Kolory marki.txt” z kolorów.
 */
export type DriveBrandNode = { companyId: string; companyName: string; materialFolderId: string; colors: DriveBrandColor[] };
export type DriveSync = { cursor: string; sections: DriveSectionInfo[]; folders: DriveFolder[]; files: DriveFile[]; brands: DriveBrandNode[] };
export type DriveDownload = { url: string; name: string; mime: string; size: number | null };
export type DriveUpload = { bucket: string; path: string; signedUrl: string; token: string; target: 'image' | 'file' };
/** Wynik dodania pliku; `notice` — informacja dla osoby, która dodała (np. odczytane dane dokumentu, inna teczka miesiąca). */
export type DriveUploadResult = { file: DriveFile; notice?: string };

/**
 * Skaner w aplikacji (Dysk → „Skanuj dokument”): zdjęcia stron (JPG/PNG) → PDF na serwerze → wybrany folder Finansów (Koszty
 * miesiąca, kategoria Dokumentów spółki, umowa stała). `pages` — ile stron naraz, `page` — największe zdjęcie strony.
 */
export const DRIVE_SCAN_LIMITS = { pages: 20, page: 15 * 1024 * 1024 } as const;
/** Podpisane adresy wysyłki stron skanu (kolejność = kolejność stron w PDF). */
export type DriveScanUpload = { scanId: string; pages: Array<{ path: string; signedUrl: string; token: string }> };

export type DriveNode =
  | { section: DriveDocumentSection; year: number | null; month: number | null }
  | { section: 'warehouse'; categoryId: string | null; equipmentId: string | null; uncategorized: boolean }
  | { section: 'employees'; employeeId: string | null; group: DriveEmployeeGroup | null }
  | { section: 'brand'; companyId: string }
  | { section: 'programs' }
  | {
    section: 'finance'; companyId: string | null; area: 'books' | 'corporate' | 'agreements' | 'assets' | 'clarify' | null; books: boolean; year: number | null;
    month: number | null;
    group: DriveFinanceGroup | null; category: DriveCorporateCategory | null; contractId: string | null;
  };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identyfikator folderu Dysku: `offers` | `offers:2026` | `offers:2026-11` (tak samo `calculations`, `contracts`),
 * `warehouse` | `warehouse:none` | `warehouse:cat:<id>` | `warehouse:item:<id>`, `employees` | `employees:<pracownik>` |
 * `employees:<pracownik>:photos|documents|contracts`, `brand:<firma>`, `finance` | `finance:<firma>` | `finance:<firma>:books` |
 * `finance:<firma>:books:2026` | `finance:<firma>:books:2026-11` | `finance:<firma>:books:2026-11:sales|costs|bank|taxes|ksef`,
 * `finance:<firma>:corporate` | `finance:<firma>:corporate:<kategoria>`, `finance:<firma>:contracts` | `finance:<firma>:contracts:<umowa>`,
 * `finance:<firma>:assets`, `finance:<firma>:clarify`, `programs`.
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
  if (parts[0] === 'programs') return parts.length === 1 ? { section: 'programs' } : null;
  if (parts[0] === 'finance') {
    const base = {
      section: 'finance' as const, companyId: null, area: null, books: false, year: null, month: null, group: null, category: null, contractId: null,
    };
    if (parts.length === 1) return base;
    if (!UUID.test(parts[1] || '')) return null;
    const companyId = parts[1].toLowerCase();
    if (parts.length === 2) return { ...base, companyId };
    if (parts[2] === 'corporate') {
      if (parts.length === 3) return { ...base, companyId, area: 'corporate' };
      const category = DRIVE_CORPORATE_CATEGORIES.find((entry) => entry.key === parts[3])?.key;
      return parts.length === 4 && category ? { ...base, companyId, area: 'corporate', category } : null;
    }
    if (parts[2] === 'assets') return parts.length === 3 ? { ...base, companyId, area: 'assets' } : null;
    if (parts[2] === 'clarify') return parts.length === 3 ? { ...base, companyId, area: 'clarify' } : null;
    if (parts[2] === 'contracts') {
      if (parts.length === 3) return { ...base, companyId, area: 'agreements' };
      return parts.length === 4 && UUID.test(parts[3]) ? { ...base, companyId, area: 'agreements', contractId: parts[3].toLowerCase() } : null;
    }
    if (parts[2] !== 'books') return null;
    if (parts.length === 3) return { ...base, companyId, area: 'books', books: true };
    const match = /^(\d{4})(?:-(\d{2}))?$/.exec(parts[3] || '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    if (year < 2000 || year > 2100 || (month !== null && (month < 1 || month > 12))) return null;
    if (parts.length === 4) return { ...base, companyId, area: 'books', books: true, year, month };
    const group = DRIVE_FINANCE_GROUPS.find((entry) => entry.key === parts[4])?.key;
    if (parts.length === 5 && month !== null && group) return { ...base, companyId, area: 'books', books: true, year, month, group };
    return null;
  }
  return null;
}

/** Folder dokumentów pracownika (`employees:<pracownik>:documents`) — jedyny folder działu Pracownicy, do którego dodaje się pliki. */
export const driveEmployeeDocumentsNode = (employeeId: string) => `employees:${employeeId.toLowerCase()}:documents`;

/** Instalator aplikacji Mavinci w Programach: `program:<platforma>` (na razie `mac`). */
export const DRIVE_PROGRAM_PLATFORMS = ['mac'] as const;
export type DriveProgramPlatform = typeof DRIVE_PROGRAM_PLATFORMS[number];

/** Identyfikator pliku Dysku: `<typ>:<uuid>`, np. `offer:…`, `equipment-file:…`; instalator — `program:mac`. */
export function parseDriveFileId(value: unknown): { type: DriveFileType; id: string } | null {
  const program = /^program:([a-z]+)$/.exec(String(value ?? ''));
  if (program) return (DRIVE_PROGRAM_PLATFORMS as readonly string[]).includes(program[1]) ? { type: 'program', id: program[1] } : null;
  // Zamknięcie miesiąca: `month-close:<firma>:RRRR-MM` — identyfikator `<firma>:RRRR-MM`.
  const close = /^month-close:([0-9a-f-]{36}):(\d{4})-(\d{2})$/i.exec(String(value ?? ''));
  if (close) {
    const month = Number(close[3]);
    return UUID.test(close[1]) && month >= 1 && month <= 12 ? { type: 'month-close', id: `${close[1].toLowerCase()}:${close[2]}-${close[3]}` } : null;
  }
  const match = /^(offer|calculation|contract|equipment-image|equipment-file|equipment-manual|brand-logo|brand-font|company-logo|employee-avatar|employee-background|employee-document|employee-contract|sales-invoice|ksef-invoice|ksef-xml|cost-document|bank-statement|tax-document|company-document|agreement-file|asset-register|asset-register-csv|clarify-report):([0-9a-f-]{36})$/i
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
    case 'invoice': return `/crm/invoices/${record.id}`;
    case 'ksef-invoice': return '/crm/invoices?tab=ksef';
    case 'external-invoice': return '/crm/invoices?tab=external';
    case 'finance': return '/crm/invoices?tab=center';
    default: return null;
  }
}

/** Etykieta przycisku otwarcia rekordu. */
export const DRIVE_RECORD_LABELS: Record<DriveRecordType, string> = {
  offer: 'Otwórz ofertę',
  event: 'Otwórz event',
  inquiry: 'Otwórz zapytanie',
  contract: 'Otwórz umowę',
  equipment: 'Otwórz sprzęt',
  company: 'Otwórz księgę znaku',
  employee: 'Otwórz profil pracownika',
  invoice: 'Otwórz fakturę',
  'ksef-invoice': 'Otwórz faktury z KSeF',
  'external-invoice': 'Otwórz dokumenty spoza KSeF',
  finance: 'Otwórz Centrum finansów',
};

// MARK: Miejsce na Dysku (tylko administrator) — pakiet i zajętość (`crm_storage_usage`, migracja 20261126120000)

export type DriveStorageGroupKey =
  | 'materials' | 'events' | 'offers' | 'brochures' | 'mail' | 'chat' | 'website' | 'warehouse' | 'finance' | 'fleet' | 'team' | 'other';

/** Rodzaje plików w zestawieniu zajętości (kolejność opisu — największe pierwsze liczy klient). */
export const DRIVE_STORAGE_GROUPS: Record<DriveStorageGroupKey, string> = {
  materials: 'Materiały i logotypy',
  events: 'Pliki eventów',
  offers: 'Oferty i sprzedaż',
  brochures: 'Broszury',
  mail: 'Załączniki e-mail',
  chat: 'Czat',
  website: 'Strona i social media',
  warehouse: 'Magazyn',
  finance: 'Finanse i dokumenty firmy',
  fleet: 'Flota',
  team: 'Pracownicy',
  other: 'Pozostałe',
};

const DRIVE_STORAGE_BUCKETS: Record<string, DriveStorageGroupKey> = {
  materials: 'materials', 'company-logos': 'materials',
  'event-files': 'events',
  'generated-offers': 'offers', 'offer-product-pages': 'offers', 'offer-template-pages': 'offers', 'seller-offer-documents': 'offers',
  'seller-demo-pdfs': 'offers', 'seller-brand-assets': 'offers', 'sales-showcase': 'offers', 'service-catalog-images': 'offers',
  'generated-brochures': 'brochures',
  'email-attachments': 'mail',
  'chat-attachments': 'chat',
  'site-images': 'website', 'mavinci-view': 'website', 'conferences-gallery': 'website', 'social-media': 'website',
  'equipment-images': 'warehouse', 'equipment-files': 'warehouse', 'rental-equipment-images': 'warehouse', 'connector-thumbnails': 'warehouse',
  'location-materials': 'warehouse',
  'external-invoices': 'finance', 'bank-statements': 'finance', 'bank-supporting-documents': 'finance', 'finance-documents': 'finance',
  'finance-declarations': 'finance', 'finance-contracts': 'finance', 'finance-scans': 'finance', 'company-documents': 'finance',
  'signed-contracts': 'finance',
  'vehicle-images': 'fleet', 'vehicle-documents': 'fleet', 'fuel-receipts': 'fleet',
  'employee-assets': 'team', 'employee-documents': 'team',
};

export type DriveStorageGroup = { key: DriveStorageGroupKey; label: string; bytes: number; objects: number };

export type DriveStorageUsage = {
  plan: { name: string; updatedAt: string | null };
  /** Pliki — magazyn (wszystkie buckety): zajęte i limit pakietu w bajtach. */
  files: { used: number; quota: number; objects: number };
  /** Baza danych: rozmiar i limit pakietu w bajtach. */
  database: { used: number; quota: number };
  /** Zajętość plików według rodzaju — największe pierwsze, bez pustych. */
  groups: DriveStorageGroup[];
  generatedAt: string | null;
};

/** Domyślny pakiet (Supabase Pro): 100 GB plików, 8 GB bazy. */
export const DRIVE_STORAGE_DEFAULT_PLAN = { name: 'Supabase Pro', filesGb: 100, databaseGb: 8 } as const;
export const DRIVE_GB = 1024 * 1024 * 1024;

const storageNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Odpowiedź `crm_storage_usage()` → zestawienie dla CRM, Maca i telefonu. */
export function driveStorageUsage(raw: unknown): DriveStorageUsage {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const plan = (row.plan && typeof row.plan === 'object' ? row.plan : {}) as Record<string, unknown>;
  const groups = new Map<DriveStorageGroupKey, DriveStorageGroup>();
  let used = 0;
  let objects = 0;
  for (const entry of Array.isArray(row.buckets) ? row.buckets : []) {
    const bucket = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const key = DRIVE_STORAGE_BUCKETS[String(bucket.bucket ?? '')] ?? 'other';
    const bytes = storageNumber(bucket.bytes);
    const count = storageNumber(bucket.objects);
    used += bytes;
    objects += count;
    const group = groups.get(key) ?? { key, label: DRIVE_STORAGE_GROUPS[key], bytes: 0, objects: 0 };
    group.bytes += bytes;
    group.objects += count;
    groups.set(key, group);
  }
  return {
    plan: {
      name: typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : DRIVE_STORAGE_DEFAULT_PLAN.name,
      updatedAt: typeof plan.updatedAt === 'string' ? plan.updatedAt : null,
    },
    files: { used, quota: storageNumber(plan.filesQuotaBytes) || DRIVE_STORAGE_DEFAULT_PLAN.filesGb * DRIVE_GB, objects },
    database: { used: storageNumber(row.databaseBytes), quota: storageNumber(plan.databaseQuotaBytes) || DRIVE_STORAGE_DEFAULT_PLAN.databaseGb * DRIVE_GB },
    groups: Array.from(groups.values()).filter((group) => group.bytes > 0).sort((a, b) => b.bytes - a.bytes),
    generatedAt: typeof row.generatedAt === 'string' ? row.generatedAt : null,
  };
}

/** Stan zajętości: do 80% — w porządku, od 80% — ostrzeżenie, od 95% — krytycznie. */
export function driveStorageLevel(used: number, quota: number): 'ok' | 'warning' | 'critical' {
  const share = quota > 0 ? used / quota : 0;
  return share >= 0.95 ? 'critical' : share >= 0.8 ? 'warning' : 'ok';
}

/** Rozmiar po polsku z jednym miejscem po przecinku: „4,7 GB”, „824 MB”, „95,3 GB”. */
export function formatDriveBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 || unit === 0 ? 0 : 1;
  return `${size.toFixed(digits).replace('.', ',').replace(/,0$/, '')} ${units[unit]}`;
}

/** Procent zajętości po polsku („4,7%”, „<0,1%”). */
export function formatDriveShare(used: number, quota: number): string {
  if (!(quota > 0)) return '—';
  const share = (used / quota) * 100;
  if (share > 0 && share < 0.1) return '<0,1%';
  return `${share.toFixed(share >= 10 ? 0 : 1).replace('.', ',').replace(/,0$/, '')}%`;
}
