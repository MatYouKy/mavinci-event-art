import 'server-only';
import type { Page } from 'playwright';
import { brochureFileName, type BrochurePageReference, type BrochureValidationIssue } from './validation';

export type BrochureImageSource = { originalUrl: string; fileName?: string };

// Defer only images, not text or embedded fonts. A bounded queue prevents a
// long brochure from starting dozens of Storage transformations at once.
export function deferBrochureImages(html: string): string {
  return html.replace(/<img\b[^>]*>/g, (tag) => tag.replace(/\bsrc="/, 'data-brochure-src="'));
}

export async function validatePdfAssets(page: Page, html: string, references: BrochurePageReference[],
  sources: Map<string, BrochureImageSource>, companyId: string, heading: boolean, body: boolean): Promise<BrochureValidationIssue[]> {
  const statuses = new Map<string, number>();
  page.on('response', (response) => {
    if (response.request().resourceType() === 'image') statuses.set(response.url(), response.status());
  });
  await page.setContent(deferBrochureImages(html), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const result = await page.evaluate(async ({ fallbacks, heading, body }) => {
    const deadline = Date.now() + 80_000;
    const images = Array.from(document.images);
    const groups = new Map<string, HTMLImageElement[]>();
    for (const image of images) {
      const src = image.getAttribute('data-brochure-src') || '';
      groups.set(src, [...(groups.get(src) || []), image]);
    }
    const failures: Array<{ pageKey: string; source: string; lastSource: string; logo: boolean; timedOut: boolean }> = [];
    const load = (image: HTMLImageElement, src: string) => new Promise<{ ok: boolean; timedOut: boolean }>((resolve) => {
      const remaining = Math.min(12_000, deadline - Date.now());
      if (remaining <= 0) { resolve({ ok: false, timedOut: true }); return; }
      let timer: ReturnType<typeof setTimeout>;
      const finish = (ok: boolean, timedOut = false) => {
        clearTimeout(timer);
        image.onload = null; image.onerror = null;
        if (!ok) image.removeAttribute('src');
        resolve({ ok, timedOut });
      };
      image.onload = () => finish(image.naturalWidth > 0);
      image.onerror = () => finish(false);
      timer = setTimeout(() => finish(false, true), remaining);
      image.src = src;
      if (image.complete && image.naturalWidth > 0) finish(true);
    });
    const entries = [...groups];
    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const [source, group] = entries[next++];
        const original = fallbacks[source] || source;
        // Use the original after a failed transformation. A second attempt also
        // covers a transient connection failure for public/original images.
        const candidates = [source, original, original];
        let lastSource = source;
        let outcome = { ok: false, timedOut: false };
        for (let attempt = 0; attempt < candidates.length; attempt++) {
          lastSource = candidates[attempt];
          if (!lastSource) break;
          if (attempt) {
            if (Date.now() >= deadline) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          outcome = await load(group[0], lastSource);
          if (outcome.ok) break;
        }
        const outcomes = outcome.ok
          ? [outcome, ...await Promise.all(group.slice(1).map((image) => load(image, lastSource)))]
          : group.map(() => outcome);
        group.forEach((image, index) => {
          if (outcomes[index].ok) return;
          failures.push({
            pageKey: image.closest('.page')?.getAttribute('data-page-key') || '',
            source, lastSource, logo: image.classList.contains('logo'),
            timedOut: outcomes[index].timedOut || Date.now() >= deadline,
          });
        });
      }
    };
    const fontLoad = (async () => {
      try {
        const families = [heading ? 'BrochureBrandHeading' : '', body ? 'BrochureBrandBody' : ''].filter(Boolean);
        await Promise.all(families.map((family) => document.fonts.load(`16px "${family}"`, 'MAVINCI ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż')));
        await document.fonts.ready;
        return true;
      } catch { return false; }
    })();
    let fontTimer: ReturnType<typeof setTimeout> | undefined;
    const [fontsReady] = await Promise.all([
      Promise.race([fontLoad, new Promise<boolean>((resolve) => { fontTimer = setTimeout(() => resolve(false), 80_000); })]),
      Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker)),
    ]);
    if (fontTimer !== undefined) clearTimeout(fontTimer);
    return { failures, fontsReady };
  }, { fallbacks: Object.fromEntries([...sources].map(([url, source]) => [url, source.originalUrl])), heading, body });

  const issues = new Map<string, BrochureValidationIssue>();
  for (const failure of result.failures) {
    const reference = references.find((entry) => entry.key === failure.pageKey);
    const status = statuses.get(failure.lastSource);
    const missing = status === 404 || status === 410;
    const denied = status === 401 || status === 403;
    const invalid = !failure.timedOut && status !== undefined && status >= 200 && status < 300;
    const reason = missing ? 'missing' : denied ? 'access' : invalid ? 'invalid_image' : 'temporary';
    const field = failure.logo ? 'logo' : 'imagePath';
    const id = failure.logo ? 'brand:logo' : `${failure.pageKey}:image`;
    if (issues.has(id)) continue;
    issues.set(id, {
      id, pageKey: failure.pageKey, pageNumber: reference?.number || null,
      pageTitle: reference?.title || 'Broszura', field,
      element: failure.logo ? 'Logo marki (wspólne dla stron)' : failure.pageKey.startsWith('product:') ? 'Zdjęcie usługi' : 'Zdjęcie strony',
      fileName: sources.get(failure.source)?.fileName || brochureFileName(failure.source),
      ...(failure.logo ? { companyId } : {}), reason,
      message: missing ? 'Plik nie istnieje już pod zapisanym adresem.'
        : denied ? 'Serwer odmówił dostępu do tego pliku.'
          : invalid ? 'Plik został pobrany, ale przeglądarka nie rozpoznaje go jako poprawnego obrazu.'
            : failure.timedOut ? 'Przekroczono czas pobierania obrazu, również po ponowieniu.'
              : 'Nie udało się pobrać obrazu mimo ponowienia żądania.',
      remedy: denied ? 'Sprawdź uprawnienia do biblioteki. Nie usuwaj zdjęcia — samo ponowne wgranie nie naprawi uprawnień.'
        : reason === 'temporary' ? 'Użyj „Sprawdź broszurę” ponownie za chwilę. To może być chwilowa niedostępność serwera, nie błąd Twoich danych.'
          : failure.logo ? 'Otwórz brandbook wybranej marki i popraw plik logo używany w broszurze.'
            : 'Otwórz wskazaną stronę i wybierz aktualne zdjęcie z biblioteki albo wgraj poprawny plik JPG, PNG lub WebP. Następnie zapisz broszurę.',
    });
  }
  if (!result.fontsReady) issues.set('brand:font', {
    id: 'brand:font', pageKey: 'cover', pageNumber: null, pageTitle: 'Cała broszura',
    field: 'font', element: 'Czcionki marki', companyId, reason: 'font',
    message: 'Nie udało się zastosować czcionek w dokumencie.',
    remedy: 'Sprawdź ponownie. Jeśli problem wraca, sprawdź pliki czcionek w brandbooku marki.',
  });
  return [...issues.values()];
}
