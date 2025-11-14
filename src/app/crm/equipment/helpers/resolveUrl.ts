// components/UI/Image/helpers/resolveUrl.ts
export function resolveUrl(src?: string | null): string {
  if (!src) return '';
  // już pełny URL albo blob/data:
  if (/^(blob:|data:|https?:\/\/)/i.test(src)) return src;

  // baza do plików (np. http://127.0.0.1:8081)
  const base =
    process.env.NEXT_PUBLIC_FILES_BASE ||
    process.env.NEXT_PUBLIC_API_BASE ||
    '';

  if (!base) return src.startsWith('/') ? src : `/${src}`;

  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const s = src.startsWith('/') ? src : `/${src}`;
  return `${b}${s}`;
}