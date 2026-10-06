/** Build local links only, from the service catalog's public slugs. */
export function servicePagePath(slug: unknown): string | null {
  return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? `/oferta/${slug}` : null;
}

/** Optional marketing link; keep navigation on the public Mavinci website. */
export function relatedServicePagePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  if (!input.startsWith('/') && !/^https:\/\//i.test(input)) return null;
  if (input.includes('\\')) return null;
  try {
    const url = new URL(input, 'https://mavinci.pl');
    if (url.protocol !== 'https:' || !['mavinci.pl', 'www.mavinci.pl'].includes(url.hostname)
      || url.port || url.username || url.password) return null;
    if (!/^\/(oferta|uslugi)\/[^/]+/.test(url.pathname)) return null;
    return url.pathname.replace(/\/+$/, '') + url.search + url.hash;
  } catch { return null; }
}
