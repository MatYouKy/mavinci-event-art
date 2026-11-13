import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  createProduct,
  deleteProduct,
  productDetail,
  productsAccess,
  productsState,
  refreshProductEnglish,
  saveProductSection,
  setReadinessExemption,
  subcontractorServices,
  uploadProductImage,
} from '@/lib/native/products';
import {
  addEquipment,
  customizeVariant,
  equipmentCatalog,
  inheritVariant,
  productResources,
  removeEquipment,
  removeStaff,
  saveClauses,
  saveStaff,
  toggleLiveModule,
  updateEquipment,
} from '@/lib/native/productResources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Tłumaczenie (`translate-product`) trwa do 3 minut.
export const maxDuration = 200;

/*
 * Produkty (katalog oferty) dla aplikacji na Maca (`src/lib/native/products.ts`): GET op=state (katalog z gotowością),
 * op=product&id=… (karta produktu), op=services&organization=… (usługi podwykonawcy), op=resources&id=…&variant=… (sprzęt,
 * obsada, Mavinci LIVE i klauzule w zakresie produktu lub wariantu), op=equipmentCatalog (sprzęt i zestawy do wyboru);
 * POST op=create | delete | section (zapis sekcji karty) | exemption („nie dotyczy”) | image (zdjęcie do oferty) |
 * english (wersja angielska po zmianie treści, jak w CRM) | equipmentAdd | equipmentUpdate | equipmentRemove | staffSave |
 * staffRemove | liveToggle | clausesSave | variantCustomize | variantInherit (zakres wariantu).
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!productsAccess(ctx).canView) return failure('Nie masz dostępu do produktów.', 403);
  const url = new URL(request.url);
  try {
    switch (url.searchParams.get('op')) {
      case 'state': return nativeJson(await productsState(ctx));
      case 'product': return nativeJson(await productDetail(ctx, url.searchParams.get('id') || ''));
      case 'services': return nativeJson({ services: await subcontractorServices(ctx, url.searchParams.get('organization') || '') });
      case 'resources': return nativeJson(await productResources(ctx, url.searchParams.get('id') || '', url.searchParams.get('variant') || null));
      case 'equipmentCatalog': return nativeJson(await equipmentCatalog(ctx));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się pobrać produktów.'));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!productsAccess(ctx).canView) return failure('Nie masz dostępu do produktów.', 403);
  let body: Record<string, any>;
  try {
    // Zdjęcie do oferty (do ~8 MB w base64); pozostałe operacje to krótkie formularze.
    body = await readJson(request, 12_000_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'create': return nativeJson(await createProduct(ctx, body));
      case 'delete': return nativeJson(await deleteProduct(ctx, body));
      case 'section': return nativeJson(await saveProductSection(ctx, body));
      case 'exemption': return nativeJson(await setReadinessExemption(ctx, body));
      case 'image': return nativeJson(await uploadProductImage(ctx, body));
      case 'english': return nativeJson(await refreshProductEnglish(ctx, body));
      case 'equipmentAdd': return nativeJson(await addEquipment(ctx, body));
      case 'equipmentUpdate': return nativeJson(await updateEquipment(ctx, body));
      case 'equipmentRemove': return nativeJson(await removeEquipment(ctx, body));
      case 'staffSave': return nativeJson(await saveStaff(ctx, body));
      case 'staffRemove': return nativeJson(await removeStaff(ctx, body));
      case 'liveToggle': return nativeJson(await toggleLiveModule(ctx, body));
      case 'clausesSave': return nativeJson(await saveClauses(ctx, body));
      case 'variantCustomize': return nativeJson(await customizeVariant(ctx, body));
      case 'variantInherit': return nativeJson(await inheritVariant(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się zapisać zmian.'));
  }
}
