import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { parseEventSettlement } from '@/lib/events/settlement/eventSettlement';

/**
 * Zakładka „Podsumowanie” (`EventSettlementTab`): stan z `get_event_settlement` i zapisy przez te same funkcje bazy co CRM —
 * każda zwraca pełne podsumowanie, które aplikacja podmienia bez ponownego odczytu. Kwot nie liczymy tutaj (liczy baza).
 */

const MIGRATION_NOTICE = 'Podsumowanie wydarzenia wymaga aktualizacji bazy danych.';
const MISSING = new Set(['PGRST202', '42883']);
type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** `settlementErrorMessage`. */
function message(error: DbError, fallback = 'Nie udało się zapisać zmian. Odśwież podsumowanie.') {
  if (!error) return fallback;
  if (MISSING.has(error.code ?? '')) return MIGRATION_NOTICE;
  const text = typeof error.message === 'string' ? error.message.trim() : '';
  if (error.code === '42501') return text || 'Brak uprawnień do tej operacji.';
  return text || fallback;
}

async function summaryTab(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('get_event_settlement', { p_event_id: eventId });
  if (error) {
    if (MISSING.has(error.code ?? '')) return { state: 'missing', message: MIGRATION_NOTICE, settlement: null };
    if (error.code === '42501') return { state: 'forbidden', message: message(error), settlement: null };
    return { state: 'error', message: message(error, 'Nie udało się wczytać podsumowania wydarzenia.'), settlement: null };
  }
  const settlement = parseEventSettlement(data);
  if (!settlement) return { state: 'error', message: 'Baza zwróciła nieczytelne podsumowanie. Odśwież stronę.', settlement: null };
  return { state: 'ready', message: null, settlement };
}

registerEventTab('summary', summaryTab);

/** Funkcje zapisu podsumowania (jak `mutate` w `useEventSettlement`) — wszystkie zwracają pełne podsumowanie. */
const WRITES = new Set([
  'submit_event_settlement', 'approve_event_settlement', 'return_event_settlement', 'reopen_event_settlement',
  'save_event_settlement_line', 'delete_event_settlement_line', 'link_event_cost_invoice', 'add_event_settlement_seller',
  'remove_event_settlement_seller', 'set_event_settlement_seller_rate', 'set_event_sales_shares',
]);

async function write(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const rpc = String(body.rpc || '');
  if (!WRITES.has(rpc)) throw new Error('Niedozwolona operacja.');
  const params: Record<string, unknown> = body.params && typeof body.params === 'object' ? { ...body.params } : {};
  if (rpc === 'delete_event_settlement_line') {
    // Pozycja musi należeć do tego wydarzenia (funkcja bazy przyjmuje tylko identyfikator pozycji).
    const lineId = String(params.p_line_id || '');
    const current = await summaryTab(ctx, eventId);
    const owned = current.settlement?.lines.some((line) => line.line_id === lineId);
    if (!owned) throw new Error('Nie znaleziono pozycji w podsumowaniu tego wydarzenia.');
    for (const key of Object.keys(params)) if (key !== 'p_line_id') delete params[key];
  } else {
    params.p_event_id = eventId;
  }
  const { data, error } = await ctx.supabase.rpc(rpc, params);
  if (error) throw new Error(message(error));
  const settlement = parseEventSettlement(data);
  return settlement ? { state: 'ready', message: null, settlement } : await summaryTab(ctx, eventId);
}

registerEventActions('summary', { write });

const toNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** „Dodaj sprzedawcę”: `list_event_seller_candidates` (podpowiedzi albo wyszukiwanie). */
async function sellers(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const search = (params.get('search') || '').trim();
  const { data, error } = await ctx.supabase.rpc('list_event_seller_candidates', { p_event_id: eventId, p_search: search || null });
  if (error) return { error: message(error, 'Nie udało się wczytać sprzedawców.'), candidates: [] };
  return {
    error: null,
    candidates: (Array.isArray(data) ? data : []).filter((row: any) => row && row.partner_id).map((row: any) => ({
      partnerId: String(row.partner_id), name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Sprzedawca',
      organization: typeof row.organization === 'string' && row.organization.trim() ? row.organization : null, rate: toNumber(row.rate),
      paymentMethod: typeof row.payment_method === 'string' ? row.payment_method : null, ready: row.ready === true,
      suggestion: typeof row.suggestion === 'string' ? row.suggestion : null, inEvent: row.in_event === true,
    })),
  };
}

/** „Dodaj fakturę kosztową”: `list_event_cost_invoice_candidates` (42501 → komunikat i ukrycie przycisku). */
async function invoices(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const search = (params.get('search') || '').trim();
  const { data, error } = await ctx.supabase.rpc('list_event_cost_invoice_candidates', { p_event_id: eventId, p_search: search || null, p_limit: 30 });
  if (error) {
    if (error.code === '42501') {
      return { forbidden: error.message?.trim() || 'Faktury kosztowe przypisuje osoba z dostępem do finansów tego wydarzenia.', error: null, candidates: [] };
    }
    return { forbidden: null, error: message(error, 'Nie udało się wczytać faktur kosztowych.'), candidates: [] };
  }
  return {
    forbidden: null, error: null,
    candidates: (Array.isArray(data) ? data : []).filter((row: any) => row && row.id).map((row: any) => ({
      source: row.source === 'ksef' ? 'ksef' : 'external', id: String(row.id), number: typeof row.number === 'string' ? row.number : null,
      sellerName: typeof row.seller_name === 'string' ? row.seller_name : null, sellerNip: typeof row.seller_nip === 'string' ? row.seller_nip : null,
      issueDate: typeof row.issue_date === 'string' ? row.issue_date : null, net: toNumber(row.net), gross: toNumber(row.gross),
      firstItem: typeof row.first_item === 'string' ? row.first_item : null, allocated: toNumber(row.allocated) ?? 0,
      remainingGross: toNumber(row.remaining_gross) ?? 0, linkedToEvent: row.linked_to_event === true,
    })),
  };
}

/** „Sprzedawca wydarzenia”: aktywni pracownicy (jak `SalesSharesEditor`). */
async function employees(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('employees').select('id,name,surname').eq('is_active', true).order('surname').limit(500);
  if (error) return { error: 'Nie udało się wczytać listy pracowników.', employees: [] };
  return { error: null, employees: (data || []).map((row: any) => ({ id: String(row.id), name: [row.name, row.surname].filter(Boolean).join(' ') || 'Pracownik' })) };
}

registerEventQueries('summary', { sellers, invoices, employees: (ctx) => employees(ctx) });
