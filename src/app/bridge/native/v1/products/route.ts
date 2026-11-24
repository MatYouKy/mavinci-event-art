import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  convertProductImages,
  createProduct,
  deleteProduct,
  draftProductOfferCopy,
  duplicateProductCard,
  draftVariantCopy,
  productDetail,
  productEnglish,
  productImageFromMaterial,
  productImageSourceOf,
  productImagesPending,
  productsAccess,
  productsState,
  refreshProductEnglish,
  saveProductEnglish,
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
import {
  productExtras,
  removePreparation,
  saveAddons,
  savePackages,
  savePreparation,
  saveRelatedServices,
  saveRequirements,
  saveVariants,
  togglePreparation,
} from '@/lib/native/productExtras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Tłumaczenie (`translate-product`) trwa do 3 minut.
export const maxDuration = 200;

/*
 * Produkty (katalog oferty) dla aplikacji na Maca (`src/lib/native/products.ts`): GET op=state (katalog z gotowością),
 * op=product&id=… (karta produktu), op=services&organization=… (usługi podwykonawcy), op=resources&id=…&variant=… (sprzęt,
 * obsada, Mavinci LIVE i klauzule w zakresie produktu lub wariantu), op=equipmentCatalog (sprzęt i zestawy do wyboru),
 * op=extras&id=… (warianty, przygotowanie, wymagania, powiązane usługi, dodatki), op=english&id=… (teksty wersji EN),
 * op=imageSource&path=… (zdjęcie produktu z Dysku: plik, miejsce, nowsza wersja — CRM), op=imagesPending (ile zdjęć jest
 * jeszcze w JPG/PNG);
 * POST op=create | duplicate {id} (kopia całej karty jako nowy, nieaktywny produkt) | delete | section (zapis sekcji karty,
 * także kadry zdjęć `image_crops`) | exemption („nie dotyczy”) |
 * image {id, data, target?: product | variant | package, targetId?} (zdjęcie z komputera → WebP) | imageFromMaterial {id, fileId}
 * (zdjęcie z Dysku — lekka wersja WebP) | imagesConvert {skip?, limit?} (porcja zamiany starszych zdjęć na WebP) |
 * english („Przetłumacz PL → EN”, też w tle po zmianie treści, jak w CRM) | englishSave (poprawki
 * tekstów EN) | aiOffer | aiVariant (propozycje treści z AI) | equipmentAdd | equipmentUpdate | equipmentRemove | staffSave |
 * staffRemove | liveToggle | clausesSave | variantCustomize | variantInherit (zakres wariantu) | variantsSave | preparationSave |
 * preparationToggle | preparationRemove | requirementsSave | relatedSave | addonsSave | packagesSave (pakiety sprzedaży).
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
      case 'extras': return nativeJson(await productExtras(ctx, url.searchParams.get('id') || ''));
      case 'english': return nativeJson(await productEnglish(ctx, url.searchParams.get('id') || ''));
      case 'imageSource': return nativeJson({ source: await productImageSourceOf(ctx, url.searchParams.get('path')) });
      case 'imagesPending': return nativeJson(await productImagesPending(ctx));
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
    // Zdjęcie do oferty (do 10 MB, w base64 ~13,4 mln znaków); pozostałe operacje to krótkie formularze.
    body = await readJson(request, 15_000_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'create': return nativeJson(await createProduct(ctx, body));
      case 'duplicate': return nativeJson(await duplicateProductCard(ctx, body));
      case 'delete': return nativeJson(await deleteProduct(ctx, body));
      case 'section': return nativeJson(await saveProductSection(ctx, body));
      case 'exemption': return nativeJson(await setReadinessExemption(ctx, body));
      case 'image': return nativeJson(await uploadProductImage(ctx, body));
      case 'imageFromMaterial': return nativeJson(await productImageFromMaterial(ctx, body));
      case 'imagesConvert': return nativeJson(await convertProductImages(ctx, body));
      case 'english': return nativeJson(await refreshProductEnglish(ctx, body));
      case 'englishSave': return nativeJson(await saveProductEnglish(ctx, body));
      case 'aiOffer': return nativeJson(await draftProductOfferCopy(ctx, body));
      case 'aiVariant': return nativeJson(await draftVariantCopy(ctx, body));
      case 'equipmentAdd': return nativeJson(await addEquipment(ctx, body));
      case 'equipmentUpdate': return nativeJson(await updateEquipment(ctx, body));
      case 'equipmentRemove': return nativeJson(await removeEquipment(ctx, body));
      case 'staffSave': return nativeJson(await saveStaff(ctx, body));
      case 'staffRemove': return nativeJson(await removeStaff(ctx, body));
      case 'liveToggle': return nativeJson(await toggleLiveModule(ctx, body));
      case 'clausesSave': return nativeJson(await saveClauses(ctx, body));
      case 'variantCustomize': return nativeJson(await customizeVariant(ctx, body));
      case 'variantInherit': return nativeJson(await inheritVariant(ctx, body));
      case 'variantsSave': return nativeJson(await saveVariants(ctx, body));
      case 'preparationSave': return nativeJson(await savePreparation(ctx, body));
      case 'preparationToggle': return nativeJson(await togglePreparation(ctx, body));
      case 'preparationRemove': return nativeJson(await removePreparation(ctx, body));
      case 'requirementsSave': return nativeJson(await saveRequirements(ctx, body));
      case 'relatedSave': return nativeJson(await saveRelatedServices(ctx, body));
      case 'addonsSave': return nativeJson(await saveAddons(ctx, body));
      case 'packagesSave': return nativeJson(await savePackages(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się zapisać zmian.'));
  }
}
