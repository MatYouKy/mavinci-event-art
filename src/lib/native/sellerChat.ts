import 'server-only';
import type { NativeContext } from './auth';
import { commissionPaymentLabels, type CommissionPaymentMethod } from '@/lib/CRM/events/eventCommission';

/*
 * Karta sprzedawcy na Macu — „Rozmowy ze sprzedawcą” (`SellerChatPanel` w trybie CRM) i „Historia zmian” (`SellerAuditHistory`).
 * Te same funkcje bazy co CRM i portal: `list_seller_conversations`, `get_crm_seller_workspace` (marki i oferty do nowych
 * rozmów), `open_seller_conversation`, `get_seller_messages`, `send_seller_message`, `mark_seller_conversation_read`,
 * `get_seller_audit`. Dostęp do sprzedawcy, rozmowy i marki rozstrzyga baza (token pracownika).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const MISSING = ['PGRST202', '42883'];

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const idOf = (value: unknown, message = 'Nieprawidłowy sprzedawca.') => {
  const id = str(value);
  if (!UUID.test(id)) fail(message);
  return id;
};

function threadOut(thread: Row) {
  return {
    id: str(thread.id), companyId: str(thread.my_company_id), brandName: str(thread.brand_name), offerId: str(thread.offer_id) || null,
    title: str(thread.title), offerTitle: str(thread.offer_title) || null, hasEvent: thread.has_event === true,
    eventId: str(thread.event_id) || null, eventName: str(thread.event_name) || null, canViewEvent: thread.can_view_event === true,
    lastMessage: str(thread.last_message) || null, lastAt: str(thread.last_at) || null, unread: Number(thread.unread || 0), canSend: thread.can_send === true,
  };
}

/** Rozmowy sprzedawcy oraz marki i oferty, w których opiekun może rozpocząć nową rozmowę. */
export async function sellerConversations(ctx: NativeContext, partnerParam: unknown) {
  const partnerId = idOf(partnerParam);
  const [threads, workspace] = await Promise.all([
    ctx.supabase.rpc('list_seller_conversations', { p_partner: partnerId }),
    ctx.supabase.rpc('get_crm_seller_workspace', { p_partner: partnerId }),
  ]);
  if (threads.error) fail('Nie udało się wczytać rozmów sprzedawcy.', threads.error.code === '42501' ? 403 : 500);
  const data = (workspace.error ? {} : workspace.data || {}) as Row;
  return {
    threads: rows(threads.data).map(threadOut),
    brands: rows(data.brands).map((brand) => ({ id: str(brand.id), name: str(brand.name), canChat: brand.can_chat !== false })),
    offers: rows(data.offers).map((offer) => ({
      id: str(offer.id), companyId: str(offer.my_company_id), title: str(offer.title) || null, number: str(offer.offer_number) || null,
    })),
  };
}

/** „Otwórz rozmowę ogólną” / „Otwórz ustalenia oferty” — istniejący wątek albo nowy (identyfikator z bazy). */
export async function openSellerConversation(ctx: NativeContext, body: Row) {
  const partnerId = idOf(body.id);
  const companyId = idOf(body.companyId, 'Wybierz markę.');
  const offerId = body.offerId ? idOf(body.offerId, 'Wybierz ofertę.') : null;
  const { data, error } = await ctx.supabase.rpc('open_seller_conversation', { p_partner: partnerId, p_company: companyId, p_offer: offerId });
  if (error) fail(error.message || 'Nie udało się otworzyć rozmowy. Spróbuj ponownie.', error.code === '42501' ? 403 : 400);
  return { ok: true, conversationId: str(data) };
}

/** 50 ostatnich wiadomości (albo starszych niż `before`). */
export async function sellerChatMessages(ctx: NativeContext, conversationParam: unknown, beforeParam: unknown) {
  const id = idOf(conversationParam, 'Nieprawidłowa rozmowa.');
  const before = Number(beforeParam || 0);
  const { data, error } = await ctx.supabase.rpc('get_seller_messages', before > 0 ? { p_conversation: id, p_before: before } : { p_conversation: id });
  if (error) fail('Nie udało się wczytać rozmowy. Ponowimy za chwilę.', error.code === '42501' ? 403 : 500);
  return {
    messages: rows(data).map((message) => ({
      id: str(message.id), seq: Number(message.seq || 0), crm: message.sender_kind === 'crm', sender: str(message.sender_name),
      body: str(message.body), createdAt: str(message.created_at), own: message.own === true,
    })),
  };
}

/** Wysyłka z identyfikatorem wiadomości — ponowienie nie dubluje. */
export async function sendSellerChatMessage(ctx: NativeContext, body: Row) {
  const id = idOf(body.id, 'Nieprawidłowa rozmowa.');
  const text = str(body.body).trim().slice(0, 10000);
  const messageId = str(body.messageId);
  if (!text || !UUID.test(messageId)) fail('Wpisz treść wiadomości.');
  const { error } = await ctx.supabase.rpc('send_seller_message', { p_conversation: id, p_message_id: messageId, p_body: text });
  if (error) fail(error.message || 'Nie potwierdzono wysyłki. Możesz ponowić; wiadomość nie zostanie zdublowana.', error.code === '42501' ? 403 : 400);
  return { ok: true };
}

export async function readSellerChat(ctx: NativeContext, body: Row) {
  const id = idOf(body.id, 'Nieprawidłowa rozmowa.');
  const { error } = await ctx.supabase.rpc('mark_seller_conversation_read', { p_conversation: id, p_through: Number(body.through || 0) });
  if (error) fail('Nie udało się oznaczyć wiadomości jako przeczytanych.');
  return { ok: true };
}

