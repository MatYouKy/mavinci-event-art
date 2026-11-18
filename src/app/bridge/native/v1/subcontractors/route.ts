import { can, nativeContext, nativeJson, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { saveSubcontractor, subcontractorCard, subcontractorPersonnel, subcontractorsList } from '@/lib/native/subcontractors';
import {
  addCatalogItem,
  addServiceType,
  deleteCatalogItem,
  deleteService,
  removeNewServiceImage,
  removeServiceType,
  saveService,
  serviceDetails,
  subcontractorServices,
  toggleServiceType,
  uploadServiceImage,
} from '@/lib/native/subcontractorServices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Podwykonawcy dla aplikacji na Maca (`src/lib/native/subcontractors.ts`) — jak strony `/crm/subcontractors` (dostęp jak
 * moduł Kontakty w CRM): GET op=list | card&id=… | personnel&id=… (dane do umowy zlecenia, z uprawnieniem do umów);
 * POST op=save {id?, form} — nowy podwykonawca albo dane i rozliczenie istniejącego. Tokenem pracownika (RLS jak w CRM).
 * Zakres i usługi (`src/lib/native/subcontractorServices.ts`): GET op=services&id=… | service&id=…; POST op=serviceTypeAdd |
 * serviceTypeToggle | serviceTypeRemove | catalogAdd | catalogDelete | serviceSave | serviceDelete | serviceImageRemove;
 * zdjęcie usługi — multipart `?op=serviceImage&folder=<id usługi|temp-…>` (pole „file”) → `service-catalog-images`.
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => (error as { status?: number })?.status || 500;
const allowed = (ctx: NativeContext) => can(ctx.employee, 'contacts_view') || can(ctx.employee, 'contacts_manage');

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do kontaktów.', 403);
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  try {
    switch (op) {
      case 'list': return nativeJson(await subcontractorsList(ctx));
      case 'card': return nativeJson(await subcontractorCard(ctx, url.searchParams.get('id')));
      case 'personnel': return nativeJson(await subcontractorPersonnel(ctx, url.searchParams.get('id')));
      case 'services': return nativeJson(await subcontractorServices(ctx, url.searchParams.get('id')));
      case 'service': return nativeJson(await serviceDetails(ctx, url.searchParams.get('id')));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-subcontractors]', op, error);
    return failure(errorText(error, 'Nie udało się pobrać podwykonawców.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do kontaktów.', 403);
  const url = new URL(request.url);
  if (url.searchParams.get('op') === 'serviceImage') {
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return failure('Brak pliku.');
      return nativeJson(await uploadServiceImage(ctx, url.searchParams.get('folder'), file));
    } catch (error) {
      if (statusOf(error) >= 500) console.error('[native-subcontractors] upload', error);
      return failure(errorText(error, 'Nie udało się przesłać zdjęcia.'), statusOf(error));
    }
  }
  let body: Record<string, unknown>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  try {
    switch (op) {
      case 'save': return nativeJson(await saveSubcontractor(ctx, body));
      case 'serviceTypeAdd': return nativeJson(await addServiceType(ctx, body));
      case 'serviceTypeToggle': return nativeJson(await toggleServiceType(ctx, body));
      case 'serviceTypeRemove': return nativeJson(await removeServiceType(ctx, body));
      case 'catalogAdd': return nativeJson(await addCatalogItem(ctx, body));
      case 'catalogDelete': return nativeJson(await deleteCatalogItem(ctx, body));
      case 'serviceSave': return nativeJson(await saveService(ctx, body));
      case 'serviceDelete': return nativeJson(await deleteService(ctx, body));
      case 'serviceImageRemove': return nativeJson(await removeNewServiceImage(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-subcontractors]', op, error);
    return failure(errorText(error, 'Nie udało się zapisać podwykonawcy.'), statusOf(error));
  }
}
