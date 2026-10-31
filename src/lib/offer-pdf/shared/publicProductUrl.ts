/** Stable public descriptions: never link a customer to seller prices or login. */
export function publicProductUrl(productId: unknown): string {
  return typeof productId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)
    ? `https://mavinci.pl/produkty/${encodeURIComponent(productId)}` : '';
}
