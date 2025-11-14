// utils/resolveUrl.ts
export function resolveUrl(src?: string | null): string {
  if (!src) return '';
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  // np. '/uploads/...' -> `${SERVER}/uploads/...`
  const base = process.env.NEXT_PUBLIC_SERVER_URL?.replace(/\/$/, '') ?? '';
  return `${base}${src.startsWith('/') ? '' : '/'}${src}`;
}