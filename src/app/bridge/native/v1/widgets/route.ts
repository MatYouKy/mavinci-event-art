import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';
import { calendarWidget, meetingsWidget } from '@/lib/native/widgets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/*
 * Widżety „Kalendarz” i „Spotkania” (Mac — pulpit i Centrum powiadomień; iPhone i iPad — ekran główny i ekran blokady):
 * GET op=calendar — plan pracownika na 7 dni (`get_employee_schedule`), op=meetings — jego spotkania na 14 dni.
 * Tokenem pracownika (RLS jak w CRM); szczegóły: `src/lib/native/widgets.ts`. Widżet zadań: `/bridge/native/v1/tasks?op=widget`.
 */

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const op = new URL(request.url).searchParams.get('op') || '';
  try {
    switch (op) {
      case 'calendar':
        return nativeJson(await calendarWidget(ctx));
      case 'meetings':
        return nativeJson(await meetingsWidget(ctx));
      default:
        return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    console.error('[native widgets]', op, error);
    return nativeJson({ error: 'Nie udało się pobrać danych widżetu.' }, 500);
  }
}