// --- Historia zmian (`SellerAuditHistory`) ---------------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  profile_created: 'Utworzono profil sprzedawcy',
  profile_updated: 'Zmieniono profil sprzedawcy',
  manager_changed: 'Zmiana opiekuna',
  terms_created: 'Dodano warunki marki',
  terms_updated: 'Zmieniono warunki marki',
  terms_deleted: 'Usunięto warunki marki',
  visibility_changed: 'Zmiana widoczności wynagrodzenia',
  portal_account_linked: 'Połączono konto portalu',
  portal_account_unlinked: 'Odłączono konto portalu',
};
/** `SELLER_PROFILE_STATUS_LABELS` (komponent kliencki CRM — te same etykiety). */
const STATUS_LABELS: Record<string, string> = { active: 'Aktywny', onboarding: 'Do uzgodnienia', inactive: 'Nieaktywny' };
const PARTNER_TYPE_LABELS: Record<string, string> = {
  internal_employee: 'Sprzedawca Mavinci',
  hotel_employee: 'Pracownik hotelu',
  agency_employee: 'Pracownik agencji',
  independent_referrer: 'Niezależny polecający',
};
const yesNo = (value: unknown) => (value === true ? 'Tak' : value === false ? 'Nie' : '—');
const percent = (value: unknown) => (value == null || value === '' ? '—' : `${Number(value).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : value == null || value === '' ? '—' : String(value));
const FIELDS: { key: string; label: string; format: (value: unknown) => string }[] = [
  { key: 'status', label: 'Status', format: (value) => STATUS_LABELS[String(value)] || '—' },
  { key: 'partner_type', label: 'Rodzaj współpracy', format: (value) => PARTNER_TYPE_LABELS[String(value)] || '—' },
  { key: 'organization_name', label: 'Organizacja', format: text },
  { key: 'portal_enabled', label: 'Dostęp do portalu', format: yesNo },
  { key: 'manager_name', label: 'Opiekun', format: text },
  { key: 'backup_manager_name', label: 'Zastępca', format: text },
  { key: 'is_active', label: 'Marka aktywna', format: yesNo },
  { key: 'commission_enabled', label: 'Rozliczenie prowizyjne', format: yesNo },
  { key: 'default_commission_rate', label: 'Stawka prowizji', format: percent },
  { key: 'default_payment_method', label: 'Sposób wypłaty', format: (value) => commissionPaymentLabels[value as CommissionPaymentMethod] || '—' },
  { key: 'dividend_tax_rate', label: 'Podatek', format: percent },
  { key: 'commissions_visible', label: 'Wynagrodzenie widoczne w portalu', format: yesNo },
  { key: 'notes', label: 'Notatka', format: text },
];

function describeChanges(row: Row) {
  const before: Row = row.before && typeof row.before === 'object' ? row.before : {};
  const after: Row = row.after && typeof row.after === 'object' ? row.after : {};
  const changes: { label: string; from: string | null; to: string }[] = FIELDS
    .filter((field) => field.key in before || field.key in after)
    .filter((field) => JSON.stringify(before[field.key] ?? null) !== JSON.stringify(after[field.key] ?? null))
    .map((field) => ({ label: field.label, from: field.key in before ? field.format(before[field.key]) : null, to: field.format(after[field.key]) }));
  if (row.action === 'manager_changed' && !changes.some((change) => change.label === 'Opiekun')
    && JSON.stringify(before.manager_id ?? null) !== JSON.stringify(after.manager_id ?? null)) {
    changes.unshift({ label: 'Opiekun', from: null, to: after.manager_id ? 'przypisano innego pracownika' : 'usunięto' });
  }
  if (row.action === 'manager_changed' && !changes.some((change) => change.label === 'Zastępca')
    && JSON.stringify(before.backup_manager_id ?? null) !== JSON.stringify(after.backup_manager_id ?? null)) {
    changes.push({ label: 'Zastępca', from: null, to: after.backup_manager_id ? 'przypisano innego pracownika' : 'usunięto' });
  }
  return changes;
}

/** Historia zmian sprzedawcy (`get_seller_audit`), po 50 wpisów — „Pokaż starsze wpisy” zwiększa limit jak w CRM. */
export async function sellerAudit(ctx: NativeContext, partnerParam: unknown, limitParam: unknown) {
  const partnerId = idOf(partnerParam);
  const limit = Math.min(1000, Math.max(50, Math.trunc(Number(limitParam) || 50)));
  const { data, error } = await ctx.supabase.rpc('get_seller_audit', { p_partner: partnerId, p_limit: limit });
  if (error) {
    fail(MISSING.includes(error.code || '') ? 'Historia zmian wymaga migracji 20261105150000_seller_manager_cockpit.sql.'
      : error.message || 'Nie udało się wczytać historii zmian.', error.code === '42501' ? 403 : 500);
  }
  const list = rows(data);
  return {
    entries: list.map((row) => ({
      id: str(row.id), action: str(row.action), title: ACTION_LABELS[str(row.action)] || 'Zmiana ustawień sprzedawcy',
      brandName: str(row.brand_name) || null, actor: str(row.actor_name) || 'System', createdAt: str(row.created_at),
      changes: describeChanges(row), reason: str(row.reason) || null,
    })),
    limit,
    hasMore: list.length >= limit,
  };
}
