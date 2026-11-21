import 'server-only';
import { evaluateInBrowser } from '@/lib/print/pdfRenderer.server';

/*
 * Zdjęcia realizacji na stronę: z pliku z dysku, telefonu, Materiałów, plików wydarzenia albo biblioteki social media —
 * na serwerze Next, w tym samym Chromium co render grafik (orientacja EXIF jak w przeglądarce). Trzy wersje WebP jak
 * dotychczasowy edytor strony (`uploadOptimizedImage`): komputer 2200 px, telefon 800 px, miniatura 700 px (dłuższy bok).
 */

const PROCESS_SOURCE = String.raw`async function (input) {
  var img = new Image();
  img.src = input.src;
  await img.decode();
  var W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) throw new Error('empty');
  function webp(maxSide, quality) {
    var scale = Math.min(1, maxSide / Math.max(W, H));
    var w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var g = canvas.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    var url = canvas.toDataURL('image/webp', quality);
    if (url.indexOf('data:image/webp') !== 0) throw new Error('webp');
    return url.split(',')[1];
  }
  return { width: W, height: H, desktop: webp(2200, 0.85), mobile: webp(800, 0.85), thumb: webp(700, 0.82) };
}`;

type BrowserResult = { width: number; height: number; desktop: string; mobile: string; thumb: string };

export type ProcessedPortfolioPhoto = { width: number; height: number; desktop: Buffer; mobile: Buffer; thumb: Buffer };

/** Wersje WebP zdjęcia (JPEG, PNG albo WebP). Błąd ze `status: 422`, gdy obrazu nie da się odczytać. */
export async function processPortfolioPhoto(bytes: Buffer, mimeType: string): Promise<ProcessedPortfolioPhoto> {
  let result: BrowserResult;
  try {
    result = await evaluateInBrowser<unknown, BrowserResult>(PROCESS_SOURCE, {
      src: `data:${mimeType};base64,${bytes.toString('base64')}`,
    }, 90_000);
  } catch (error) {
    console.error('[portfolio-photo]', error);
    throw Object.assign(new Error('Nie udało się odczytać zdjęcia. Zapisz je jako JPEG, PNG albo WebP i spróbuj ponownie.'), { status: 422 });
  }
  if (!result?.width || !result?.height || !result.desktop || !result.mobile || !result.thumb) {
    throw Object.assign(new Error('Nie udało się odczytać zdjęcia.'), { status: 422 });
  }
  return {
    width: result.width,
    height: result.height,
    desktop: Buffer.from(result.desktop, 'base64'),
    mobile: Buffer.from(result.mobile, 'base64'),
    thumb: Buffer.from(result.thumb, 'base64'),
  };
}
