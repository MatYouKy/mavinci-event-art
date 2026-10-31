import 'server-only';
import { cache } from 'react';
import { publicSupabase } from './publicData';
import { SITE } from './site';
import { loadCityCasesFromDb } from '@/lib/Pages/polishCityCases.server';
import { getPolishCityCasesSmart } from '@/lib/polishCityCases';
import { casinoBenefits, casinoProcess, casinoCopyOrDefault, getCasinoLocalCopy, getCasinoCityFaq, getCasinoCityServices, type CasinoService } from './casinoCityContent';
import { getCasinoOfferProduct, getCasinoReferences, selectCasinoReferences } from './casinoReferences.server';

/** One publication rule for city pages, their directory and sitemap. */
export const getPublishedCasinoCities = cache(async () => {
  const { data, error } = await publicSupabase().from('schema_org_places').select('*')
    .eq('is_global', true).eq('is_active', true).order('name');
  if (error) throw new Error('Nie udało się pobrać lokalizacji kasyna.');
  return (data || []).filter(city => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.locality || '')
    && !['lokalizacje', 'zasady'].includes(city.locality));
});

const getSharedCasinoData = cache(async () => {
  const client = publicSupabase();
  const [hero, tables, gallery, product, references] = await Promise.all([
    client.from('kasyno_page_images').select('*').eq('is_active', true).eq('section', 'hero').order('order_index').limit(1).maybeSingle(),
    client.from('casino_tables').select('*').eq('is_visible', true).order('order_index'),
    client.from('casino_gallery').select('*').eq('is_visible', true).order('order_index').limit(9),
    getCasinoOfferProduct(), getCasinoReferences(),
  ]);
  if ([hero, tables, gallery].some(result => result.error)) throw new Error('Nie udało się pobrać opublikowanej oferty kasyna.');
  return { hero: hero.data, tables: tables.data || [], gallery: gallery.data || [], product, references };
});

/** Public content is request-scoped. The product loader projects only copy already
 * published at /produkty/[id]; no private CRM data reaches metadata or client props. */
