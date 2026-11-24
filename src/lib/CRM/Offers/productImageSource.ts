/*
 * Zdjęcie produktu z Dysku (Materiały). Oryginał zostaje w Dysku; produkt dostaje lekką wersję WebP (do 1800 px) w magazynie zdjęć
 * produktów (`offer-product-pages`) pod ścieżką `assets/<produkt>/material-<plik>-v<wersja treści>.webp`. Ścieżka wskazuje plik
 * Materiałów i jego wersję, więc karta produktu wie, skąd jest zdjęcie i czy w Dysku jest już nowsza wersja („Podmień treść”).
 * Ten sam plik w tej samej wersji drugi raz się nie zapisuje. Zdjęcie z Dysku można wybrać do zdjęcia głównego, wariantu (elementu)
 * i pakietu — wszystkie korzystają z tej samej wersji. Zdjęcia z komputera też trafiają do magazynu jako WebP. PDF oferty zamienia
 * WebP na JPEG (albo PNG z przezroczystością) przy generowaniu — `src/lib/images/imageConvert.server.ts`. Wspólne dla serwera, CRM
 * i opisów na Macu.
 */

const UUID = '[\\da-f]{8}-(?:[\\da-f]{4}-){3}[\\da-f]{12}';
const SOURCE = new RegExp(`^assets/${UUID}/material-(${UUID})-v(\\d{1,9})\\.webp$`, 'i');

/** Dłuższy bok wersji zdjęcia produktu z Dysku (jak zdjęcia wgrywane z komputera — `optimizeOfferImage`). */
export const PRODUCT_MATERIAL_IMAGE_SIDE = 1800;

/**
 * Dłuższy bok zdjęć z komputera: CRM i Mac zmniejszają plik do tego rozmiaru przed wysłaniem, serwer zapisuje go jako WebP
 * (`src/lib/native/productImages.ts`). Własne zdjęcia broszur — `BROCHURE_IMAGE_SIDE`.
 */
export const OFFER_IMAGE_SIDES = { product: 1800, variant: 1800, package: 1400 } as const;
export const BROCHURE_IMAGE_SIDE = 2200;

/** Ścieżka wersji zdjęcia z Dysku dla produktu. */
export function productMaterialImagePath(productId: string, fileId: string, version: number): string {
  return `assets/${productId}/material-${fileId.toLowerCase()}-v${Math.max(1, Math.floor(version) || 1)}.webp`;
}

/** Plik Dysku i wersja treści, z których powstało zdjęcie produktu; zdjęcie wgrane z komputera — `null`. */
export function productMaterialImageSource(path: string | null | undefined): { fileId: string; version: number } | null {
  const match = SOURCE.exec(String(path || ''));
  return match ? { fileId: match[1].toLowerCase(), version: Number(match[2]) } : null;
}

/** Opis źródła zdjęcia produktu z Dysku (serwer → CRM i Mac). */
export type ProductImageSource = {
  fileId: string;
  /** Wersja treści pliku, z której powstało zdjęcie produktu. */
  version: number;
  /** Bieżąca wersja treści w Dysku (większa — w Dysku podmieniono zdjęcie); `null` — plik niedostępny. */
  currentVersion: number | null;
  name: string;
  /** „Mavinci / Zdjęcia / ER - Sylwester” (marka i foldery). */
  place: string;
  /** Plik usunięty z Dysku albo bez dostępu — zdjęcie produktu zostaje. */
  missing: boolean;
};

/** „Z Dysku: Mavinci / Zdjęcia / … / plik.jpg”, „Z Dysku (plik usunięty albo bez dostępu)”. */
export function productImageSourceText(source: ProductImageSource): string {
  if (source.missing) return 'Z Dysku — pliku już nie ma w Dysku albo nie masz do niego dostępu (zdjęcie produktu zostaje).';
  return `Z Dysku: ${[source.place, source.name].filter(Boolean).join(' / ')}`;
}

/** W Dysku podmieniono treść pliku po wybraniu zdjęcia do produktu. */
export const productImageSourceOutdated = (source: ProductImageSource | null | undefined) =>
  Boolean(source && !source.missing && source.currentVersion !== null && source.currentVersion > source.version);
