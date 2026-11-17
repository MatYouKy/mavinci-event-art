import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  assignContract, deleteEntry, entryHistory, postDiscussion, resolveDiscussion, saveSettlement, settlementPreview, startTimer, stopTimer,
  timeContracts, timeDashboard, timeDiscussions, timeEarnings, timeEmployee, timeHome, updateEntry, voidSettlement,
} from '@/lib/native/timeTracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Czas pracy dla aplikacji na Maca (`src/lib/native/timeTracking.ts`): GET op=home | dashboard&from&to[&employee] |
 * employee&id&from&to | history&entry | discussions | settlement&employee&until | earnings&employee&month | contracts&employee;
 * POST op=start | stop {id} | update {id, updatedAt, …} | delete {id} | discussionPost {entryId, body} |
 * discussionResolve {entryId, resolved} | settlementSave {requestId, employeeId, until, hours, rate, previous, signature, notes, accept} |
 * settlementVoid {id, reason} | assignContract {entryId, contractId}. Tokenem pracownika — dostęp rozstrzyga baza.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => {
  const value = error as { status?: number; code?: string } | null;
  if (value?.status) return value.status;
  return value?.code === '42501' ? 403 : value?.code ? 400 : 500;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const q = (key: string) => url.searchParams.get(key) || '';
  try {
    switch (q('op')) {
      case 'home':
        return nativeJson(await timeHome(ctx));
      case 'dashboard': {
        const employee = q('employee');
        return nativeJson(await timeDashboard(ctx, q('from'), q('to'), uuid.test(employee) ? employee : null));
      }
      case 'employee':
        if (!uuid.test(q('id'))) return failure('Nieprawidłowy pracownik.');
        return nativeJson(await timeEmployee(ctx, q('id'), q('from'), q('to')));
      case 'history':
        if (!uuid.test(q('entry'))) return failure('Nieprawidłowy wpis.');
        return nativeJson(await entryHistory(ctx, q('entry')));
      case 'discussions':
        return nativeJson(await timeDiscussions(ctx));
      case 'settlement':
        if (!uuid.test(q('employee'))) return failure('Nieprawidłowy pracownik.');
        return nativeJson(await settlementPreview(ctx, q('employee'), q('until')));
      case 'earnings':
        if (!uuid.test(q('employee'))) return failure('Nieprawidłowy pracownik.');
        return nativeJson(await timeEarnings(ctx, q('employee'), q('month')));
      case 'contracts':
        if (!uuid.test(q('employee'))) return failure('Nieprawidłowy pracownik.');
        return nativeJson(await timeContracts(ctx, q('employee')));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-time]', error);
    return failure(errorText(error, 'Nie udało się wczytać czasu pracy.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, any>;
  try {
    body = await readJson(request, 64_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const id = String(body.id || '');
  const entryId = String(body.entryId || '');
  try {
    switch (String(body.op || '')) {
      case 'start':
        return nativeJson(await startTimer(ctx, body));
      case 'stop':
        if (!uuid.test(id)) return failure('Nieprawidłowy wpis.');
        return nativeJson(await stopTimer(ctx, id));
      case 'update':
        return nativeJson(await updateEntry(ctx, body));
      case 'delete':
        if (!uuid.test(id)) return failure('Nieprawidłowy wpis.');
        return nativeJson(await deleteEntry(ctx, id));
      case 'discussionPost':
        if (!uuid.test(entryId)) return failure('Nieprawidłowy wpis.');
        return nativeJson(await postDiscussion(ctx, entryId, body.body));
      case 'discussionResolve':
        if (!uuid.test(entryId)) return failure('Nieprawidłowy wpis.');
        return nativeJson(await resolveDiscussion(ctx, entryId, body.resolved === true));
      case 'settlementSave':
        return nativeJson(await saveSettlement(ctx, body));
      case 'settlementVoid':
        if (!uuid.test(id)) return failure('Nieprawidłowe rozliczenie.');
        return nativeJson(await voidSettlement(ctx, id, body.reason));
      case 'assignContract':
        if (!uuid.test(entryId) || !uuid.test(String(body.contractId || ''))) return failure('Wybierz umowę.');
        return nativeJson(await assignContract(ctx, entryId, String(body.contractId)));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-time]', error);
    return failure(errorText(error, 'Nie udało się zapisać zmian.'), statusOf(error));
  }
}
