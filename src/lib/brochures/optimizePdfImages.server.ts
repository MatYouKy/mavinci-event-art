import 'server-only';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Page } from 'playwright';

// Decimal MB: a saved file must not exceed the requested 30 MB.
export const BROCHURE_PDF_SIZE_LIMIT = 30_000_000;
export const BROCHURE_IMAGE_PROFILES = [
  { dpi: 160, maxEdge: 1800, quality: 82 },
  { dpi: 130, maxEdge: 1450, quality: 74 },
  { dpi: 110, maxEdge: 1200, quality: 66 },
] as const;
type Profile = typeof BROCHURE_IMAGE_PROFILES[number];
type Asset = { bytes: Buffer; mime: string; width: number; height: number; transparent: boolean; vector: boolean };
type Placement = { index: number; source: string; width: number; height: number; logo: boolean };
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const sourceKey = (value: string) => {
  if (value.startsWith('data:')) return value;
  const url = new URL(value); url.hash = ''; return url.href;
};

async function prepareAsset(bytes: Buffer, mime: string, logo: boolean): Promise<Asset> {
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('Źródłowe zdjęcie przekracza limit przetwarzania.');
  // Preserve SVG logos/illustrations as vectors, including their transparency.
  if (mime.split(';')[0].trim().toLowerCase() === 'image/svg+xml') {
    return { bytes, mime: 'image/svg+xml', width: 0, height: 0, transparent: true, vector: true };
  }
  // Decode only downloaded bytes, never arbitrary filesystem paths or URLs.
  const image = await loadImage(bytes);
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (!width || !height || width * height > 64_000_000) throw new Error('Nieprawidłowe lub zbyt duże wymiary zdjęcia.');
  const scale = Math.min(1, (logo ? 1000 : 1800) / Math.max(width, height));
  const canvas = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  try {
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 255) { transparent = true; break; }
    }
    // Product photos use small WebP render copies. Raster logos stay lossless.
    return { bytes: logo ? await canvas.encode('png') : await canvas.encode('webp', 86),
      mime: logo ? 'image/png' : 'image/webp', width: canvas.width, height: canvas.height, transparent, vector: false };
  } finally { canvas.width = 1; canvas.height = 1; }
}

async function printAsset(asset: Asset, placements: Placement[], profile: Profile) {
  const logo = placements.every(item => item.logo);
  const requiredScale = Math.max(...placements.map(item =>
    Math.max(item.width / asset.width, item.height / asset.height) * profile.dpi / 96));
  const scale = Math.min(1, requiredScale, (logo ? 800 : profile.maxEdge) / Math.max(asset.width, asset.height));
  const width = Math.max(1, Math.ceil(asset.width * scale)), height = Math.max(1, Math.ceil(asset.height * scale));
  const canvas = createCanvas(width, height);
  try {
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(await loadImage(asset.bytes), 0, 0, width, height);
    // PDF/Chromium can inflate decoded WebP pixels. JPEG is embedded efficiently
    // for opaque photographs; PNG preserves alpha and sharp raster logos.
    const png = asset.transparent || logo;
    const bytes = png ? await canvas.encode('png') : await canvas.encode('jpeg', profile.quality);
    return { bytes, mime: png ? 'image/png' : 'image/jpeg' };
  } finally { canvas.width = 1; canvas.height = 1; }
}

/**
 * Request-local derivatives only: no originals, library objects, saved PDFs,
 * seller attribution or snapshot URLs are overwritten.
 */
