import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { eventsAccess, eventsItems, eventsMeta, eventsState, invalidateEvents } from '@/lib/native/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Wydarzenia dla aplikacji na Maca — lista jak `/crm/events` (`fetchEventsPageSnapshot`), zmiana statusu jak „Zmień status”
 * (`events.status`) i usuwanie jak `deleteEventSafely` (funkcja `delete-event-safe`). Tokenem pracownika — RLS jak w przeglądarce.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const STATUSES = ['inquiry', 'offer_to_send', 'offer_sent', 'offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'cancelled', 'invoiced', 'settled'];
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const access = eventsAccess(ctx);
  if (!access.canView) return failure('Nie masz dostępu do wydarzeń.', 403);
  const url = new URL(request.url);
  try {
    if (url.searchParams.get('op') === 'state') {
      const [state, meta] = await Promise.all([eventsState(ctx, url.searchParams.get('hash') || undefined), eventsMeta(ctx)]);
      return nativeJson({ ...state, access, ...meta });
    }
    return failure('Nieznana operacja.');
  } catch (error) {
    console.error('[native-events]', error);
    return failure(errorText(error, 'Nie udało się pobrać wydarzeń.'), 500);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const access = eventsAccess(ctx);
  if (!access.canView) return failure('Nie masz dostępu do wydarzeń.', 403);
  let body: Record<string, any>;
  try {
    body = await readJson(request, 64_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  try {
    switch (op) {
      case 'items':
        return nativeJson(await eventsItems(ctx, Array.isArray(body.buckets) ? body.buckets : []));

      case 'status': {
        if (!uuid.test(id)) return failure('Nieprawidłowe wydarzenie.');
        const status = String(body.status || '');
        if (!STATUSES.includes(status)) return failure('Nieznany status.');
        const { data, error } = await ctx.supabase.from('events').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select('id');
        if (error) return failure(error.message || 'Błąd podczas zmiany statusu');
        if (!data?.length) return failure('Nie masz uprawnień do zmiany statusu tego wydarzenia.', 403);
        invalidateEvents();
        return nativeJson({ ok: true });
      }

      case 'delete': {
        if (!uuid.test(id)) return failure('Nieprawidłowe wydarzenie.');
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-event-safe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: request.headers.get('authorization') || '' },
          body: JSON.stringify({ eventId: id }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) return failure(result?.error || 'Nie udało się usunąć wydarzenia.');
        invalidateEvents();
        return nativeJson({ ok: true });
      }

      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-events]', op, error);
    return failure(errorText(error, 'Serwer nie wykonał operacji.'), 500);
  }
}
