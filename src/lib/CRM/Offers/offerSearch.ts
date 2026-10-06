const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[łŁ]/g, 'l').toLowerCase().trim();
export function matchesOfferSearch(offer: any, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const parties = [offer.organization, offer.contact, offer.contact_person, offer.client, offer.event?.organization, offer.event?.contact].flatMap(p => Array.isArray(p) ? p : p ? [p] : []);
  const text = normalize([offer.offer_number, offer.title, offer.event?.name, ...parties.flatMap(p => [p.name,p.alias,p.company_name,p.full_name,p.first_name,p.last_name,p.email,p.phone,p.mobile])].filter(Boolean).join(' '));
  const phones = parties.flatMap(p => [p.phone,p.mobile]).filter(Boolean).map(p => String(p).replace(/\D/g,''));
  const phoneQuery = query.replace(/\D/g,'');
  if (/^[+\d\s().-]+$/.test(query.trim()) && phoneQuery.length >= 3 && phones.some(p => p.includes(phoneQuery))) return true;
  return terms.every(term => text.includes(term));
}
