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
import { deleteFinanceEntry, financeEntries, saveFinanceEntry } from '@/lib/native/financeEntries';
import { invoiceCancel, invoiceDelete, invoiceDetail, invoicesList, invoiceStatus } from '@/lib/native/financeInvoices';
import {
  ksefAddPayment,
  ksefCompanies,
  ksefDelete,
  ksefInvoices,
  ksefMarkPaid,
  ksefMarkUnpaid,
  ksefRemovePayment,
  ksefResolveReview,
  ksefSavePayment,
} from '@/lib/native/financeKsef';

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
 * Koszty i wypłaty (`src/lib/native/financeEntries.ts`): GET op=entries | POST op=entrySave {…} | entryDelete {id}.
 * Faktury (`src/lib/native/financeInvoices.ts`): GET op=invoices | invoice&id=… | POST op=invoiceStatus {id, status, paidDate?} |
 * invoiceCancel {id, reason, notDelivered} | invoiceDelete {id}.
 * KSeF (`src/lib/native/financeKsef.ts`): GET op=ksef | ksefInvoices&company=… | POST op=ksefPaid {id} | ksefUnpaid {id} |
 * ksefPaymentAdd {id, amount, date, notes} | ksefPaymentRemove {paymentId} | ksefPaymentSave {id, dueDate, paymentDate} |
 * ksefReviewResolve {id} | ksefDelete {id}. Synchronizacja — trasy `/bridge/ksef/auth/token` i `/bridge/ksef/invoices/*`.
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
      case 'entries':
        return nativeJson(await financeEntries(ctx));
      case 'invoices':
        return nativeJson(await invoicesList(ctx));
      case 'invoice':
        return nativeJson(await invoiceDetail(ctx, url.searchParams.get('id')));
      case 'ksef':
        return nativeJson(await ksefCompanies(ctx));
      case 'ksefInvoices':
        return nativeJson(await ksefInvoices(ctx, url.searchParams.get('company')));
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
      case 'entrySave':
        return nativeJson(await saveFinanceEntry(ctx, body));
      case 'entryDelete':
        return nativeJson(await deleteFinanceEntry(ctx, body));
      case 'invoiceStatus':
        return nativeJson(await invoiceStatus(ctx, body));
      case 'invoiceCancel':
        return nativeJson(await invoiceCancel(ctx, body));
      case 'invoiceDelete':
        return nativeJson(await invoiceDelete(ctx, body));
      case 'ksefPaid':
        return nativeJson(await ksefMarkPaid(ctx, body));
      case 'ksefUnpaid':
        return nativeJson(await ksefMarkUnpaid(ctx, body));
      case 'ksefPaymentAdd':
        return nativeJson(await ksefAddPayment(ctx, body));
      case 'ksefPaymentRemove':
        return nativeJson(await ksefRemovePayment(ctx, body));
      case 'ksefPaymentSave':
        return nativeJson(await ksefSavePayment(ctx, body));
      case 'ksefReviewResolve':
        return nativeJson(await ksefResolveReview(ctx, body));
      case 'ksefDelete':
        return nativeJson(await ksefDelete(ctx, body));
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
