import 'server-only';
import type { NativeContext } from './auth';
import { can } from './auth';
import { invalidateEvents } from './events';

/*
 * Kategorie wydarzeń i ikony dla Maca — jak strona `/crm/event-categories` (`useEventCategories`): lista kategorii z ikoną,
 * kategoria (nazwa, ikona, kolor, opis, domyślny szablon oferty, szablon umowy, aktywna), biblioteka ikon SVG (`custom_icons`).
 * Strona CRM wymaga `event_categories_manage` (PermissionGuard) — tak samo tutaj. Tokenem pracownika: zapis rozstrzyga RLS,
 * a brak zmienionego wiersza to brak uprawnień.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const ICON_SELECT = '*, icon:custom_icons(id, name, svg_code, preview_color)';
const NO_PERMISSION = 'Brak uprawnień: event_categories_manage. Skontaktuj się z administratorem.';

export class EventCategoriesError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new EventCategoriesError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const idOf = (value: unknown) => {
  const id = str(value);
  if (!UUID.test(id)) fail('Nieprawidłowy rekord.');
  return id;
};
/** Wybór z listy: pusty — brak (jak `|| null` w CRM), inaczej identyfikator. */
const optionalId = (value: unknown) => {
  const id = str(value);
  if (!id) return null;
  if (!UUID.test(id)) fail('Nieprawidłowy wybór.');
  return id;
};
/** Komunikat jak w CRM (`Błąd: …`), z polskim opisem typowych odmów bazy. */
function dbFail(error: { message?: string; code?: string }, fallback: string): never {
  if (error.code === '42501') fail(NO_PERMISSION, 403);
  if (error.code === '23505') fail('Kategoria o tej nazwie już istnieje.');
  if (error.code === '23514') fail('Kolor musi mieć postać #RRGGBB, np. #3B82F6.');
  if (error.code === '23503') fail(fallback);
  fail(`Błąd: ${error.message || 'Nieznany błąd'}${error.code ? ` (kod: ${error.code})` : ''}`);
}

export const canManageEventCategories = (ctx: NativeContext) => can(ctx.employee, 'event_categories_manage');
function requireManage(ctx: NativeContext) {
  if (!canManageEventCategories(ctx)) fail(NO_PERMISSION, 403);
}

function iconOut(icon: Row | null | undefined) {
  if (!icon) return null;
  return { id: str(icon.id), name: str(icon.name), svgCode: str(icon.svg_code), previewColor: str(icon.preview_color) || '#3B82F6' };
}

function categoryOut(row: Row) {
  const icon = Array.isArray(row.icon) ? row.icon[0] : row.icon;
  return {
    id: str(row.id),
    name: str(row.name),
    color: str(row.color) || '#3B82F6',
    description: str(row.description),
    isActive: row.is_active !== false,
    iconId: str(row.icon_id) || null,
    icon: iconOut(icon),
    contractTemplateId: str(row.contract_template_id) || null,
    offerTemplateCategoryId: str(row.default_offer_template_category_id) || null,
  };
}

/** Kategorie, ikony i listy wyboru (szablony umów — aktywne; kategorie szablonów ofert — domyślna pierwsza), jak `refetchAll`. */
export async function eventCategoriesData(ctx: NativeContext) {
  requireManage(ctx);
  const s = ctx.supabase;
  const [categories, icons, contracts, offers] = await Promise.all([
    s.from('event_categories').select(ICON_SELECT).order('name'),
    s.from('custom_icons').select('*').order('name'),
    s.from('contract_templates').select('id, name').eq('is_active', true).order('name'),
    s.from('offer_template_categories').select('id, name, color').order('is_default', { ascending: false }).order('name'),
  ]);
  if (categories.error) fail('Nie udało się pobrać kategorii eventów.', 500);
  if (icons.error) fail('Nie udało się pobrać ikon.', 500);
  return {
    categories: rows(categories.data).map(categoryOut),
    icons: rows(icons.data).map((icon) => iconOut(icon)!),
    contractTemplates: rows(contracts.data).map((row) => ({ id: str(row.id), name: str(row.name) })),
    offerTemplateCategories: rows(offers.data).map((row) => ({ id: str(row.id), name: str(row.name), color: str(row.color) })),
  };
}

