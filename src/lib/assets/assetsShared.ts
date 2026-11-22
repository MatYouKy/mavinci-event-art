/*
 * Własność sprzętu i dokument zakupu — wspólne stałe i typy CRM (web) i serwera Next (`/bridge/native/v1/assets`,
 * `assets.server.ts`); Mac — odpowiednik w Swift (`Warehouse/EquipmentAssetsCard.swift`). Bez importów.
 *
 * Sprzęt w Magazynie dzieli się na partie sztuk (`equipment_acquisitions`): środek trwały firmy, wyposażenie firmy, leasing
 * lub najem (firma używa, nie jest właścicielem) albo prywatne (własność prywatna — można sprzedać bez faktury, za gotówkę).
 * Partia firmy wskazuje dokument zakupu: fakturę kosztową z KSeF, dokument spoza KSeF albo umowę stałą (leasing, najem).
 * Sztuki bez partii mają nieustaloną własność. Widzą osoby z dostępem do faktur firmy, zmienia „Finanse — zarządzanie”.
 */

export type AssetOwnership = 'asset' | 'equipment' | 'leased' | 'private';

export const ASSET_OWNERSHIPS: ReadonlyArray<{ key: AssetOwnership; label: string; plural: string; description: string }> = [
  {
    key: 'asset', label: 'Środek trwały firmy', plural: 'Środki trwałe',
    description: 'Majątek spółki w ewidencji środków trwałych (amortyzowany). Sprzedaż tylko na fakturę.',
  },
  {
    key: 'equipment', label: 'Wyposażenie firmy', plural: 'Wyposażenie',
    description: 'Kupione na firmę i ujęte od razu w kosztach. Sprzedaż tylko na fakturę.',
  },
  {
    key: 'leased', label: 'Leasing lub najem', plural: 'Leasing i najem',
    description: 'Firma używa na podstawie umowy — to nie jest jej własność, nie można tego sprzedać.',
  },
  {
    key: 'private', label: 'Prywatny', plural: 'Prywatne',
    description: 'Własność prywatna (bez faktury na firmę) — można sprzedać bez faktury, za gotówkę.',
  },
];

export const assetOwnershipLabel = (key: string) => ASSET_OWNERSHIPS.find((entry) => entry.key === key)?.label || 'Nieustalona własność';
export const isAssetOwnership = (value: unknown): value is AssetOwnership => ASSET_OWNERSHIPS.some((entry) => entry.key === value);

export const ASSET_LIMITS = { quantity: 100_000, documentNote: 300, notes: 2000 } as const;

/** Dokument zakupu: faktura kosztowa z KSeF, dokument spoza KSeF albo umowa stała (leasing, najem). */
export type AssetDocumentType = 'ksef' | 'external' | 'contract';
export type AssetDocument = {
  type: AssetDocumentType;
  id: string;
  /** Numer dokumentu albo tytuł umowy. */
  label: string;
  /** Kontrahent, rodzaj, kwota. */
  detail: string;
  /** Sprzedawca albo kontrahent umowy. */
  counterparty: string;
  date: string | null;
  amount: number | null;
  currency: string;
};

export const ASSET_DOCUMENT_LABELS: Record<AssetDocumentType, string> = {
  ksef: 'Faktura z KSeF',
  external: 'Dokument spoza KSeF',
  contract: 'Umowa stała',
};

/** Partia sztuk sprzętu. `canEdit` — „Finanse — zarządzanie” w firmie partii (prywatne — w dowolnej firmie). */
export type EquipmentAcquisition = {
  id: string;
  quantity: number;
  ownership: AssetOwnership;
  companyId: string | null;
  companyName: string;
  acquiredOn: string | null;
  netAmount: number | null;
  grossAmount: number | null;
  currency: string;
  document: AssetDocument | null;
  /** Gdzie jest dokument, gdy nie ma go w CRM (np. „faktura papierowa w segregatorze 2024”). */
  documentNote: string;
  notes: string;
  updatedAt: string | null;
  canEdit: boolean;
};

export type AssetCompany = { id: string; name: string; canEdit: boolean };

/**
 * Własność sprzętu: `quantity` — sztuki w Magazynie, `counts` — sztuki według własności (widoczne partie), `unassigned` —
 * sztuki bez partii (nieustalona własność), `undocumented` — sztuki firmy bez wskazanego dokumentu zakupu.
 */
export type EquipmentAssets = {
  equipmentId: string;
  quantity: number;
  acquisitions: EquipmentAcquisition[];
  counts: Record<AssetOwnership, number>;
  unassigned: number;
  undocumented: number;
  companies: AssetCompany[];
  /** Może dodawać partie prywatne (poziom „Finanse — zarządzanie” w którejkolwiek firmie). */
  canEditPrivate: boolean;
};

export type AssetDocumentList = { documents: AssetDocument[] };

/** Zapis partii (`id` — zmiana istniejącej). */
export type AssetAcquisitionInput = {
  id?: string;
  equipmentId: string;
  quantity: number;
  ownership: AssetOwnership;
  companyId: string | null;
  acquiredOn: string | null;
  netAmount: number | null;
  grossAmount: number | null;
  currency: string;
  document: { type: AssetDocumentType; id: string } | null;
  documentNote: string;
  notes: string;
};

/** Wiersz rejestru majątku firmy (Dysk → Finanse → firma → Majątek). */
export type AssetRegisterRow = {
  id: string;
  companyId: string;
  equipmentId: string;
  equipment: string;
  brand: string;
  model: string;
  quantity: number;
  ownership: AssetOwnership;
  acquiredOn: string | null;
  netAmount: number | null;
  grossAmount: number | null;
  currency: string;
  document: string;
  counterparty: string;
  documentDate: string | null;
  documentNote: string;
  notes: string;
  updatedAt: string | null;
};
