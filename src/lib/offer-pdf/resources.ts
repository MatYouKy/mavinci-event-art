import 'server-only';

const LIMIT = 64 * 1024 * 1024;
const MAX_ASSET = 24 * 1024 * 1024;
const TTL = 5 * 60 * 1000;
const assets = new Map<string, { bytes: ArrayBuffer; expires: number }>();
let size = 0;
// Keys include the full signed URL: a different authorization cannot reuse its cache entry.
export async function cachedAsset(url: string, timeout: number, restrictRedirects = false): Promise<ArrayBuffer> {
  const key = `${restrictRedirects}:${url}`;
  const existing = assets.get(key);
  if (existing && existing.expires > Date.now()) return existing.bytes.slice(0);
  if (existing) { assets.delete(key); size -= existing.bytes.byteLength; }
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeout), redirect: restrictRedirects ? 'error' : 'follow' });
  if (!response.ok || !response.body) throw new Error(`Nie udało się pobrać zasobu PDF (${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_ASSET) { await reader.cancel(); throw new Error('Zasób PDF przekracza 24 MB. Zmniejsz rozmiar grafiki.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  while (size + length > LIMIT && assets.size) {
    const oldest = assets.keys().next().value!; size -= assets.get(oldest)!.bytes.byteLength; assets.delete(oldest);
  }
  // Demo uploads are request-specific and must not occupy the shared cache.
  if (!url.startsWith('data:')) { assets.set(key, { bytes: bytes.buffer, expires: Date.now() + TTL }); size += length; }
  return bytes.buffer.slice(0);
}

const signedUrls = new Map<string, { value: any; expires: number }>();
export async function cachedSignedAssetUrls(key: string, load: () => Promise<any>) {
  const entry = signedUrls.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  const value = await load();
  if (value.every((result: any) => !result.error && result.data?.signedUrl)) {
    if (signedUrls.size >= 256) signedUrls.delete(signedUrls.keys().next().value!);
    signedUrls.set(key, { value, expires: Date.now() + TTL });
  }
  return value;
}
