// src/lib/breadcrumbs.ts

export type BreadcrumbEntry = {
  name: string;
  href: string; // może być względny (/oferta) albo absolutny (https://...)
};

/**
 * Buduje pełne URL na podstawie baseUrl i href.
 * - jeśli href zaczyna się od http – zostawiamy jak jest
 * - jeśli jest względny – doklejamy do baseUrl
 */
export function resolveUrl(baseUrl: string, href: string): string {
  if (!href) return baseUrl;

  // już pełny URL
  if (/^https?:\/\//i.test(href)) return href;

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedHref = href.replace(/^\/+/, '');

  return `${normalizedBase}/${normalizedHref}`;
}

/**
 * Generator danych strukturalnych BreadcrumbList (JSON-LD)
 */
export function buildBreadcrumbJsonLd(
  items: BreadcrumbEntry[],
  baseUrl: string
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: resolveUrl(baseUrl, item.href),
    })),
  };
}