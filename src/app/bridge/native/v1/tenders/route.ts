import { can, nativeContext, nativeJson, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { isUuid, requireSessionEmployee } from '@/lib/auth/requireEmployee.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import {
  createTenderConfig, deleteTenderConfig, saveTenderConfig, tenderConfigState, type TenderConfigAccess, type TenderConfigResult,
} from '@/lib/tenders/tenderFilterConfig.server';
import { recalculateTenderRelevance } from '@/lib/tenders/tenderRelevance.server';
import { tenderRecalculationMessage } from '@/lib/tenders/tenderFilterConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Konfiguracja filtrów przetargów — jedno API dla CRM (`/crm/tenders/config`, `x-mavinci-client: web`), Maca
 * (`TenderFilterConfigView`) i telefonu (`TenderFilterConfigSheet`); token sesji pracownika, RLS `tender_filter_config`.
 * GET op=config → { configs, canEdit, canRecalculate } (pracownik z dostępem do przetargów).
 * POST op=configSave { id, config: {name, positive_keywords, negative_keywords, cpv_codes, locations, min_relevance_score,
 * notification_score_threshold, max_days_to_deadline, is_active}, updatedAt } | configCreate | configDelete { id } —
 * administrator; odpowiedź: stan jak w GET + selectedId + message.
 * POST op=recalculate → { checked, updated, message } — przeliczenie ocen wszystkich przetargów według aktywnej
 * konfiguracji (administrator; klucz serwisowy dopiero po `requireSessionEmployee`).
 */

const access = (ctx: NativeContext): TenderConfigAccess => ({
  canView: ctx.employee.isAdmin || can(ctx.employee, 'tenders_view'),
  isAdmin: ctx.employee.isAdmin,
});

const answer = (result: TenderConfigResult) => (result.ok
  ? nativeJson({ ...result.state, selectedId: result.selectedId, message: result.message ?? null })
  : nativeJson({ error: result.error }, result.status));

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const rights = access(ctx);
  if (!rights.canView) return nativeJson({ error: 'Nie masz dostępu do przetargów.' }, 403);
  const op = new URL(request.url).searchParams.get('op') || 'config';
  if (op !== 'config') return nativeJson({ error: 'Nieznana operacja.' }, 400);
  const state = await tenderConfigState(ctx.supabase, rights);
  if (!state) return nativeJson({ error: 'Nie udało się wczytać konfiguracji filtrów.' }, 500);
  return nativeJson(state);
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const rights = access(ctx);
  if (!rights.canView) return nativeJson({ error: 'Nie masz dostępu do przetargów.' }, 403);
  let body: Record<string, unknown>;
  try {
    const parsed = await readJson(request, 200_000);
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return nativeJson({ error: 'Nieprawidłowe dane formularza.' }, 400);
  }
  const op = String(body.op || '');

  if (op === 'configSave') {
    if (!isUuid(body.id)) return nativeJson({ error: 'Wybierz konfigurację.' }, 400);
    const config = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config as Record<string, unknown> : null;
    if (!config) return nativeJson({ error: 'Brak danych konfiguracji.' }, 400);
    const expected = typeof body.updatedAt === 'string' && body.updatedAt ? body.updatedAt : null;
    return answer(await saveTenderConfig(ctx.supabase, rights, body.id, config, expected));
  }
  if (op === 'configCreate') return answer(await createTenderConfig(ctx.supabase, rights));
  if (op === 'configDelete') {
    if (!isUuid(body.id)) return nativeJson({ error: 'Wybierz konfigurację.' }, 400);
    return answer(await deleteTenderConfig(ctx.supabase, rights, body.id));
  }
  if (op === 'recalculate') {
    // Przeliczenie nadpisuje ocenę wszystkich przetargów kluczem serwisowym — tylko administrator CRM.
    const session = await requireSessionEmployee(request);
    if (!session.ok) return session.response;
    if (!session.employee.isAdmin) return nativeJson({ error: 'Przeliczenie ocen uruchamia administrator.' }, 403);
    try {
      const result = await recalculateTenderRelevance(createSupabaseAdminClient());
      if (!result.ok) return nativeJson({ error: result.error }, result.status);
      return nativeJson({ checked: result.checked, updated: result.updated, message: tenderRecalculationMessage(result.checked, result.updated) });
    } catch (error) {
      console.error('[native-tenders] recalculate', error instanceof Error ? error.message : error);
      return nativeJson({ error: 'Nie udało się przeliczyć przetargów.' }, 500);
    }
  }
  return nativeJson({ error: 'Nieznana operacja.' }, 400);
}
