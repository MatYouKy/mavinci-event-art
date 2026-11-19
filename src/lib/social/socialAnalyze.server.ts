import 'server-only';
import { createHash } from 'node:crypto';
import { evaluateInBrowser } from '@/lib/print/pdfRenderer.server';
import { SOCIAL_FORMATS, SOCIAL_FORMAT_INFO, type SocialCrops, type SocialFormat } from './socialShared';

/*
 * Analiza zdjęcia do biblioteki social media — raz, na serwerze Next, w tym samym Chromium co render grafik:
 * wymiary (z orientacją EXIF), wersja robocza do 3200 px (JPEG, bez EXIF — z niej powstają grafiki), miniatura 640 px
 * i propozycje kadrów 4:5, 1:1, 9:16, 1,91:1. Kadr: największy prostokąt formatu przesuwany po mapie „uwagi”
 * (krawędzie, nasycenie, odcienie skóry), z lekką preferencją środka — te same propozycje widzą web, Mac i telefon.
 */

export type SocialImageAnalysis = {
  width: number;
  height: number;
  work: Buffer;
  thumbnail: Buffer;
  crops: SocialCrops;
  sha256: string;
};

const ANALYZE_SOURCE = String.raw`async function (input) {
  var img = new Image();
  img.src = input.src;
  await img.decode();
  var W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) throw new Error('empty');
  function jpeg(maxSide, quality) {
    var scale = Math.min(1, maxSide / Math.max(W, H));
    var w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality).split(',')[1];
  }
  var work = jpeg(input.workSide, 0.9);
  var thumb = jpeg(input.thumbSide, 0.82);
  var side = 160;
  var sw = W >= H ? side : Math.max(8, Math.round(side * W / H));
  var sh = W >= H ? Math.max(8, Math.round(side * H / W)) : side;
  var c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  var cg = c.getContext('2d');
  cg.drawImage(img, 0, 0, sw, sh);
  var px = cg.getImageData(0, 0, sw, sh).data;
  var lum = new Float32Array(sw * sh), energy = new Float32Array(sw * sh);
  for (var i = 0; i < sw * sh; i++) {
    var r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
  }
  for (var y = 0; y < sh; y++) {
    for (var x = 0; x < sw; x++) {
      var k = y * sw + x;
      var r2 = px[k * 4], g2 = px[k * 4 + 1], b2 = px[k * 4 + 2];
      var mx = Math.max(r2, g2, b2), mn = Math.min(r2, g2, b2);
      var edge = (x + 1 < sw ? Math.abs(lum[k] - lum[k + 1]) : 0) + (y + 1 < sh ? Math.abs(lum[k] - lum[k + sw]) : 0);
      var sat = mx > 0 ? (mx - mn) / mx : 0;
      var skin = r2 > 95 && g2 > 40 && b2 > 20 && r2 > g2 && r2 > b2 && Math.abs(r2 - g2) > 15 && mx - mn > 15 ? 1 : 0;
      var bright = lum[k] > 235 || lum[k] < 12 ? 0.4 : 1;
      energy[k] = (edge * 1.0 + sat * 40 + skin * 90) * bright;
    }
  }
  var integral = new Float64Array((sw + 1) * (sh + 1));
  for (var yy = 1; yy <= sh; yy++) {
    var row = 0;
    for (var xx = 1; xx <= sw; xx++) {
      row += energy[(yy - 1) * sw + (xx - 1)];
      integral[yy * (sw + 1) + xx] = integral[(yy - 1) * (sw + 1) + xx] + row;
    }
  }
  function sum(x0, y0, x1, y1) {
    return integral[y1 * (sw + 1) + x1] - integral[y0 * (sw + 1) + x1] - integral[y1 * (sw + 1) + x0] + integral[y0 * (sw + 1) + x0];
  }
  var total = sum(0, 0, sw, sh) || 1;
  var crops = {};
  input.formats.forEach(function (f) {
    var aspect = f.aspect, imageAspect = W / H;
    var cw, ch;
    if (imageAspect > aspect) { ch = 1; cw = aspect / imageAspect; } else { cw = 1; ch = imageAspect / aspect; }
    var best = null;
    var steps = 48;
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      var nx = cw < 1 ? (1 - cw) * t : 0;
      var ny = ch < 1 ? (1 - ch) * t : 0;
      if (cw >= 1 && ch >= 1 && s > 0) break;
      var x0 = Math.round(nx * sw), y0 = Math.round(ny * sh);
      var x1 = Math.min(sw, Math.round((nx + cw) * sw)), y1 = Math.min(sh, Math.round((ny + ch) * sh));
      var score = sum(x0, y0, x1, y1) / total;
      var offset = cw < 1 ? Math.abs(nx + cw / 2 - 0.5) / Math.max(0.0001, (1 - cw) / 2) : ch < 1 ? Math.abs(ny + ch / 2 - 0.42) / Math.max(0.0001, (1 - ch) / 2) : 0;
      score = score * (1 - 0.12 * Math.min(1, offset));
      if (!best || score > best.score) best = { score: score, x: nx, y: ny };
    }
    function r4(v) { return Math.round(v * 10000) / 10000; }
    crops[f.format] = { x: r4(best.x), y: r4(best.y), w: r4(Math.min(1, cw)), h: r4(Math.min(1, ch)) };
  });
  return { width: W, height: H, work: work, thumb: thumb, crops: crops };
}`;

type BrowserResult = { width: number; height: number; work: string; thumb: string; crops: SocialCrops };

/** Analiza pliku zdjęcia (JPEG, PNG, WebP). Błąd ze `status: 422`, gdy przeglądarka nie potrafi odczytać obrazu. */
export async function analyzeSocialImage(bytes: Buffer, mimeType: string): Promise<SocialImageAnalysis> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ? mimeType : 'image/jpeg';
  let result: BrowserResult;
  try {
    result = await evaluateInBrowser<unknown, BrowserResult>(ANALYZE_SOURCE, {
      src: `data:${mime};base64,${bytes.toString('base64')}`,
      workSide: 3200,
      thumbSide: 640,
      formats: SOCIAL_FORMATS.map((format: SocialFormat) => ({
        format,
        aspect: SOCIAL_FORMAT_INFO[format].width / SOCIAL_FORMAT_INFO[format].height,
      })),
    }, 90_000);
  } catch (error) {
    console.error('[social-analyze]', error);
    throw Object.assign(new Error('Nie udało się odczytać zdjęcia. Zapisz je jako JPEG, PNG albo WebP i spróbuj ponownie.'), { status: 422 });
  }
  if (!result?.width || !result?.height || !result.work || !result.thumb) {
    throw Object.assign(new Error('Nie udało się odczytać zdjęcia.'), { status: 422 });
  }
  return {
    width: result.width,
    height: result.height,
    work: Buffer.from(result.work, 'base64'),
    thumbnail: Buffer.from(result.thumb, 'base64'),
    crops: result.crops,
    sha256,
  };
}
