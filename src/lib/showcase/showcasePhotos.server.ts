import 'server-only';
import { evaluateInBrowser } from '@/lib/print/pdfRenderer.server';

/*
 * Zdjęcia prezentacji (Strefa sprzedawcy → Prezentacje): z pliku z dysku, Findera, Materiałów, plików wydarzenia albo
 * biblioteki social media — na serwerze Next, w tym samym Chromium co render grafik i zdjęcia Realizacji (orientacja EXIF jak
 * w przeglądarce). Dwie wersje WebP: duża 2560 px (pełny ekran iPada Pro 13″ w poziomie) i miniatura 640 px (dłuższy bok).
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
    return { data: url.split(',')[1], width: w, height: h };
  }
  var display = webp(2560, 0.86);
  var thumb = webp(640, 0.8);
  return { width: display.width, height: display.height, display: display.data, thumb: thumb.data };
}`;

type BrowserResult = { width: number; height: number; display: string; thumb: string };

export type ProcessedShowcasePhoto = { width: number; height: number; display: Buffer; thumb: Buffer };

/** Wersje WebP zdjęcia (JPEG, PNG albo WebP). Błąd ze `status: 422`, gdy obrazu nie da się odczytać. */
export async function processShowcasePhoto(bytes: Buffer, mimeType: string): Promise<ProcessedShowcasePhoto> {
  let result: BrowserResult;
  try {
    result = await evaluateInBrowser<unknown, BrowserResult>(PROCESS_SOURCE, {
      src: `data:${mimeType};base64,${bytes.toString('base64')}`,
    }, 90_000);
  } catch (error) {
    console.error('[showcase-photo]', error);
    throw Object.assign(new Error('Nie udało się odczytać zdjęcia. Zapisz je jako JPEG, PNG albo WebP i spróbuj ponownie.'), { status: 422 });
  }
  if (!result?.width || !result?.height || !result.display || !result.thumb) {
    throw Object.assign(new Error('Nie udało się odczytać zdjęcia.'), { status: 422 });
  }
  return {
    width: result.width,
    height: result.height,
    display: Buffer.from(result.display, 'base64'),
    thumb: Buffer.from(result.thumb, 'base64'),
  };
}
