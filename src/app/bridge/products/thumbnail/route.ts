import { cookies } from 'next/headers';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const BUCKET = 'offer-product-pages';
const widths = new Set([128, 192, 640, 680]);
const cache = new Map<string, { data: Uint8Array; expires: number }>();
const pending = new Map<string, Promise<Uint8Array | null>>();
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
let cacheBytes = 0;

// Accept only objects from our own bucket; this endpoint cannot proxy arbitrary URLs.
function objectPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let path = value.trim();
  if (/^https?:/i.test(path)) {
    try {
      const url = new URL(path);
      const storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
      if (url.origin !== storageOrigin) return null;
      const match = url.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/offer-product-pages\/(.+)$/);
      if (!match) return null;
      path = decodeURIComponent(match[1]);
    } catch { return null; }
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) return null;
    path = path.replace(/^\/+/, '').replace(/^(?:public\/)?offer-product-pages\//, '');
  }
  if (!path || path.split('/').some(segment => segment === '..' || segment === '.') || path.includes('\\')) return null;
  return path;
}
function remember(key: string, data: Uint8Array) {
  const old = cache.get(key);
  if (old) { cacheBytes -= old.data.byteLength; cache.delete(key); }
  if (data.byteLength > MAX_CACHE_BYTES) return;
  for (const [k, value] of cache) {
    if (value.expires <= Date.now()) { cacheBytes -= value.data.byteLength; cache.delete(k); }
  }
  while (cache.size >= 200 || cacheBytes + data.byteLength > MAX_CACHE_BYTES) {
    const first = cache.entries().next().value;
    if (!first) break;
    cacheBytes -= first[1].data.byteLength; cache.delete(first[0]);
  }
  cache.set(key, { data, expires: Date.now() + 3600_000 }); cacheBytes += data.byteLength;
}
const fail = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), id = url.searchParams.get('id') || '', width = Number(url.searchParams.get('w'));
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || !widths.has(width)) return fail(400);
    if (request.headers.get('sec-fetch-site') === 'cross-site') return fail(403);
    const client = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return fail(401);
    // RLS is evaluated on every server request, even when image bytes are cached.
    const { data: product, error } = await client.from('offer_products')
      .select('id,offer_image_path,pdf_thumbnail_url,updated_at').eq('id', id).maybeSingle();
    if (error || !product) return fail(404);
    const paths = [...new Set([product.offer_image_path, product.pdf_thumbnail_url].map(objectPath).filter((p): p is string => Boolean(p)))];
    if (!paths.length) return fail(404);
    const key = JSON.stringify([auth.user.id, product.id, product.updated_at, paths, width]);
    let bytes = cache.get(key);
    if (bytes && bytes.expires <= Date.now()) { cacheBytes -= bytes.data.byteLength; cache.delete(key); bytes = undefined; }
    let data = bytes?.data;
    if (!data) {
      let work = pending.get(key);
      if (!work) {
        work = (async () => {
          for (const path of paths) {
            try {
              const { data: source, error } = await client.storage.from(BUCKET).download(path);
              if (error || !source || source.size > 20 * 1024 * 1024) continue;
              const buffer = Buffer.from(await source.arrayBuffer());
              // Raster images only: never decode SVGs with external references.
              const raster = buffer.subarray(0, 3).equals(Buffer.from([0xff,0xd8,0xff]))
                || buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
                || (buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP')
                || ['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6))
                || (buffer.toString('ascii',4,8)==='ftyp' && ['avif','avis'].includes(buffer.toString('ascii',8,12)));
              if (!raster) continue;
              const image = await loadImage(buffer);
              if (!image.width || !image.height || image.width * image.height > 40_000_000) continue;
              const scale = Math.min(1, width / image.width, width / image.height);
              const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
              const context = canvas.getContext('2d');
              context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
              context.drawImage(image, 0, 0, canvas.width, canvas.height);
              const result = new Uint8Array(await canvas.encode('webp', 65));
              remember(key, result); return result;
            } catch { /* Try the existing PDF thumbnail, still resized before delivery. */ }
          }
          return null;
        })().finally(() => { pending.delete(key); });
        pending.set(key, work);
      }
      data = (await work) || undefined;
    }
    if (!data) return fail(404);
    return new Response(new Uint8Array(data).buffer, { headers: {
      'Content-Type': 'image/webp', 'Content-Length': String(data.byteLength),
      'Cache-Control': 'private, max-age=300', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return fail(500); }
}
