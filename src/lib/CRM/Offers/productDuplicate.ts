/*
 * „Duplikuj” produkt w katalogu (CRM i Mac): nowy produkt z własnym identyfikatorem i kopią całej karty — warianty (elementy),
 * pakiety, dodatki, wymagania, klauzule, powiązane usługi, tagi, sprzęt, obsada, Mavinci LIVE, przygotowanie i zamówienia, ceny
 * w cennikach sezonów (bez archiwalnych), zdjęcia (kopie plików w folderze nowego produktu) z kadrami i teksty EN. Kopia jest
 * nieaktywna, dopóki ktoś nie włączy „Produkt aktywny”. Nie kopiujemy cen sprzedawców ani pozycji w ofertach i broszurach.
 * Serwer — `src/lib/native/productDuplicate.ts`; Mac — `ProductsStore.duplicate`.
 */

export type ProductDuplicateResult = {
  ok: true;
  id: string;
  name: string;
  /** Części, których nie skopiowano z braku uprawnień (np. „moduły Mavinci LIVE”). */
  skipped: string[];
  /** Zdjęcia, których plików nie udało się skopiować (np. plik usunięty z magazynu) — kopia jest bez nich. */
  imagesMissing: number;
};

export const PRODUCT_DUPLICATE_NOTE =
  'Powstanie nowy produkt z kopią całej karty: warianty, pakiety, dodatki, wymagania, klauzule, sprzęt, obsada, Mavinci LIVE, '
  + 'przygotowanie, ceny w cennikach sezonów, zdjęcia z kadrami i teksty EN. Kopia będzie nieaktywna — włącz „Produkt aktywny”, '
  + 'gdy będzie gotowa. Ceny sprzedawców nie są kopiowane.';

/** Nazwa kopii: „Nazwa (kopia)”. */
export const productDuplicateName = (name: string) => `${String(name || 'Produkt').trim()} (kopia)`.slice(0, 300);

/** Komunikat po duplikowaniu (snackbar w CRM i na Macu). */
export function productDuplicateMessage(result: ProductDuplicateResult) {
  const parts = [`Utworzono „${result.name}” — kopia jest nieaktywna. Wprowadź zmiany i włącz „Produkt aktywny”.`];
  if (result.skipped.length) parts.push(`Bez: ${result.skipped.join(', ')} (brak uprawnień).`);
  if (result.imagesMissing) parts.push(`Nie udało się skopiować zdjęć: ${result.imagesMissing} — dodaj je ponownie.`);
  return parts.join(' ');
}
