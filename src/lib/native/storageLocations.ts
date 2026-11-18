import 'server-only';
import type { NativeContext } from './auth';
import { can } from './auth';
import { invalidateWarehouse } from './warehouse';

/*
 * Lokalizacje magazynowe dla Maca — jak strona `/crm/equipment/locations`: lista (`storage_locations`, po nazwie), dodawanie,
 * edycja (nazwa, adres, link Google Maps, informacje o dostępie, notatki, aktywna) i usuwanie z uprawnieniem do zarządzania
 * magazynem (`canManageModule('equipment')`). Tokenem pracownika — zapis rozstrzyga RLS (`can_write_equipment_catalog`).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PERMISSION = 'Nie masz uprawnień do zarządzania lokalizacjami magazynowymi.';

export class StorageLocationsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new StorageLocationsError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const idOf = (value: unknown) => {
  const id = str(value);
  if (!UUID.test(id)) fail('Nieprawidłowa lokalizacja.');
  return id;
};

export const storageLocationsAccess = (ctx: NativeContext) => ({
  canView: can(ctx.employee, 'equipment_view') || can(ctx.employee, 'equipment_manage'),
  canManage: can(ctx.employee, 'equipment_manage'),
});

function locationOut(row: Row) {
  return {
    id: str(row.id),
    name: str(row.name),
    address: str(row.address),
    accessInfo: str(row.access_info),
    googleMapsUrl: str(row.google_maps_url),
    notes: str(row.notes),
    isActive: row.is_active !== false,
  };
}

/** Lista lokalizacji (`fetchLocations`) i prawo zarządzania. */
export async function storageLocationsList(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('storage_locations').select('*').order('name');
  if (error) fail(error.message || 'Błąd pobierania lokalizacji', 500);
  return { locations: rows(data).map(locationOut), canManage: storageLocationsAccess(ctx).canManage };
}

/** „Zapisz” w oknie lokalizacji (`handleSubmit`): puste pola — brak wartości. */
export async function saveStorageLocation(ctx: NativeContext, body: Row) {
  if (!storageLocationsAccess(ctx).canManage) fail(NO_PERMISSION, 403);
  const id = body.id ? idOf(body.id) : null;
  const form = body.form && typeof body.form === 'object' ? body.form as Row : {};
  const name = str(form.name);
  if (!name.trim()) fail('Nazwa lokalizacji jest wymagana');
  const payload = {
    name,
    address: str(form.address) || null,
    access_info: str(form.accessInfo) || null,
    google_maps_url: str(form.googleMapsUrl) || null,
    notes: str(form.notes) || null,
    is_active: form.isActive === true,
  };
  if (id) {
    const { data, error } = await ctx.supabase.from('storage_locations')
      .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) fail(error.code === '42501' ? NO_PERMISSION : error.message || 'Błąd zapisywania lokalizacji', error.code === '42501' ? 403 : 400);
    if (!rows(data).length) fail(NO_PERMISSION, 403);
  } else {
    const { error } = await ctx.supabase.from('storage_locations').insert([payload]);
    if (error) fail(error.code === '42501' ? NO_PERMISSION : error.message || 'Błąd zapisywania lokalizacji', error.code === '42501' ? 403 : 400);
  }
  // Nazwy lokalizacji są w kartach sprzętu i słowniku jednostek — kopie magazynu na Macu odświeżą się.
  invalidateWarehouse();
  return { ok: true, message: id ? 'Lokalizacja zaktualizowana' : 'Lokalizacja dodana' };
}

/** Usunięcie lokalizacji; z przypisanymi jednostkami sprzętu baza go nie pozwala (klucz obcy). */
export async function deleteStorageLocation(ctx: NativeContext, body: Row) {
  if (!storageLocationsAccess(ctx).canManage) fail(NO_PERMISSION, 403);
  const id = idOf(body.id);
  const { data, error } = await ctx.supabase.from('storage_locations').delete().eq('id', id).select('id');
  if (error) {
    if (error.code === '23503') fail('Nie można usunąć lokalizacji, do której są przypisane jednostki sprzętu. Najpierw przenieś je do innej lokalizacji.');
    fail(error.code === '42501' ? NO_PERMISSION : error.message || 'Błąd usuwania lokalizacji', error.code === '42501' ? 403 : 400);
  }
  if (!rows(data).length) fail(NO_PERMISSION, 403);
  invalidateWarehouse();
  return { ok: true, message: 'Lokalizacja usunięta' };
}
