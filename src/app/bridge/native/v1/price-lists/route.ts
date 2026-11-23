import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { offersAccess } from '@/lib/native/offers';
import {
  canManagePriceLists,
  createPriceList,
  deletePriceList,
  duplicatePriceList,
  fillPriceList,
  percentPriceList,
  priceListEditor,
  priceListsState,
  productSeasonPrices,
  savePriceListPrices,
  updatePriceList,
} from '@/lib/native/priceLists';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Cenniki sezonowe dla aplikacji na Maca (`src/lib/native/priceLists.ts`) — jak „Oferty → Cenniki” w CRM: GET op=state (cenniki,
 * marki, kategorie, „Do sprawdzenia” — `attention`) | list&id=… (edytor cen) | product&id=… (ceny produktu w cennikach, karta produktu); POST op=create |
 * update {id, name?, seasonFrom?, seasonTo?, notes?, status?} | delete {id} | duplicate {id, name, seasonFrom, seasonTo, percent,
 * rounding} | fill {id, categoryId?, percent, rounding} | prices {id, changes:[{productId, variantId?, price|null}]} |
 * percent {id, percent, rounding}. Podgląd — dostęp do ofert; zmiany — admin albo `offers_manage` (pilnuje też RLS).
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!offersAccess(ctx).canView) return failure('Nie masz dostępu do ofert.', 403);
  const url = new URL(request.url);
  try {
    switch (url.searchParams.get('op')) {
      case 'state': return nativeJson(await priceListsState(ctx));
      case 'list': return nativeJson(await priceListEditor(ctx, url.searchParams.get('id') || ''));
      case 'product': return nativeJson(await productSeasonPrices(ctx, url.searchParams.get('id') || ''));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się pobrać cenników.'));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!canManagePriceLists(ctx)) return failure('Nie masz uprawnień do zmiany cenników. Wymagane uprawnienie: offers_manage.', 403);
  let body: Record<string, any>;
  try {
    body = await readJson(request, 512_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'create': return nativeJson(await createPriceList(ctx, body));
      case 'update': return nativeJson(await updatePriceList(ctx, body));
      case 'delete': return nativeJson(await deletePriceList(ctx, body));
      case 'duplicate': return nativeJson(await duplicatePriceList(ctx, body));
      case 'fill': return nativeJson(await fillPriceList(ctx, body));
      case 'prices': return nativeJson(await savePriceListPrices(ctx, body));
      case 'percent': return nativeJson(await percentPriceList(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się zapisać cennika.'));
  }
}
