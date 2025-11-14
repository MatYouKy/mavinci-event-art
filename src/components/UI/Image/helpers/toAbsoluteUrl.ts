export function toAbsoluteUrl(src?: string | null): string | null {
  if (!src) return null;
  // zostaw blob:, data:, http(s)
  if (/^(blob:|data:|https?:\/\/)/i.test(src)) return src;
  const base = (process.env.NEXT_PUBLIC_SERVER_URL || '').replace(/\/$/, '');
  return src.startsWith('/') ? `${base}${src}` : `${base}/${src}`;
}