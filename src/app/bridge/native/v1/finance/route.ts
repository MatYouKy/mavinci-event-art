import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  checkWhitelist,
  deleteSupplierTerm,
  fetchMissingUpo,
  financePeriods,
  financeState,
  lockPeriod,
  reminderPreview,
  reminderSetup,
  saveObligationSettings,
  saveTaxRate,
  sendReminder,
  setPaymentDue,
  unlockPeriod,
} from '@/lib/native/finance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/*
 * Finanse dla aplikacji na Maca (`src/lib/native/finance.ts`) — token pracownika, uprawnienia jak w CRM (funkcje bazy).
 * GET op=state&company=…&year=… (działalności z „Podglądem finansów”, Centrum finansów, terminy i monity, biała lista,
 * zamknięcia miesięcy) | periods&company=…&year=… | reminder&invoice=… (okno przypomnienia o płatności).
 * POST op=taxRate {companyId, rate} | obligations {companyId, settings} | paymentDue {invoiceId, date, remember} |
 * supplierTermDelete {companyId, nip} | lock {companyId, year, month, note} | unlock {companyId, year, month, reason} |
 * whitelist {companyId, mode, ids?, force?} | upoMissing {companyId} | reminderPreview {invoiceId, accountId, subject,
 * text, recipientName} | reminderSend {invoiceId, accountId, to, cc, bcc, subject, text, recipientName, scheduledAt?}.
 */

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
  const op = url.searchParams.get('op') || '';
  try {
    switch (op) {
      case 'state':
        return nativeJson(await financeState(ctx, url.searchParams.get('company'), url.searchParams.get('year')));
      case 'periods':
        return nativeJson(await financePeriods(ctx, url.searchParams.get('company') || '', url.searchParams.get('year')));
      case 'reminder':
        return nativeJson(await reminderSetup(ctx, url.searchParams.get('invoice') || ''));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-finance]', error);
    return failure(errorText(error, 'Nie udało się wczytać finansów.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, unknown>;
  try {
    body = await readJson(request, 64_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  try {
    switch (op) {
      case 'taxRate':
        return nativeJson(await saveTaxRate(ctx, body));
      case 'obligations':
        return nativeJson(await saveObligationSettings(ctx, body));
      case 'paymentDue':
        return nativeJson(await setPaymentDue(ctx, body));
      case 'supplierTermDelete':
        return nativeJson(await deleteSupplierTerm(ctx, body));
      case 'lock':
        return nativeJson(await lockPeriod(ctx, body));
      case 'unlock':
        return nativeJson(await unlockPeriod(ctx, body));
      case 'whitelist':
        return nativeJson(await checkWhitelist(ctx, body));
      case 'upoMissing':
        return nativeJson(await fetchMissingUpo(ctx, body));
      case 'reminderPreview':
        return nativeJson(await reminderPreview(ctx, body));
      case 'reminderSend': {
        // Funkcja poczty tokenem pracownika, jak w przeglądarce (`send-invoice-email`).
        const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
        return nativeJson(await sendReminder(ctx, token, body));
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-finance]', error);
    return failure(errorText(error, 'Nie udało się zapisać zmian.'), statusOf(error));
  }
}
