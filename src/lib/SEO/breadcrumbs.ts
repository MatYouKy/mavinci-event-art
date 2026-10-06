const SITE_URL = 'https://mavinci.pl';

const LABELS: Record<string, string> = {
  'o-nas': 'O nas',
  zespol: 'Zespół',
  oferta: 'Oferta',
  konferencje: 'Konferencje',
  kasyno: 'Kasyno',
  zasady: 'Zasady',
  streaming: 'Streaming',
  integracje: 'Integracje',
  'dj-eventowy': 'DJ eventowy',
  'technika-sceniczna': 'Technika sceniczna',
  'quizy-teleturnieje': 'Quizy i teleturnieje',
  'wieczory-tematyczne': 'Wieczory tematyczne',
  'symulatory-vr': 'Symulatory VR',
  portfolio: 'Portfolio',
  uslugi: 'Usługi',
  'dla-agencji-i-hoteli': 'Dla agencji i hoteli',
  olsztyn: 'Olsztyn', ostroda: 'Ostróda', ilawa: 'Iława', gizycko: 'Giżycko',
  elk: 'Ełk', ketrzyn: 'Kętrzyn', mragowo: 'Mrągowo', mikolajki: 'Mikołajki',
  elblag: 'Elbląg', szczytno: 'Szczytno',
};

function startCaseFromSlug(slug: string) {
  // city / slug -> "Nowy Sacz" itd. (bez polskich ogonków, bo slug)
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function buildBreadcrumbList(pathname?: string) {
  // 🔐 fallback
  const safePath = pathname && typeof pathname === 'string' ? pathname : '/';

  const clean = safePath.split('?')[0].split('#')[0];
  const parts = clean.split('/').filter(Boolean);

  const items: Array<{ name: string; item: string }> = [
    {
      name: 'Strona główna',
      item: 'https://mavinci.pl',
    },
  ];

  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    items.push({
      name: LABELS[part] || startCaseFromSlug(part),
      item: `https://mavinci.pl${acc}`,
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${SITE_URL}${clean}#breadcrumb`,
    itemListElement: items.map((x, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: x.name,
      item: x.item,
    })),
  };
}