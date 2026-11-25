/*
 * Podpowiedzi adresatów w polach „Do”, „DW” i „UDW” (jak w Thunderbirdzie) — wspólne dla CRM i aplikacji mobilnej
 * (kopia: mobile/src/lib/recipientSuggestions.ts, pilnuje scripts/ci/check-shared-copies.mjs). Bez importów.
 * Dane: funkcja bazy `email_recipient_suggestions` (migracja 20261130140000_email_recipient_suggestions.sql) — kontakty,
 * organizacje, pracownicy i korespondencja z uprawnieniami osoby (RLS). Tu: fragment wpisywany przy kursorze, wstawienie
 * wybranego adresu, opis podpowiedzi.
 */

export type RecipientSuggestionKind = 'contact' | 'organization' | 'employee' | 'correspondence';

export type RecipientSuggestion = {
  email: string;
  name: string | null;
  kind: RecipientSuggestionKind;
  contactId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  employeeId: string | null;
  sentCount: number;
  receivedCount: number;
  lastAt: string | null;
};

export const RECIPIENT_KIND_LABELS: Record<RecipientSuggestionKind, string> = {
  contact: 'Kontakt',
  organization: 'Organizacja',
  employee: 'Pracownik',
  correspondence: 'Korespondencja',
};

/** Najwięcej podpowiedzi naraz i opóźnienie zapytania po ostatniej literze (ms). */
export const RECIPIENT_SUGGESTION_LIMIT = 8;
export const RECIPIENT_SUGGESTION_DELAY = 150;

const KINDS = Object.keys(RECIPIENT_KIND_LABELS) as RecipientSuggestionKind[];
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** Wiersz funkcji bazy (snake_case) albo odpowiedzi API (camelCase) → podpowiedź; `null` — bez adresu. */
export function recipientSuggestionFromRow(row: Record<string, unknown> | null | undefined): RecipientSuggestion | null {
  if (!row) return null;
  const email = text(row.email)?.toLowerCase() || '';
  if (!email || !email.includes('@')) return null;
  const kind = String(row.kind || '') as RecipientSuggestionKind;
  return {
    email,
    name: text(row.name),
    kind: KINDS.includes(kind) ? kind : 'correspondence',
    contactId: text(row.contact_id ?? row.contactId),
    organizationId: text(row.organization_id ?? row.organizationId),
    organizationName: text(row.organization_name ?? row.organizationName),
    employeeId: text(row.employee_id ?? row.employeeId),
    sentCount: count(row.sent_count ?? row.sentCount),
    receivedCount: count(row.received_count ?? row.receivedCount),
    lastAt: text(row.last_at ?? row.lastAt),
  };
}

const SEPARATORS = /[,;\n]/;

/** Wpisywany adres przy kursorze: tekst między przecinkiem / średnikiem przed kursorem a następnym. */
export function recipientToken(value: string, caret?: number | null): { query: string; start: number; end: number } {
  const position = Math.max(0, Math.min(value.length, caret ?? value.length));
  let start = position;
  while (start > 0 && !SEPARATORS.test(value[start - 1])) start -= 1;
  let end = position;
  while (end < value.length && !SEPARATORS.test(value[end])) end += 1;
  return { query: value.slice(start, end).trim(), start, end };
}

/** Czy szukać podpowiedzi dla fragmentu (co najmniej 1 znak, bez spacji na końcu adresu). */
export const recipientQueryReady = (query: string) => query.trim().length >= 1 && query.trim().length <= 100;

/** Adresy e-mail w polu (małe litery, bez powtórzeń). */
export function recipientAddresses(value: string): string[] {
  const found = String(value || '').toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) || [];
  return Array.from(new Set(found));
}

/**
 * Wstawia wybrany adres w miejsce wpisywanego fragmentu i dodaje „, ” na następny adres. Adres już wpisany w polu nie jest
 * dublowany (fragment znika). Zwraca nową wartość i pozycję kursora.
 */
export function insertRecipient(value: string, token: { start: number; end: number }, email: string): { value: string; caret: number } {
  const before = value.slice(0, token.start).replace(/\s+$/, '');
  const after = value.slice(token.end).replace(/^[\s,;]+/, '');
  const others = recipientAddresses(`${before} ${after}`);
  const address = email.trim().toLowerCase();
  const head = before ? `${before.replace(/[,;]$/, '')}, ` : '';
  const insert = others.includes(address) ? '' : `${address}, `;
  const next = `${head}${insert}${after}`;
  return { value: next, caret: head.length + insert.length };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Opis pod nazwą: organizacja, liczba wiadomości, ostatnia korespondencja („Omega Hotel · 3 wysłane, 5 odebranych · 03.11.2026”). */
export function recipientDetail(suggestion: RecipientSuggestion): string {
  const parts: string[] = [];
  if (suggestion.organizationName && suggestion.kind !== 'organization') parts.push(suggestion.organizationName);
  const mail: string[] = [];
  if (suggestion.sentCount) mail.push(`${suggestion.sentCount} ${plural(suggestion.sentCount, 'wysłana', 'wysłane', 'wysłanych')}`);
  if (suggestion.receivedCount) mail.push(`${suggestion.receivedCount} ${plural(suggestion.receivedCount, 'odebrana', 'odebrane', 'odebranych')}`);
  if (mail.length) parts.push(mail.join(', '));
  if (suggestion.lastAt) {
    const date = new Date(suggestion.lastAt);
    if (!Number.isNaN(date.getTime())) parts.push(`ostatnio ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`);
  }
  return parts.join(' · ');
}

function plural(value: number, one: string, few: string, many: string) {
  const n = Math.abs(Math.trunc(value));
  if (n === 1) return one;
  return n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
}
