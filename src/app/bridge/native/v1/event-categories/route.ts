import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  canManageEventCategories, deleteCustomIcon, deleteEventCategory, eventCategoriesData, saveCustomIcon, saveEventCategory,
} from '@/lib/native/eventCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Kategorie wydarzeń dla aplikacji na Maca (`src/lib/native/eventCategories.ts`) — jak `/crm/event-categories`, z tym samym
 * wymaganym uprawnieniem `event_categories_manage`: GET op=list (kategorie, ikony, szablony umów, kategorie szablonów ofert);
 * POST op=save {id?, form} | delete {id} | iconSave {id?, form} | iconDelete {id}. Tokenem pracownika (RLS).
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => (error as { status?: number })?.status || 500;
const denied = () => failure('Nie masz uprawnień do kategorii wydarzeń. Wymagane uprawnienie: event_categories_manage.', 403);

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!canManageEventCategories(ctx)) return denied();
  const op = new URL(request.url).searchParams.get('op') || '';
  try {
    if (op === 'list') return nativeJson(await eventCategoriesData(ctx));
    return failure('Nieznana operacja.');
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-event-categories]', op, error);
    return failure(errorText(error, 'Nie udało się pobrać kategorii wydarzeń.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!canManageEventCategories(ctx)) return denied();
  let body: Record<string, unknown>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  try {
    switch (op) {
      case 'save': return nativeJson(await saveEventCategory(ctx, body));
      case 'delete': return nativeJson(await deleteEventCategory(ctx, body));
      case 'iconSave': return nativeJson(await saveCustomIcon(ctx, body));
      case 'iconDelete': return nativeJson(await deleteCustomIcon(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-event-categories]', op, error);
    return failure(errorText(error, 'Nie udało się zapisać kategorii.'), statusOf(error));
  }
}
