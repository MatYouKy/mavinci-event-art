/*
 * Natywny protokół Mavinci (aplikacja na Maca, w przyszłości telefon) — karty, listy i formularze czynności składane przez serwer.
 * Wzór: aplikacja Wodami (piastpol, `src/lib/native-docs.ts`) — ten sam kształt danych, więc ta sama warstwa rysująca w aplikacji.
 *
 * Serwer składa gotowe KARTY (DocRecord): pola listy, sekcje szczegółów i czynności dostępne dla pracownika na obecnym etapie.
 * Aplikacja tylko rysuje — reguły, uprawnienia, etykiety i walidacja należą do serwera (te same funkcje co CRM w przeglądarce).
 * Każde zapytanie wykonuje się tokenem zalogowanego pracownika (RLS Supabase), bez klucza serwisowego.
 *
 * Synchronizacja: `POST /bridge/native/v1/sync` {sets:{nazwa:{hash}}, only?} → skróty zbiorów i koszyków,
 * `POST /bridge/native/v1/sync/items` {set, buckets} → treść zmienionych koszyków (`sync.ts`).
 * Czynności: `POST /bridge/native/v1/docs/action` {action, id, revision, key, data} → {ok, id?, message?, record?:{tab,id}}
 * albo 409 {error, fieldErrors:{'pole':'…'}} (klucze jak ścieżki pól, wiersze: `nazwa.indeks.pole`).
 *
 * Pola formularza (DocField.type): text | textarea | date (RRRR-MM-DD) | select | multiselect | toggle | number | money (grosze) | lines.
 * visibleIf {field,in?,notIn?} — pole widoczne tylko przy pasującej wartości innego pola (ukrytych nie wysyłamy).
 * Kwoty zawsze w groszach (`amountGrosz`), tekst kwoty gotowy (`amountText`).
 * Odnośnik `record` {tab,id}: karta innego zbioru; `tab:'event'` — natywna strona wydarzenia w aplikacji (EventPageView).
 */

export type DocIcon = 'edit' | 'settings' | 'add' | 'delete' | 'archive' | 'send' | 'print' | 'download' | 'upload' | 'confirm' | 'cancel' | 'refresh' | 'link' | 'open' | 'user' | 'image';
export type DocTone = 'new' | 'progress' | 'wait' | 'warn' | 'done' | 'closed';
export type DocTagTone = 'danger' | 'warn' | 'info';

export type DocFileFormat = 'pdf' | 'xml' | 'file' | 'csv';
/** Plik do podglądu w aplikacji (`GET /bridge/native/v1/docs/file?kind=…&id=…&format=…`, uprawnienia w `files.ts`). */
export type DocFile = { kind: string; id: string; format: DocFileFormat; version?: number; name?: string };

export type DocLink = {
  type: 'record' | 'url' | 'open' | 'file' | 'tel' | 'mail' | 'map' | 'panel' | 'contact' | 'location';
  id?: string; href?: string; kind?: string; tab?: string; file?: DocFile; action?: string; filter?: string;
};
export type DocRow = { label: string; value: string; link?: DocLink };
export type DocPreview = { file: DocFile; caption: string; tone?: 'info' | 'warn' | 'done' };
export type DocSection = {
  id?: string; span?: 1 | 2 | 3; title: string; rows?: DocRow[];
  table?: { columns: string[]; rows: string[][]; links?: (DocLink | null)[] };
  text?: string; tone?: 'info' | 'warn'; preview?: DocPreview;
};

export type DocOption = { id: string; name: string; parent?: string; group?: string; help?: string };
export type DocFieldType = 'text' | 'textarea' | 'password' | 'number' | 'money' | 'date' | 'select' | 'multiselect' | 'toggle' | 'lines' | 'file';
export type DocField = {
  name: string; label: string; type: DocFieldType; value?: unknown; options?: DocOption[]; required?: boolean;
  min?: number; max?: number; help?: string; dependsOn?: string;
  visibleIf?: { field: string; in?: string[]; notIn?: string[] };
  fields?: DocField[]; add?: 'blank' | 'copy'; template?: Record<string, unknown>; addLabel?: string;
  group?: string; columns?: string[]; itemLabel?: string; editor?: 'list' | 'table';
};
export type DocLayoutGroup = { id: string; title: string; span?: 1 | 2 | 3; help?: string };
export type DocAction = {
  id: string; label: string; role?: 'primary' | 'destructive'; icon?: DocIcon; submitLabel?: string; section?: string;
  presentation?: 'sheet' | 'page'; layout?: DocLayoutGroup[]; confirm?: string; note?: string; fields?: DocField[];
  open?: string; copy?: string; panel?: string; url?: string; file?: DocFile; data?: Record<string, unknown>;
};

