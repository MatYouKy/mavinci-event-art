/** Only customer-facing copy. Never send staff rates, costs, CRM notes or assets to AI. */
export type ProductTranslationField = { key: string; label: string; source: string; limit?: number };
export type ProductEnglishEntry = { source: string; target: string };
export type ProductEnglishContent = Record<string, ProductEnglishEntry>;
export function productTranslationFields(product: any): ProductTranslationField[] {
  const result: ProductTranslationField[] = [];
  const add = (key: string, label: string, value: unknown, limit?: number) => {
    if (typeof value === 'string' && value.trim()) result.push({ key, label, source: value, limit });
  };
  const fields: Record<string, string> = {
    name: 'Nazwa produktu', description: 'Opis produktu', unit: 'Jednostka',
    offer_short_description: 'Hasło na karcie', offer_description: 'Rozszerzony opis oferty',
    offer_compact_description: 'Krótki opis do oferty kompaktowej', public_description: 'Opis strony produktu',
    offer_image_alt: 'Opis zdjęcia', related_service_label: 'Powiązana usługa',
  };
  for (const [key, label] of Object.entries(fields)) add(key, label, product[key], key === 'offer_compact_description' ? 330 : undefined);
  for (const key of ['offer_benefits', 'offer_requirements', 'tags']) {
    (Array.isArray(product[key]) ? product[key] : []).forEach((text: unknown, i: number) => add(`${key}/${i}`, `${key === 'offer_benefits' ? 'Korzyść' : key === 'tags' ? 'Tag' : 'Wymaganie'} ${i + 1}`, text));
  }
  const groups = [
    ['variants', 'Element', ['name', 'short_description', 'description', 'offer_image_alt']],
    ['sales_packages', 'Pakiet', ['name', 'description', 'included_label', 'bonus', 'image_alt']],
    ['pricing_addons', 'Dodatek', ['name', 'description', 'unit']],
    ['offer_additional_requirements', 'Wymaganie', ['title', 'description']],
  ] as const;
  const labels: Record<string, string> = { name: 'Nazwa', short_description: 'Krótki opis', description: 'Opis', included_label: 'Zakres', bonus: 'Bonus', image_alt: 'Opis zdjęcia', offer_image_alt: 'Opis zdjęcia', unit: 'Jednostka', title: 'Tytuł' };
  for (const [group, label, keys] of groups) {
    const rows = group === 'variants' ? product.variants || product.offer_product_variants : product[group];
    (Array.isArray(rows) ? rows : []).forEach((row: any, index: number) => {
      const id = row.id || String(index);
      for (const key of keys) {
        const limits: Record<string, number> = group === 'sales_packages' ? { name: 42, description: 95, included_label: 95, bonus: 65, image_alt: 200 } : {};
        add(`${group}/${id}/${key}`, `${label} ${index + 1} · ${labels[key]}`, row[key], limits[key]);
      }
      if (group === 'variants') (Array.isArray(row.benefits) ? row.benefits : []).forEach((text: unknown, i: number) => add(`${group}/${id}/benefits/${i}`, `${label} ${index + 1} · Korzyść ${i + 1}`, text));
    });
  }
  return result;
}
export function currentEnglishFields(product: any) {
  const stored: ProductEnglishContent = product.english_content || {};
  return productTranslationFields(product).map(field => ({ ...field, target: stored[field.key]?.source === field.source ? stored[field.key].target : '' }));
}
/** Apply by stable entity ID, never by package/element ordering. */
export function applyProductEnglish(product: any, entries: ProductEnglishContent) {
  const copy = structuredClone(product);
  for (const field of productTranslationFields(product)) {
    const entry = entries[field.key];
    if (!entry?.target || entry.source !== field.source) continue;
    const [group, id, key, index] = field.key.split('/');
    if (!id) copy[group] = entry.target;
    else if (!key) copy[group][Number(id)] = entry.target;
    else {
      const rows = group === 'variants' ? copy.variants || copy.offer_product_variants : copy[group];
      const row = rows?.find((row: any, i: number) => (row.id || String(i)) === id);
      if (row) { if (index !== undefined) row[key][Number(index)] = entry.target; else row[key] = entry.target; }
    }
  }
  return copy;
}


