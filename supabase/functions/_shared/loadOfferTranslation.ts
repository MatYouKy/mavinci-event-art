import { buildOfferRequirements } from '../../../src/lib/CRM/Offers/offerRequirements.ts';
import { offerCopySignature, offerCopySources, storedProductMemory, offerTranslationLimits } from './productTranslation.ts';

export async function loadOfferTranslationSource(client: any, offerId: string) {
  const { data: offer, error } = await client.from('offers').select(`*,
    event:events!event_id(id,name,category:event_categories(id,default_offer_template_category_id)),
    inquiry:tasks!inquiry_id(id,title,description,inquiry_details),
    offer_items(*,product_variant:offer_product_variants!product_variant_id(*),product:offer_products(*,variants:offer_product_variants(*))),
    packages:offer_packages!offer_id(*,items:offer_package_items(*))
  `).eq('id', offerId).single();
  if (error || !offer) throw new Error('Nie udało się wczytać oferty do tłumaczenia.');
  let query = client.from('offer_template_categories').select('design_config').limit(1);
  const categoryId = offer.event?.category?.default_offer_template_category_id;
  query = categoryId ? query.eq('id', categoryId) : query.eq('is_default', true);
  const { data: template, error: templateError } = await query.maybeSingle();
  if (templateError) throw new Error('Nie udało się wczytać wymagań szablonu.');
  let stored = offer.offer_requirements;
  if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch { stored = []; } }
  offer.offer_requirements = Array.isArray(stored) ? stored : [];
  offer.resolved_requirements = buildOfferRequirements({ templateRequirements: template?.design_config?.technical_requirements_text || '', items: offer.offer_items, storedRequirements: offer.offer_requirements, refreshAutomaticSources: offer.status === 'draft' });
  offer.packages = (offer.packages || []).sort((a: any,b: any) => a.display_order - b.display_order);
  return offer;
}
export async function readOfferTranslation(client: any, offer: any) {
  const { data: saved, error } = await client.from('offer_english_content').select('source_signature,memory').eq('offer_id', offer.id).maybeSingle();
  if (error) throw new Error('Nie udało się wczytać zapisanej wersji EN.');
  const signature = await offerCopySignature(offer);
  const sources = offerCopySources(offer);
  const known = { ...(saved?.memory || {}), ...storedProductMemory(offer) };
  const limits = offerTranslationLimits(offer);
  for (const [source, limit] of Object.entries(limits)) if (known[source]?.length > limit) delete known[source];
  const memory: Record<string,string> = Object.fromEntries(sources.filter(source => typeof known[source] === 'string' && known[source].trim()).map(source => [source, known[source]]));
  return { signature, memory, ready: sources.every(source => Boolean(memory[source])), sources };
}
