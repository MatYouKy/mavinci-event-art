interface BreadcrumbJsonLdProps {
  items: { name: string; href: string }[];
  baseUrl: string;
}

export function BreadcrumbJsonLd({ items, baseUrl }: BreadcrumbJsonLdProps) {
  if (!items?.length) return null;

  const normalizedBase = baseUrl.replace(/\/$/, '');

  const itemListElement = items.map((it, index) => {
    const isLast = index === items.length - 1;
    const href = (it.href ?? '').trim();

    const isInvalidHref =
      href === '' || href === '#' || href === '/#';

    const url = !isInvalidHref
      ? `${normalizedBase}${href.startsWith('/') ? href : `/${href}`}`
      : undefined;

    return {
      '@type': 'ListItem',
      position: index + 1,
      name: it.name,

      // ⭐ KLUCZOWA ZMIANA
      ...(!isLast && url
        ? {
            item: {
              '@id': url,
              name: it.name,
            },
          }
        : {}),
    };
  });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