export const getCasinoCityData = cache(async (slug: string) => {
  const cities = await getPublishedCasinoCities();
  const city = cities.find(place => place.locality === slug);
  if (!city) return null;
  const client = publicSupabase();
  const pageSlug = `oferta/kasyno/${slug}`;
  const [shared, cases, metadata, seo, hero] = await Promise.all([
    getSharedCasinoData(), loadCityCasesFromDb(),
    client.from('schema_org_page_metadata').select('*').eq('page_slug', pageSlug).eq('is_active', true).maybeSingle(),
    client.from('city_pages_seo').select('*').eq('page_type', 'kasyno').eq('city_slug', slug).eq('is_active', true).maybeSingle(),
    client.from('service_hero_images').select('*').eq('page_slug', pageSlug).eq('is_active', true).maybeSingle(),
  ]);
  if ([metadata, seo, hero].some(result => result.error)) throw new Error('Nie udało się pobrać danych strony kasyna.');
  const schema = metadata.data?.custom_schema && typeof metadata.data.custom_schema === 'object' ? metadata.data.custom_schema : {};
  const content = schema.casinoContent && typeof schema.casinoContent === 'object' && !Array.isArray(schema.casinoContent) ? schema.casinoContent : {};
  const cityCases = cases[slug] || getPolishCityCasesSmart(city.name, cases);
  const location = `${cityCases.locative_preposition || 'w'} ${cityCases.locative}`;
  const oldTitle = `Kasyno rozrywkowe ${location}`;
  const legacyTitles = [oldTitle, `${oldTitle} | MAVINCI`, `${oldTitle} - Eventy Kasynowe | MAVINCI`];
  const legacyDescriptions = [
    `Profesjonalne kasyno rozrywkowe na eventy ${location}. Stoły do ruletki, blackjacka, pokera, koło fortuny. Doświadczeni krupierzy, kompletna oprawa Las Vegas, personalizacja pod firmę.`,
    `Kasyno eventowe ${location}: ruletka, blackjack, poker i doświadczeni krupierzy. Atrakcja na imprezy firmowe, integracje i gale. Zapytaj MAVINCI o termin i wycenę.`,
  ];
  const defaultDescription = `Mobilne kasyno ${location} na imprezy firmowe i integracje. Blackjack, poker, ruletka, krupierzy i zestawy stołów MAVINCI. Poznaj zakres i zapytaj o wycenę.`;
  const title = casinoCopyOrDefault(hero.data?.title || content.hero_title, legacyTitles, `Mobilne kasyno ${location} na imprezy firmowe`);
  const lead = casinoCopyOrDefault(hero.data?.description || content.hero_description, legacyDescriptions,
    `Zaproś gości do blackjacka, pokera i ruletki podczas firmowej integracji, bankietu lub wieczoru po konferencji ${location}. Dobierz stoły, ustal obsługę krupierską i poznaj zestawy strefy kasynowej MAVINCI. Gramy dla zabawy, bez prawdziwych pieniędzy.`);
  const description = casinoCopyOrDefault(seo.data?.seo_description || metadata.data?.description || content.seo_description, legacyDescriptions, defaultDescription);
  const metaTitle = casinoCopyOrDefault(seo.data?.seo_title || metadata.data?.title || content.seo_title, legacyTitles, `Mobilne kasyno ${city.name} — imprezy firmowe | MAVINCI`);
  const image = hero.data?.image_url || content.hero_image_url || shared.hero?.image_url || `${SITE.url}/logo-mavinci-crm.png`;
  const imageOwner = hero.data?.image_url ? hero.data : content.hero_image_url ? null : shared.hero;
  const heroSettings = { ...shared.hero, ...hero.data,
    image_url: image,
    image_metadata: { ...imageOwner?.image_metadata,
      object_position: hero.data?.image_metadata?.object_position || imageOwner?.image_metadata?.object_position || 'center' },
    alt_text: hero.data?.alt_text || imageOwner?.alt_text || 'Kasyno eventowe MAVINCI ze stołami i obsługą krupierską',
  };
  const icons: Record<string, string> = { blackjack: 'Crown', poker: 'Users', ruletka: 'Dice1' };
  const services: CasinoService[] = shared.product?.variants.length ? shared.product.variants.map(variant => {
    const game = Object.keys(icons).find(key => variant.name.toLocaleLowerCase('pl-PL').includes(key));
    const table = shared.tables.find(row => row.slug === game);
    return { title: variant.name, description: variant.description, slug: game, icon: game ? icons[game] : 'Dice1', href: variant.href,
      image: table?.image_metadata?.desktop?.src || table?.image_url,
      mobileImage: table?.image_metadata?.mobile?.src, alt: table?.image_alt || variant.name };
  }) : getCasinoCityServices(content, shared.tables);
  const faq = getCasinoCityFaq(content, schema);
  const priceNote = shared.product?.requirements.find(item => /wycen|cennik/i.test(item.title));
  const decorationNote = shared.product?.requirements.find(item => /dekoracj/i.test(item.title));
  if (priceNote?.text) faq.push({ question: `Ile kosztuje mobilne kasyno ${location}?`, answer: `${priceNote.text} Obsługę gier, czas pracy i dodatkową oprawę potwierdzamy w indywidualnej ofercie.` });
  if (decorationNote?.text) faq.push({ question: 'Kiedy dekoracja strefy jest w cenie?', answer: decorationNote.text });
  const resolvedContent = {
    ...content,
    intro_heading: content.intro_heading || `Kasyno na integrację, bankiet i firmowy wieczór ${location}`,
    intro_text: content.intro_text || `Mobilne kasyno przyjeżdża na Twoje wydarzenie. Przy stołach goście mogą rozmawiać, poznawać zasady gier i wspólnie spędzić czas. Krupierzy pomagają dołączyć do zabawy także osobom, które pierwszy raz korzystają z takiej atrakcji.\nWynajem stołów kasynowych ${location} może obejmować wybrane gry albo gotowy zestaw. Liczbę stołów, obsadę, godziny pracy, dekorację i transport ustalamy dla konkretnego wydarzenia. Muzyka, konferansjer, światło i pozostałe elementy oprawy wymagają wskazania w ofercie.`,
    services_heading: content.services_heading || 'Wybierz stoły do swojej strefy kasyna',
    equipment_json: content.equipment_json || [
      { category: 'Dostępne stoły', items: services.map(service => service.title) },
      { category: 'Do uzgodnienia w ofercie', items: ['Liczba stołów i plan ustawienia', 'Obsada krupierska i godziny zabawy', 'Transport, montaż i demontaż', 'Zakres dekoracji oraz dodatkowej oprawy'] },
    ],
    benefits_heading: content.benefits_heading || 'Co zyskujesz, wybierając strefę MAVINCI',
    benefits_json: shared.product?.benefits.length ? shared.product.benefits.map(item => ({ title: item.title || item.text, description: item.title ? item.text : '' })) : content.benefits_json || casinoBenefits,
    process_json: content.process_json || casinoProcess,
  };
  const portfolio = selectCasinoReferences(shared.references, slug).map(project => ({
    ...project, location: project.eventCitySlug ? cities.find(place => place.locality === project.eventCitySlug)?.name || project.location : project.location,
  }));
  return { city, cityCases, pageSlug, canonicalUrl: `${SITE.url}/${pageSlug}`, title, lead, description, metaTitle,
    keywords: seo.data?.seo_keywords || metadata.data?.keywords || content.seo_keywords,
    image, ogImage: metadata.data?.og_image || image, heroSettings, localHero: hero.data || {},
    content: resolvedContent, schema, services, faq, gallery: shared.gallery, product: shared.product, portfolio,
    localCopy: getCasinoLocalCopy(slug, city.name, location),
    nearbyCities: cities.filter(place => place.locality !== slug && city.region && place.region === city.region).slice(0, 6),
  };
});
