import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  checkWhitelist,
  deleteSupplierTerm,
  fetchMissingUpo,
  financePeriods,
  financeState,
  invoicePdfFile,
  invoicePdfGenerate,
  invoiceUpo,
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
  invoiceBuyerLink,
  invoiceCreate,
  invoiceEvent,
  invoiceFormSetup,
  invoiceNumberCheck,
  invoiceNumberPeek,
  invoiceOrganizationEvents,
  invoiceOriginal,
  recipientOrganization,
  recipientOrganizations,
} from '@/lib/native/financeInvoiceForm';
import { proformaConvert, proformaNumber, proformaSetup } from '@/lib/native/financeProforma';
import { invoiceEditEvents, invoiceEditSave, invoiceEditSetup } from '@/lib/native/financeInvoiceEdit';
import { finalCandidates, finalCreate, finalItems, finalNumber, finalSearch, finalSetup } from '@/lib/native/financeFinalInvoice';
import {
  ksefAddPayment,
  ksefCompanies,
  ksefCorrection,
  ksefCorrectionLink,
  ksefCorrectionOffset,
  ksefCorrectionOffsetUndo,
  ksefCorrectionUnlink,
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
 * zamknięcia miesięcy) | periods&company=…&year=… | reminder&invoice=…&mode=reminder|invoice (okno przypomnienia
 * o płatności albo „Wyślij email” z karty faktury).
 * POST op=taxRate {companyId, rate} | obligations {companyId, settings} | paymentDue {invoiceId, date, remember} |
 * supplierTermDelete {companyId, nip} | lock {companyId, year, month, note} | unlock {companyId, year, month, reason} |
 * whitelist {companyId, mode, ids?, force?} | upoMissing {companyId} | reminderPreview {invoiceId, accountId, subject,
 * text, recipientName, mode?} | reminderSend {invoiceId, accountId, to, cc, bcc, subject, text, recipientName, scheduledAt?,
 * mode?} (mode=invoice — faktura e-mailem z karty, bez historii monitów).
 * Koszty i wypłaty (`src/lib/native/financeEntries.ts`): GET op=entries | POST op=entrySave {…} | entryDelete {id}.
 * Faktury (`src/lib/native/financeInvoices.ts`): GET op=invoices | invoice&id=… | POST op=invoiceStatus {id, status, paidDate?} |
 * invoiceCancel {id, reason, notDelivered} | invoiceDelete {id}. Karta faktury (`finance.ts`): GET op=invoicePdfFile&id=… (zapisany
 * PDF) | POST op=invoicePdf {id} („Generuj / Regeneruj PDF”) | invoiceUpo {id} (UPO z KSeF). Wysyłka do KSeF — trasa CRM
 * `/bridge/ksef/invoices/send` (strumień postępu, token aplikacji).
 * Wystawianie (`src/lib/native/financeInvoiceForm.ts`, jak `/crm/invoices/new`): GET op=invoiceForm&type=…&advanceFrom=… |
 * invoiceEvent&id=…&mode=new|keep | invoiceOrgEvents&org=…&keep=… | invoiceBuyerLink&org=… | invoiceRecipientOrgs |
 * invoiceRecipientOrg&id=… | invoiceOriginal&id=… | invoiceNumber&type=…&company=… | invoiceNumberCheck&company=…&number=… |
 * POST op=invoiceCreate {form}. Faktura z pro formy (`src/lib/native/financeProforma.ts`, jak `ConvertProformaModal`): GET
 * op=proformaSetup&id=… | proformaNumber&id=…&type=vat|advance | POST op=proformaConvert {id, form, recipientUnreadable?}.
 * Edycja szkicu / pro formy (`src/lib/native/financeInvoiceEdit.ts`, jak `/crm/invoices/[id]/edit`): GET op=invoiceEdit&id=… |
 * invoiceEditEvents&org=…&keep=… | POST op=invoiceEdit {id, form}.
 * Faktura końcowa (`src/lib/native/financeFinalInvoice.ts`, jak `FinalInvoiceWizardModal`): GET op=finalSetup |
 * finalSearch&kind=event|organization&q=… | finalCandidates&advance=…&mode=…&event=…&org=… |
 * finalItems&advance=…&snapshot=…&event=… | finalNumber&company=… | POST op=finalCreate {advance, mode, event, org, selected,
 * companyId, items, recipient, useCustomNumber, customNumber, issueDate, saleDate, paymentTermDays}.
 * KSeF (`src/lib/native/financeKsef.ts`): GET op=ksef | ksefInvoices&company=… | POST op=ksefPaid {id} | ksefUnpaid {id} |
 * ksefPaymentAdd {id, amount, date, notes} | ksefPaymentRemove {paymentId} | ksefPaymentSave {id, dueDate, paymentDate} |
 * ksefReviewResolve {id} | ksefDelete {id}. Synchronizacja — trasy `/bridge/ksef/auth/token` i `/bridge/ksef/invoices/*`.
 * Rozliczenie korekty „in minus” (`src/lib/invoices/ksefCorrectionSettlement.ts`): GET op=ksefCorrection&id=… | POST
 * op=ksefCorrectionLink {correctionId, documentId, transactionId, amount} | ksefCorrectionUnlink {correctionId, transactionId,
 * matchId} | ksefCorrectionOffset {correctionId, originalId, amount, date} | ksefCorrectionOffsetUndo {correctionId, originalId}.
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
        return nativeJson(await reminderSetup(ctx, url.searchParams.get('invoice') || '', url.searchParams.get('mode')));
      case 'invoicePdfFile':
        return nativeJson(await invoicePdfFile(ctx, url.searchParams.get('id')));
      case 'entries':
        return nativeJson(await financeEntries(ctx));
      case 'invoices':
        return nativeJson(await invoicesList(ctx));
      case 'invoice':
        return nativeJson(await invoiceDetail(ctx, url.searchParams.get('id')));
      case 'invoiceForm':
        return nativeJson(await invoiceFormSetup(ctx, url.searchParams));
      case 'invoiceEvent':
        return nativeJson(await invoiceEvent(ctx, url.searchParams.get('id'), url.searchParams.get('mode')));
      case 'invoiceOrgEvents':
        return nativeJson(await invoiceOrganizationEvents(ctx, url.searchParams.get('org'), url.searchParams.get('keep')));
      case 'invoiceBuyerLink':
        return nativeJson(await invoiceBuyerLink(ctx, url.searchParams.get('org')));
      case 'invoiceRecipientOrgs':
        return nativeJson(await recipientOrganizations(ctx));
      case 'invoiceRecipientOrg':
        return nativeJson(await recipientOrganization(ctx, url.searchParams.get('id')));
      case 'invoiceOriginal':
        return nativeJson(await invoiceOriginal(ctx, url.searchParams.get('id')));
      case 'invoiceNumber':
        return nativeJson(await invoiceNumberPeek(ctx, url.searchParams.get('type'), url.searchParams.get('company')));
      case 'invoiceNumberCheck':
        return nativeJson(await invoiceNumberCheck(ctx, url.searchParams.get('company'), url.searchParams.get('number')));
      case 'invoiceEdit':
        return nativeJson(await invoiceEditSetup(ctx, url.searchParams.get('id')));
      case 'invoiceEditEvents':
        return nativeJson(await invoiceEditEvents(ctx, url.searchParams.get('org'), url.searchParams.get('keep')));
      case 'proformaSetup':
        return nativeJson(await proformaSetup(ctx, url.searchParams.get('id')));
      case 'finalSetup':
        return nativeJson(await finalSetup(ctx));
      case 'finalSearch':
        return nativeJson(await finalSearch(ctx, url.searchParams.get('kind'), url.searchParams.get('q')));
      case 'finalCandidates':
        return nativeJson(await finalCandidates(ctx, url.searchParams));
      case 'finalItems':
        return nativeJson(await finalItems(ctx, url.searchParams));
      case 'finalNumber':
        return nativeJson(await finalNumber(ctx, url.searchParams.get('company')));
      case 'proformaNumber':
        return nativeJson(await proformaNumber(ctx, url.searchParams.get('id'), url.searchParams.get('type')));
      case 'ksef':
        return nativeJson(await ksefCompanies(ctx));
      case 'ksefInvoices':
        return nativeJson(await ksefInvoices(ctx, url.searchParams.get('company')));
      case 'ksefCorrection':
        return nativeJson(await ksefCorrection(ctx, url.searchParams.get('id')));
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
    body = await readJson(request, 512_000);
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
      case 'invoiceCreate':
        return nativeJson(await invoiceCreate(ctx, body));
      case 'invoicePdf':
        return nativeJson(await invoicePdfGenerate(ctx, body));
      case 'invoiceEdit':
        return nativeJson(await invoiceEditSave(ctx, body));
      case 'proformaConvert':
        return nativeJson(await proformaConvert(ctx, body));
      case 'finalCreate':
        return nativeJson(await finalCreate(ctx, body));
      case 'invoiceUpo':
        return nativeJson(await invoiceUpo(ctx, body));
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
      case 'ksefCorrectionLink':
        return nativeJson(await ksefCorrectionLink(ctx, body));
      case 'ksefCorrectionUnlink':
        return nativeJson(await ksefCorrectionUnlink(ctx, body));
      case 'ksefCorrectionOffset':
        return nativeJson(await ksefCorrectionOffset(ctx, body));
      case 'ksefCorrectionOffsetUndo':
        return nativeJson(await ksefCorrectionOffsetUndo(ctx, body));
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
