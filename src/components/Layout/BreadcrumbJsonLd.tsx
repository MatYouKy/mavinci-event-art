interface BreadcrumbJsonLdProps {
  items: { name: string; href: string }[];
  baseUrl: string;
}

export function BreadcrumbJsonLd({ items, baseUrl }: BreadcrumbJsonLdProps) {
  if (!items || items.length === 0) return null;

  const normalizedBase = baseUrl.replace(/\/$/, '');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${normalizedBase}${
        item.href.startsWith('/') ? item.href : `/${item.href}`
      }`,
    })),
  };

  return (

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

  );
}