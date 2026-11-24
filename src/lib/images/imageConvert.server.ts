import 'server-only';
import { evaluateInBrowser } from '@/lib/print/pdfRenderer.server';

/*
 * Zdjęcia na serwerze Next — w tym samym Chromium co render PDF, zdjęcia Prezentacji i miniatury Materiałów (orientacja EXIF
 * jak w przeglądarce):
 * - `webpVersion` — lekka wersja WebP do sieci (np. zdjęcie produktu z Dysku),
 * - `pdfReadyImage` — JPEG albo PNG do PDF: format PDF (i pdf-lib) nie przyjmuje WebP, GIF, AVIF ani BMP, więc takie zdjęcie
 *   zamienia się w JPEG (z przezroczystością — w PNG). JPEG i PNG przechodzą bez zmian.
 */

export type SniffedImage = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif' | 'image/bmp';

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...Array.from(bytes.subarray(start, end)));

/** Rodzaj obrazu z pierwszych bajtów (nie z nazwy ani nagłówka HTTP); nieznany — `null`. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 12))) return 'image/avif';
  if (ascii(bytes, 0, 2) === 'BM') return 'image/bmp';
  return null;
}

const CONVERT_SOURCE = String.raw`async function (input) {
  var img = new Image();
  img.src = input.src;
  await img.decode();
  var W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) throw new Error('empty');
  var scale = Math.min(1, input.maxSide / Math.max(W, H));
  var w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  var type = input.type;
  if (type === 'auto') {
    var pixels = g.getImageData(0, 0, w, h).data, alpha = false;
    for (var i = 3; i < pixels.length; i += 4) { if (pixels[i] < 255) { alpha = true; break; } }
    type = alpha ? 'image/png' : 'image/jpeg';
  }
  var url = canvas.toDataURL(type, input.quality);
  if (url.indexOf('data:' + type) !== 0) throw new Error('encode');
  return { type: type, width: w, height: h, data: url.split(',')[1] };
}`;

type Converted = { type: string; width: number; height: number; data: Buffer };

async function convert(bytes: Buffer, mime: SniffedImage, maxSide: number, type: 'image/webp' | 'auto', quality: number): Promise<Converted> {
  const result = await evaluateInBrowser<unknown, { type: string; width: number; height: number; data: string }>(CONVERT_SOURCE, {
    src: `data:${mime};base64,${bytes.toString('base64')}`, maxSide, type, quality,
  }, 90_000);
  if (!result?.data || !result.width || !result.height) throw new Error('Nie udało się odczytać zdjęcia.');
  return { type: result.type, width: result.width, height: result.height, data: Buffer.from(result.data, 'base64') };
}

/** Wersja WebP (dłuższy bok najwyżej `maxSide`). Błąd ze `status: 422`, gdy pliku nie da się odczytać jako zdjęcia. */
export async function webpVersion(bytes: Buffer, maxSide: number, quality = 0.86): Promise<{ data: Buffer; width: number; height: number }> {
  const mime = sniffImage(bytes);
  if (!mime) throw Object.assign(new Error('Ten plik nie jest zdjęciem JPEG, PNG ani WebP.'), { status: 422 });
  try {
    const result = await convert(bytes, mime, maxSide, 'image/webp', quality);
    return { data: result.data, width: result.width, height: result.height };
  } catch (error) {
    console.error('[image-convert] webp', error);
    throw Object.assign(new Error('Nie udało się przygotować zdjęcia. Zapisz je jako JPEG, PNG albo WebP i spróbuj ponownie.'), { status: 422 });
  }
}

/** Zdjęcie gotowe do PDF: JPEG i PNG bez zmian, inne formaty — JPEG (z przezroczystością — PNG), dłuższy bok do 2400 px. */
export async function pdfReadyImage(bytes: Uint8Array): Promise<{ bytes: Uint8Array; png: boolean }> {
  const mime = sniffImage(bytes);
  if (mime === 'image/png') return { bytes, png: true };
  if (mime === 'image/jpeg' || !mime) return { bytes, png: false };
  const result = await convert(Buffer.from(bytes), mime, 2400, 'auto', 0.9);
  return { bytes: new Uint8Array(result.data), png: result.type === 'image/png' };
}
