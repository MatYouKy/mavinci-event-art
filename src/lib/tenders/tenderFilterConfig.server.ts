import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  TENDER_FILTER_NEW_NAME, TENDER_FILTER_SELECT, tenderFilterConfigFromRow, tenderFilterInput, validateTenderFilterInput,
  type TenderConfigState,
} from './tenderFilterConfig';

/*
 * Konfiguracja filtrów przetargów dla CRM, Maca i telefonu (`/bridge/native/v1/tenders`). Klient z tokenem pracownika —
 * odczyt i zapis rozstrzyga RLS `tender_filter_config` (odczyt: tenders_view, zmiany: administrator); serwer dodatkowo
 * sprawdza uprawnienie i poprawność pól. Aktywna może być jedna konfiguracja (pobieranie przetargów i przeliczenie ocen
 * używają jednej): zapis aktywnej wyłącza pozostałe. Aktywnej konfiguracji nie można usunąć. Zapis z nieaktualnej wersji
 * (ktoś zmienił konfigurację w międzyczasie) jest odrzucany.
 */

export type TenderConfigAccess = { canView: boolean; isAdmin: boolean };
export type TenderConfigResult =
  | { ok: true; state: TenderConfigState; selectedId: string | null; message?: string }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): TenderConfigResult => ({ ok: false, status, error });

export async function tenderConfigState(client: SupabaseClient, access: TenderConfigAccess): Promise<TenderConfigState | null> {
  const { data, error } = await client
    .from('tender_filter_config')
    .select(TENDER_FILTER_SELECT)
    .order('created_at', { ascending: false });
  if (error) return null;
  return {
    configs: ((data || []) as Array<Record<string, unknown>>).map(tenderFilterConfigFromRow),
    canEdit: access.isAdmin,
    canRecalculate: access.isAdmin,
  };
}

async function reply(client: SupabaseClient, access: TenderConfigAccess, selectedId: string | null, message?: string): Promise<TenderConfigResult> {
  const state = await tenderConfigState(client, access);
  if (!state) return fail(500, 'Zapisano, ale nie udało się odświeżyć listy konfiguracji.');
  return { ok: true, state, selectedId, message };
}

export async function saveTenderConfig(
  client: SupabaseClient, access: TenderConfigAccess, id: string, source: Record<string, unknown>, expectedUpdatedAt: string | null,
): Promise<TenderConfigResult> {
  if (!access.isAdmin) return fail(403, 'Zmiany konfiguracji filtrów zapisuje administrator.');
  const input = tenderFilterInput(source);
  const problem = validateTenderFilterInput(input);
  if (problem) return fail(422, problem);

  const stamp = new Date().toISOString();
  let query = client.from('tender_filter_config').update({ ...input, updated_at: stamp }).eq('id', id);
  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
  const { data, error } = await query.select('id');
  if (error) return fail(400, 'Nie udało się zapisać konfiguracji.');
  if (!data?.length) {
    const { data: exists } = await client.from('tender_filter_config').select('id').eq('id', id).maybeSingle();
    return exists
      ? fail(409, 'Konfigurację zmieniono w międzyczasie. Wczytaj ją ponownie i wprowadź zmiany jeszcze raz.')
      : fail(404, 'Ta konfiguracja została usunięta.');
  }

  if (input.is_active) {
    const { error: others } = await client
      .from('tender_filter_config')
      .update({ is_active: false, updated_at: stamp })
      .eq('is_active', true)
      .neq('id', id);
    if (others) return reply(client, access, id, 'Konfiguracja zapisana, ale nie udało się wyłączyć pozostałych aktywnych konfiguracji.');
    return reply(client, access, id, 'Konfiguracja zapisana i aktywna. Kliknij „Przelicz przetargi”, aby zaktualizować oceny.');
  }
  return reply(client, access, id, 'Konfiguracja zapisana.');
}

export async function createTenderConfig(client: SupabaseClient, access: TenderConfigAccess): Promise<TenderConfigResult> {
  if (!access.isAdmin) return fail(403, 'Nowe konfiguracje filtrów dodaje administrator.');
  const { data, error } = await client
    .from('tender_filter_config')
    .insert({ name: TENDER_FILTER_NEW_NAME, is_active: false })
    .select('id')
    .single();
  if (error || !data) return fail(400, 'Nie udało się dodać konfiguracji.');
  return reply(client, access, String((data as { id: string }).id), 'Dodano nową konfigurację (nieaktywną).');
}

export async function deleteTenderConfig(client: SupabaseClient, access: TenderConfigAccess, id: string): Promise<TenderConfigResult> {
  if (!access.isAdmin) return fail(403, 'Konfiguracje filtrów usuwa administrator.');
  const { data: row, error: readError } = await client.from('tender_filter_config').select('id, is_active').eq('id', id).maybeSingle();
  if (readError) return fail(400, 'Nie udało się sprawdzić konfiguracji.');
  if (!row) return reply(client, access, null, 'Ta konfiguracja była już usunięta.');
  if ((row as { is_active: boolean | null }).is_active) {
    return fail(409, 'Nie można usunąć aktywnej konfiguracji — najpierw zapisz inną jako aktywną.');
  }
  const { data, error } = await client.from('tender_filter_config').delete().eq('id', id).select('id');
  if (error || !data?.length) return fail(400, 'Nie udało się usunąć konfiguracji.');
  return reply(client, access, null, 'Konfiguracja usunięta.');
}