/** Explicit customer-copy allowlist. Never translate IDs, enum values, contacts, prices or internal costs. */
export function mapOfferCustomerCopy(offer: any, translate: (text: string) => string) {
  const copy = structuredClone(offer);
  const fields = (row: any, keys: string[]) => {
    if (!row) return;
    for (const key of keys) if (typeof row[key] === 'string' && row[key].trim()) row[key] = translate(row[key]);
  };
  const rows = (value: any, keys: string[]) => { if (Array.isArray(value)) value.forEach(row => fields(row, keys)); };
  const strings = (row: any, key: string) => { if (Array.isArray(row?.[key])) row[key] = row[key].map((text: any) => typeof text === 'string' ? translate(text) : text); };
  const product = (value: any) => value ? applyProductEnglish(value, Object.fromEntries(productTranslationFields(value).map(field => [field.key, { source: field.source, target: translate(field.source) }]))) : value;
  const configuration = (value: any) => {
    if (!value) return;
    rows(value.product_package?.options, ['name', 'description', 'included_label', 'bonus', 'image_alt']);
    rows(value.addons, ['name', 'description', 'unit']);
  };
  fields(copy, ['title', 'description', 'event_goal', 'event_assumptions', 'hero_image_alt', 'logistics_description']);
  fields(copy.event, ['name']);
  fields(copy.inquiry, ['title', 'description']);
  fields(copy.inquiry?.inquiry_details, ['event_goal', 'event_assumptions', 'scope']);
  rows(copy.inquiry?.inquiry_details?.event_assumption_items, ['label', 'value']);
  rows(copy.event_assumption_items, ['label', 'value']);
  rows(copy.info_page_sections, ['title', 'content']);
  for (const key of ['offer_requirements', 'resolved_requirements']) {
    rows(copy[key], ['title', 'description']);
    if (Array.isArray(copy[key])) copy[key].forEach((row: any) => strings(row, 'sources'));
  }
  rows(copy.packages, ['name', 'description']);
  for (const item of [...(copy.offer_items || []), ...(copy.recommended_items || [])]) {
    fields(item, ['name', 'description', 'unit', 'price_label', 'calculation_description']);
    item.product = product(item.product);
    for (const key of ['product_variant', 'selected_variant']) if (item[key]) item[key] = product({ variants: [item[key]] }).variants[0];
    configuration(item.pricing_configuration);
  }
  return copy;
}
export function offerCopySources(offer: any): string[] {
  const values = new Set<string>();
  mapOfferCustomerCopy(offer, text => { if (text.trim()) values.add(text); return text; });
  return [...values].sort();
}
export function storedProductMemory(offer: any): Record<string, string> {
  const memory: Record<string, string> = {};
  for (const item of offer.offer_items || []) {
    const product = item.product;
    if (!product) continue;
    for (const field of productTranslationFields(product)) {
      const entry = product.english_content?.[field.key];
      if (entry?.source === field.source && entry.target) memory[field.source] = entry.target;
    }
  }
  return memory;
}
export async function offerCopySignature(offer: any) {
  const payload = JSON.stringify([offerCopySources(offer), Object.entries(storedProductMemory(offer)).sort(([a], [b]) => a.localeCompare(b))]);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export function offerTranslationLimits(offer: any) {
  const limits: Record<string,number> = {};
  for (const item of offer.offer_items || []) {
    for (const field of productTranslationFields(item.product || {})) if (field.limit) limits[field.source] = Math.min(limits[field.source] || Infinity, field.limit);
  }
  return limits;
}
