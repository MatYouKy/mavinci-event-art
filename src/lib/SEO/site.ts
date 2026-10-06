/** Public brand facts shared by the site, contact links and structured data. */
export const SITE = {
  url: 'https://mavinci.pl',
  name: 'MAVINCI Event & ART',
  telephone: '+48 698 212 279',
  phoneHref: 'tel:+48698212279',
  email: 'biuro@mavinci.pl',
  office: {
    street: 'ul. Towarowa 20B', postalCode: '10-417', city: 'Olsztyn',
    // Exact building pin supplied by the owner; the address covers several buildings.
    latitude: 53.781759, longitude: 20.531409,
    mapsUrl: 'https://maps.app.goo.gl/8LSdFQht6cgdHHDQ9',
    directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=53.781759%2C20.531409',
  },
  registeredOffice: { street: 'ul. Marcina Kasprzaka 15/66', postalCode: '10-057', city: 'Olsztyn' },
  facebook: 'https://www.facebook.com/Mavincieventart',
  title: 'Agencja eventowa Olsztyn – eventy i technika | MAVINCI',
  description: 'MAVINCI w Olsztynie: organizacja imprez firmowych, integracji i konferencji. Własne nagłośnienie, oświetlenie i ekrany LED. Zapytaj o obsługę swojego wydarzenia.',
} as const;

export const ORGANIZATION_ID = `${SITE.url}/#organization`;
export const OFFICE_ID = `${SITE.url}/#office`;
export const WEBSITE_ID = `${SITE.url}/#website`;

export function postalAddress(address: { street: string; postalCode: string; city: string }) {
  return { '@type': 'PostalAddress', streetAddress: address.street, postalCode: address.postalCode,
    addressLocality: address.city, addressRegion: 'warmińsko-mazurskie', addressCountry: 'PL' };
}

export function officialProfiles(config?: Record<string, any> | null): string[] {
  return Array.from(new Set([
    config?.facebook_url || SITE.facebook, config?.instagram_url, config?.linkedin_url,
    config?.youtube_url, config?.twitter_url,
  ].filter((value): value is string => {
    if (typeof value !== 'string') return false;
    try { const url = new URL(value); return url.protocol === 'https:' && url.pathname.replace(/\//g, '').length > 0; }
    catch { return false; }
  })));
}

export function buildSiteGraph(config?: Record<string, any> | null) {
  const registeredAddress = config?.street_address ? {
    '@type': 'PostalAddress', streetAddress: config.street_address,
    postalCode: config.postal_code, addressLocality: config.locality || 'Olsztyn',
    addressRegion: config.region || 'warmińsko-mazurskie', addressCountry: config.country || 'PL',
  } : postalAddress(SITE.registeredOffice);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': ORGANIZATION_ID, name: SITE.name, url: SITE.url,
        description: SITE.description, logo: `${SITE.url}/logo-mavinci-crm.png`,
        telephone: SITE.telephone, email: SITE.email, address: registeredAddress,
        location: { '@id': OFFICE_ID }, sameAs: officialProfiles(config),
        knowsAbout: ['Organizacja eventów', 'Obsługa konferencji', 'Nagłośnienie Meyer Sound',
          'Ekrany LED', 'Streaming wydarzeń', 'Technika sceniczna', 'Integracje firmowe'] },
      { '@type': 'LocalBusiness', '@id': OFFICE_ID, name: `${SITE.name} — biuro i magazyn`,
        url: `${SITE.url}/#kontakt`, telephone: SITE.telephone, email: SITE.email,
        image: `${SITE.url}/logo-mavinci-crm.png`, address: postalAddress(SITE.office),
        geo: { '@type': 'GeoCoordinates', latitude: SITE.office.latitude, longitude: SITE.office.longitude },
        hasMap: SITE.office.mapsUrl,
        branchOf: { '@id': ORGANIZATION_ID },
        areaServed: [{ '@type': 'City', name: 'Olsztyn' },
          { '@type': 'AdministrativeArea', name: 'województwo warmińsko-mazurskie' },
          { '@type': 'Country', name: 'Polska' }] },
      { '@type': 'WebSite', '@id': WEBSITE_ID, url: SITE.url, name: SITE.name,
        alternateName: 'MAVINCI', inLanguage: 'pl-PL', publisher: { '@id': ORGANIZATION_ID } },
    ],
  };
}

/** Existing page schemas refer to the shared company, never create a second address. */
export function normalizePageSchema(data: any, pageSlug: string): any {
  if (!data || typeof data !== 'object') return data;
  const path = pageSlug === 'home' ? '' : `/${pageSlug.replace(/^\/+/, '')}`;
  const isService = /^(oferta|uslugi)(\/|$)/.test(pageSlug);
  const root = ['LocalBusiness', 'Organization'].includes(data['@type']) ? {
    '@context': 'https://schema.org', '@type': isService ? 'Service' : 'WebPage',
    '@id': `${SITE.url}${path}#${isService ? 'service' : 'webpage'}`,
    name: data.name, description: data.description, url: `${SITE.url}${path}`,
    ...(data.image && { image: data.image }),
    ...(isService ? { provider: { '@id': ORGANIZATION_ID }, areaServed: data.areaServed,
      ...(data.hasOfferCatalog && { hasOfferCatalog: data.hasOfferCatalog }),
      ...(data.offers && { offers: data.offers }) } : { about: { '@id': ORGANIZATION_ID } }),
  } : data;
  function visit(value: any): any {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const ownBusiness = ['LocalBusiness', 'Organization'].includes(value['@type']) &&
      (String(value.name || '').toLowerCase().includes('mavinci') ||
        String(value.url || value['@id'] || '').startsWith(SITE.url));
    if (ownBusiness) return { '@id': ORGANIZATION_ID };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  }
  return visit(root);
}