export type DocFilterTag = { id: string; label: string; tone?: DocTagTone };
export type DocAlert = { text: string; tone: DocTagTone; filter?: string; query?: string };

export type DocRecord = {
  id: string; kind: string; number: string; title: string; subtitle: string; counterpartyId: string; locationId: string;
  status: string; statusLabel: string; tone: DocTone; open: boolean; shop: boolean;
  date: string; dateText: string; createdAt: string; amountGrosz: number | null; amountText: string; channelLabel: string;
  search: string; revision: number; updatedAt: string; panelHref: string;
  sections: DocSection[]; actions: DocAction[]; filters?: DocFilterTag[];
};

export type DocBoardColumn = { id: string; label: string; tone?: DocTone; closed?: boolean; hint?: string };
export type DocBoard = { columns: DocBoardColumn[]; moveAction: string; amountLabel?: string; defaultView?: 'board' | 'list' };
/** Opis podstrony: 6 nagłówków listy (numer, tytuł, opis, data, status, kwota), podpowiedź i czynności tworzenia. */
export type DocSectionMeta = {
  id: string; title: string; href: string; param: string;
  headers: [string, string, string, string, string, string];
  openLabel: string; hint: string; icon: string; create: DocAction[];
  single?: boolean; group?: string; alerts?: DocAlert[]; board?: DocBoard;
};

const pln = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Kwota w złotych (numeric z bazy) → grosze. */
export const grosz = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const zl = (groszValue: number | null | undefined) => (groszValue === null || groszValue === undefined ? '' : `${pln.format(groszValue / 100)} zł`);
export const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** Data RRRR-MM-DD… → DD.MM.RRRR (strefa Warszawy dla znaczników czasu). */
export const day = (v: unknown) => {
  const s = str(v);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' });
};
export const dateTime = (v: unknown) => {
  const d = new Date(str(v));
  if (!str(v) || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
/** Wiersze sekcji bez pustych wartości. */
export const rows = (entries: [string, unknown, DocLink?][]): DocRow[] =>
  entries.filter(([, v]) => str(v) !== '').map(([label, value, link]) => ({ label, value: str(value), ...(link ? { link } : {}) }));
export const recordLink = (tab: string, id: string): DocLink => ({ type: 'record', tab, id });
/** Natywna strona wydarzenia w aplikacji (EventPageView); `kind` — zakładka strony. */
export const eventLink = (id: string, tab?: string): DocLink => ({ type: 'record', tab: 'event', id, ...(tab ? { kind: tab } : {}) });
export const fileLink = (file: DocFile): DocLink => ({ type: 'file', file });
export const fileAction = (label: string, file: DocFile, icon?: DocIcon): DocAction => ({ id: 'file', label, file, icon: icon || (file.format === 'pdf' ? 'print' : 'download') });
/** Szukanie po polsku: bez wielkości liter i ogonków („ł” jak „l”) — tak samo w aplikacji (`SearchText.fold`). */
export const searchText = (parts: unknown[]) =>
  parts.map(str).join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'l').toLowerCase().replace(/\s+/g, ' ').trim();
/** Rewizja karty z `updated_at` (aplikacja wysyła ją z czynnością; serwer sprawdza, czy nikt nie zmienił rekordu w międzyczasie). */
export const revisionOf = (updatedAt: unknown) => {
  const t = Date.parse(str(updatedAt));
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
};

/** Szerokość sekcji na szerokiej karcie (siatka 3 kolumn) — jak w Wodami: tabela 3, pozostałe 1, niepełny wiersz poszerza największą sekcję. */
export function fitSpans<T extends { span?: 1 | 2 | 3; rows?: readonly unknown[]; table?: { rows: readonly unknown[] }; text?: string }>(sections: readonly T[]): T[] {
  const out = sections.map((s) => ({ ...s, span: s.span ?? (s.table ? 3 : 1) }));
  const weight = (s: T) => (s.rows?.length || 0) + (s.table ? s.table.rows.length + 2 : 0) + (s.text?.length || 0) / 120;
  let row: number[] = [];
  let used = 0;
  const close = () => {
    for (let gap = 3 - used; gap > 0; gap--) {
      const pick = row.filter((i) => sections[i].span === undefined && out[i].span < 3).sort((a, b) => weight(sections[b]) - weight(sections[a]) || a - b)[0];
      if (pick === undefined) break;
      out[pick].span = (out[pick].span + 1) as 1 | 2 | 3;
    }
    row = [];
    used = 0;
  };
  out.forEach((s, i) => {
    if (used + s.span > 3) close();
    row.push(i);
    used += s.span;
    if (used >= 3) close();
  });
  if (row.length) close();
  return out;
}
