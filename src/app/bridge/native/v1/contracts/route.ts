import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  contractPdf,
  contractsAccess,
  contractsState,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  saveTemplate,
  setTemplateActive,
} from '@/lib/native/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Umowy z klientami dla aplikacji na Maca (`src/lib/native/contracts.ts`): GET op=state (umowy i szablony), op=pdf&id=…;
 * POST op=templateCreate | templateSave | templateActive | templateDuplicate | templateDelete.
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!contractsAccess(ctx).canView) return failure('Nie masz dostępu do umów.', 403);
  const url = new URL(request.url);
  try {
    switch (url.searchParams.get('op')) {
      case 'state':
        return nativeJson(await contractsState(ctx));
      case 'pdf':
        return nativeJson(await contractPdf(ctx, url.searchParams.get('id') || ''));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się pobrać umów.'));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!contractsAccess(ctx).canView) return failure('Nie masz dostępu do umów.', 403);
  let body: Record<string, any>;
  try {
    body = await readJson(request, 64_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'templateCreate': return nativeJson(await createTemplate(ctx, body));
      case 'templateSave': return nativeJson(await saveTemplate(ctx, body));
      case 'templateActive': return nativeJson(await setTemplateActive(ctx, body));
      case 'templateDuplicate': return nativeJson(await duplicateTemplate(ctx, body));
      case 'templateDelete': return nativeJson(await deleteTemplate(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się zapisać zmian.'));
  }
}