/** „Utwórz” / „Zapisz” kategorii (`upsertCategory`): te same pola co w CRM. */
export async function saveEventCategory(ctx: NativeContext, body: Row) {
  requireManage(ctx);
  const id = body.id ? idOf(body.id) : null;
  const form = body.form && typeof body.form === 'object' ? body.form as Row : {};
  const name = str(form.name);
  const color = str(form.color);
  if (!name.trim()) fail('Podaj nazwę kategorii.');
  if (!COLOR.test(color)) fail('Kolor musi mieć postać #RRGGBB, np. #3B82F6.');
  const payload = {
    name,
    color,
    description: str(form.description),
    is_active: form.isActive === true,
    icon_id: optionalId(form.iconId),
    contract_template_id: optionalId(form.contractTemplateId),
    default_offer_template_category_id: optionalId(form.offerTemplateCategoryId),
    updated_at: new Date().toISOString(),
  };
  if (id) {
    const { data, error } = await ctx.supabase.from('event_categories').update(payload).eq('id', id).select('id');
    if (error) dbFail(error, 'Wybrana ikona lub szablon nie istnieje.');
    if (!rows(data).length) fail(NO_PERMISSION, 403);
  } else {
    const { error } = await ctx.supabase.from('event_categories').insert([payload]);
    if (error) dbFail(error, 'Wybrana ikona lub szablon nie istnieje.');
  }
  invalidateEvents();
  return { ok: true, message: id ? 'Kategoria zaktualizowana!' : 'Kategoria utworzona!' };
}

/** Usunięcie kategorii — wydarzenia i produkty z tą kategorią zostają bez kategorii (`ON DELETE SET NULL`), jak w CRM. */
export async function deleteEventCategory(ctx: NativeContext, body: Row) {
  requireManage(ctx);
  const id = idOf(body.id);
  const { data, error } = await ctx.supabase.from('event_categories').delete().eq('id', id).select('id');
  if (error) dbFail(error, 'Nie udało się usunąć kategorii.');
  if (!rows(data).length) fail(NO_PERMISSION, 403);
  invalidateEvents();
  return { ok: true, message: 'Kategoria została usunięta!' };
}

/** „Dodaj ikonę” / „Zaktualizuj” (`upsertIcon`): nazwa, kod SVG, kolor podglądu; nowa ikona z autorem (`created_by` → pracownik). */
export async function saveCustomIcon(ctx: NativeContext, body: Row) {
  requireManage(ctx);
  const id = body.id ? idOf(body.id) : null;
  const form = body.form && typeof body.form === 'object' ? body.form as Row : {};
  const name = str(form.name);
  const svgCode = str(form.svgCode);
  const previewColor = str(form.previewColor) || '#3B82F6';
  if (!name.trim()) fail('Podaj nazwę ikony.');
  if (!svgCode.trim()) fail('Wklej kod SVG ikony.');
  if (svgCode.length > 200_000) fail('Kod SVG jest za długi (maks. 200 000 znaków).');
  if (!COLOR.test(previewColor)) fail('Kolor podglądu musi mieć postać #RRGGBB, np. #3B82F6.');
  if (id) {
    const { data, error } = await ctx.supabase.from('custom_icons').update({
      name, svg_code: svgCode, preview_color: previewColor, updated_at: new Date().toISOString(),
    }).eq('id', id).select('id');
    if (error) dbFail(error, 'Nie udało się zapisać ikony.');
    if (!rows(data).length) fail(NO_PERMISSION, 403);
  } else {
    const { error } = await ctx.supabase.from('custom_icons').insert([{
      name, svg_code: svgCode, preview_color: previewColor, created_by: ctx.employee.id,
    }]);
    if (error) dbFail(error, 'Nie udało się zapisać ikony.');
  }
  invalidateEvents();
  return { ok: true, message: id ? 'Ikona została zaktualizowana!' : 'Ikona została dodana!' };
}

/** Usunięcie ikony — kategorie (i inne miejsca) z tą ikoną zostają bez ikony (`ON DELETE SET NULL`). */
export async function deleteCustomIcon(ctx: NativeContext, body: Row) {
  requireManage(ctx);
  const id = idOf(body.id);
  const { data, error } = await ctx.supabase.from('custom_icons').delete().eq('id', id).select('id');
  if (error) dbFail(error, 'Nie udało się usunąć ikony.');
  if (!rows(data).length) fail(NO_PERMISSION, 403);
  invalidateEvents();
  return { ok: true, message: 'Ikona została usunięta!' };
}
