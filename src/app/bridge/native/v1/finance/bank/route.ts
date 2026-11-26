import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  acceptProposal,
  addDeclarationFile,
  bankMonth,
  bankPeriods,
  checkStatementRemoval,
  contractCandidates,
  declarations,
  deleteDeclaration,
  deleteDeclarationLine,
  deleteStatement,
  documentPreview,
  explainSetup,
  explainTransaction,
  fileContent,
  importStatement,
  linkContract,
  linkDeclaration,
  linkRefund,
  matchDocument,
  pickerDocuments,
  prefillDeclarationLines,
  refundCandidates,
  rejectProposal,
  removeDeclarationFile,
  renameStatement,
  runReconciliation,
  saveContract,
  saveDeclaration,
  saveDeclarationLine,
  statements,
  transactionDetails,
  undoLink,
} from '@/lib/native/financeBank';
import { financeMatchedDocumentsPdf } from '@/lib/drive/drive.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Bank i deklaracje dla aplikacji na Maca (`src/lib/native/financeBank.ts`) — token pracownika, uprawnienia jak w CRM.
 * GET op=periods | month&company&year&month | picker&transaction&allocated | explain&transaction | details&transaction |
 *   contracts&transaction&remaining | refunds&transaction&search | declarations&company&years | statements&company&year |
 *   file&kind=statement|declaration|supporting&id | document&source=invoice|external|ksef&id |
 *   matchedPdf&company&year&month (też POST JSON — Mac z dłuższym czasem oczekiwania).
 *   matchedPdf — „Dopasowane faktury (PDF)”: zestawienie i dokumenty przypisane w miesiącu, adres do pobrania (`drive.server.ts`).
 * POST JSON op=run | accept | reject | undo | match | explain | linkDeclaration | linkContract | saveContract | linkRefund | matchedPdf |
 *   declarationSave | declarationDelete | lineSave | lineDelete | linesPrefill | declarationFileRemove |
 *   statementRename | statementCheck | statementDelete.
 * POST multipart (pole „file”) ?op=statementImport (companyId, year, month, accountType, format, confirmAccount) |
 *   declarationFile (declarationId) | explainFile (transactionId, subtype, note).
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
  const params = new URL(request.url).searchParams;
  const op = params.get('op') || '';
  try {
    switch (op) {
      case 'periods':
        return nativeJson(await bankPeriods(ctx));
      case 'month':
        return nativeJson(await bankMonth(ctx, params.get('company'), params.get('year'), params.get('month')));
      case 'picker':
        return nativeJson(await pickerDocuments(ctx, params.get('transaction'), params.get('allocated')));
      case 'explain':
        return nativeJson(await explainSetup(ctx, params.get('transaction')));
      case 'details':
        return nativeJson(await transactionDetails(ctx, params.get('transaction')));
      case 'contracts':
        return nativeJson(await contractCandidates(ctx, params.get('transaction'), params.get('remaining')));
      case 'refunds':
        return nativeJson(await refundCandidates(ctx, params.get('transaction'), params.get('search')));
      case 'declarations':
        return nativeJson(await declarations(ctx, params.get('company'), params.get('years')));
      case 'statements':
        return nativeJson(await statements(ctx, params.get('company'), params.get('year')));
      case 'file':
        return nativeJson(await fileContent(ctx, params.get('kind'), params.get('id')));
      case 'document':
        return nativeJson(await documentPreview(ctx, params.get('source'), params.get('id')));
      case 'matchedPdf':
        return nativeJson(await financeMatchedDocumentsPdf(ctx, params.get('company'), params.get('year'), params.get('month')));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-finance-bank]', error);
    return failure(errorText(error, 'Nie udało się wczytać danych.'), statusOf(error));
  }
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

async function multipart(request: Request, op: string) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (op === 'explainFile') {
      const body = { transactionId: field(form, 'transactionId'), subtype: field(form, 'subtype'), note: field(form, 'note') };
      return nativeJson(await explainTransaction(ctx, body, file instanceof File ? file : null));
    }
    if (!(file instanceof File)) return failure('Nie przesłano pliku.');
    if (op === 'statementImport') {
      return nativeJson(await importStatement(ctx, {
        companyId: field(form, 'companyId'), year: field(form, 'year'), month: field(form, 'month'),
        accountType: field(form, 'accountType'), format: field(form, 'format'), confirmAccount: field(form, 'confirmAccount'),
      }, file));
    }
    if (op === 'declarationFile') return nativeJson(await addDeclarationFile(ctx, field(form, 'declarationId'), file));
    return failure('Nieznana operacja.');
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-finance-bank]', error);
    return failure(errorText(error, 'Nie udało się przesłać pliku.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const fileOp = new URL(request.url).searchParams.get('op') || '';
  if (['statementImport', 'declarationFile', 'explainFile'].includes(fileOp)) return multipart(request, fileOp);

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
      case 'run':
        return nativeJson(await runReconciliation(ctx, body));
      case 'accept':
        return nativeJson(await acceptProposal(ctx, body));
      case 'reject':
        return nativeJson(await rejectProposal(ctx, body));
      case 'undo':
        return nativeJson(await undoLink(ctx, body));
      case 'match':
        return nativeJson(await matchDocument(ctx, body));
      case 'explain':
        return nativeJson(await explainTransaction(ctx, body, null));
      case 'linkDeclaration':
        return nativeJson(await linkDeclaration(ctx, body));
      case 'linkContract':
        return nativeJson(await linkContract(ctx, body));
      case 'saveContract':
        return nativeJson(await saveContract(ctx, body));
      case 'linkRefund':
        return nativeJson(await linkRefund(ctx, body));
      case 'matchedPdf':
        return nativeJson(await financeMatchedDocumentsPdf(ctx, body.companyId, body.year, body.month));
      case 'declarationSave':
        return nativeJson(await saveDeclaration(ctx, body));
      case 'declarationDelete':
        return nativeJson(await deleteDeclaration(ctx, body));
      case 'lineSave':
        return nativeJson(await saveDeclarationLine(ctx, body));
      case 'lineDelete':
        return nativeJson(await deleteDeclarationLine(ctx, body));
      case 'linesPrefill':
        return nativeJson(await prefillDeclarationLines(ctx, body));
      case 'declarationFileRemove':
        return nativeJson(await removeDeclarationFile(ctx, body));
      case 'statementRename':
        return nativeJson(await renameStatement(ctx, body));
      case 'statementCheck':
        return nativeJson(await checkStatementRemoval(ctx, body));
      case 'statementDelete':
        return nativeJson(await deleteStatement(ctx, body));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-finance-bank]', error);
    return failure(errorText(error, 'Nie udało się zapisać zmian.'), statusOf(error));
  }
}