export async function installBrochureImageOptimization(page: Page, logoSources: string[]) {
  const logos = new Set(logoSources.filter(Boolean).map(sourceKey));
  const assets = new Map<string, Asset>();
  const pending = new Map<string, Promise<Asset | null>>();
  const failures = new Set<string>();
  let cacheBytes = 0;
  // Native decoding is memory-heavy; bound it separately from downloads.
  let decoding = 0;
  const decodeQueue: Array<() => void> = [];
  const prepareBounded = async (bytes: Buffer, mime: string, logo: boolean) => {
    if (decoding < 2) decoding++;
    else await new Promise<void>(resolve => decodeQueue.push(resolve));
    try { return await prepareAsset(bytes, mime, logo); }
    finally {
      const next = decodeQueue.shift();
      if (next) next(); else decoding--;
    }
  };
  const remember = (key: string, asset: Asset) => {
    if (cacheBytes + asset.bytes.byteLength > MAX_CACHE_BYTES) throw new Error('Przekroczono budżet pamięci obrazów broszury.');
    cacheBytes += asset.bytes.byteLength; assets.set(key, asset); return asset;
  };

  // Both the transformed URL and the original fallback pass through this path.
  // A temporary Storage transformation failure cannot embed a full-size photo.
  await page.route('**/*', async route => {
    const request = route.request();
    if (request.resourceType() !== 'image' || !/^https?:/i.test(request.url())) return route.continue();
    const key = sourceKey(request.url());
    try {
      const cached = assets.get(key);
      if (cached) return await route.fulfill({ status: 200, contentType: cached.mime, body: cached.bytes });
      const existing = pending.get(key);
      if (existing) {
        const asset = await existing;
        if (asset) return await route.fulfill({ status: 200, contentType: asset.mime, body: asset.bytes });
        return await route.abort('failed');
      }
      let resolvePending!: (asset: Asset | null) => void;
      pending.set(key, new Promise(resolve => { resolvePending = resolve; }));
      try {
        const response = await route.fetch({ timeout: 12_000, maxRedirects: 5 });
        try {
          if (!response.ok()) { await route.fulfill({ response }); return; }
          if (Number(response.headers()['content-length']) > MAX_SOURCE_BYTES) throw new Error('Źródłowe zdjęcie przekracza limit przetwarzania.');
          const bytes = await response.body();
          const asset = await prepareBounded(bytes, response.headers()['content-type'] || '', logos.has(key))
            .then(prepared => remember(key, prepared))
            .catch(error => { failures.add(key); throw error; });
          resolvePending(asset);
          await route.fulfill({ status: 200, contentType: asset.mime, body: asset.bytes });
        } finally { await response.dispose(); }
      } finally { resolvePending(null); pending.delete(key); }
    } catch {
      // The validator retains page/file attribution. Never fall back to an
      // uncompressed success, and never expose signed URLs in the error.
      await route.abort('failed').catch(() => {});
    }
  });

  let placements: Placement[] | null = null;
  return {
    failedSources: failures,
    async apply(profile: Profile) {
      if (!placements) placements = await page.evaluate(() => Array.from(document.images).map((image, index) => {
        const bounds = image.getBoundingClientRect();
        return { index, source: image.currentSrc || image.src, width: bounds.width, height: bounds.height,
          logo: image.classList.contains('logo') };
      }));
      const groups = new Map<string, Placement[]>();
      for (const item of placements) {
        if (!item.source || item.width <= 0 || item.height <= 0) continue;
        const key = sourceKey(item.source);
        const group = groups.get(key) || []; group.push(item); groups.set(key, group);
      }
      let optimized = 0;
      // Sequential encoding bounds native and browser memory on long brochures.
      for (const [key, group] of Array.from(groups.entries())) {
        let asset = assets.get(key);
        if (!asset && key.startsWith('data:')) {
          const match = key.match(/^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i);
          if (!match || match[3].length > MAX_SOURCE_BYTES * 4 / 3 + 16) throw new Error('Nie można zoptymalizować osadzonego zdjęcia.');
          asset = remember(key, await prepareBounded(match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8'),
            match[1], group.every(item => item.logo)));
        }
        if (!asset) throw new Error('Brak przygotowanej kopii zdjęcia. Ponów generowanie broszury.');
        if (asset.vector) continue;
        const printed = await printAsset(asset, group, profile);
        const dataUrl = 'data:' + printed.mime + ';base64,' + printed.bytes.toString('base64');
        await page.evaluate(async ({ indexes, dataUrl }) => {
          const images = Array.from(document.images);
          await Promise.all(indexes.map(index => new Promise<void>((resolve, reject) => {
            const image = images[index];
            if (!image) { reject(new Error('Brak obrazu na stronie.')); return; }
            const timer = setTimeout(() => { image.onload = null; image.onerror = null; reject(new Error('Przekroczono czas odczytu obrazu.')); }, 10_000);
            image.onload = () => { clearTimeout(timer); image.onload = null; image.onerror = null; resolve(); };
            image.onerror = () => { clearTimeout(timer); image.onload = null; image.onerror = null; reject(new Error('Nieprawidłowy obraz.')); };
            image.src = dataUrl;
          })));
        }, { indexes: group.map(item => item.index), dataUrl });
        optimized++;
      }
      return optimized;
    },
  };
}
