
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cache } from 'react';
import { cookies } from 'next/headers';

export const getOffersData = cache(async () => {
  const supabase = createSupabaseServerClient(cookies());

  // 1) offers + event + creator
  const { data: offers, error: offersError } = await supabase
    .from('offers')
    .select(
      `
      *,
      event:events!event_id(
        name,
        event_date,
        organization_id,
        contact_person_id
      ),
      creator:employees!created_by(name, surname)
    `,
    )
    .order('created_at', { ascending: false });

  if (offersError) throw offersError;

  // 2) dogrywamy org/contact (batch)
  const orgIds = (offers ?? []).map((o: any) => o?.event?.organization_id).filter(Boolean);

  const contactIds = (offers ?? []).map((o: any) => o?.event?.contact_person_id).filter(Boolean);

  const uniqueOrgIds = Array.from(new Set(orgIds));
  const uniqueContactIds = Array.from(new Set(contactIds));

  const [orgRes, contactRes] = await Promise.all([
    uniqueOrgIds.length
      ? supabase.from('organizations').select('id, name').in('id', uniqueOrgIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    uniqueContactIds.length
      ? supabase
          .from('contacts')
          .select('id, first_name, last_name, company_name')
          .in('id', uniqueContactIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
  ]);

  if (orgRes.error) throw orgRes.error;
  if (contactRes.error) throw contactRes.error;

  const orgsMap: Record<string, any> = Object.fromEntries(
    (orgRes.data ?? []).map((o: any) => [o.id, o]),
  );
  const contactsMap: Record<string, any> = Object.fromEntries(
    (contactRes.data ?? []).map((c: any) => [c.id, c]),
  );

  const enrichedOffers = (offers ?? []).map((offer: any) => {
    const event = offer.event;
    if (event?.organization_id && orgsMap[event.organization_id]) {
      event.organization = orgsMap[event.organization_id];
    }
    if (event?.contact_person_id && contactsMap[event.contact_person_id]) {
      event.contact = contactsMap[event.contact_person_id];
    }
    return offer;
  });

  // 3) reszta równolegle
  const [categoriesRes, productsRes, templatesRes] = await Promise.all([
    supabase.from('event_categories').select('*').eq('is_active', true).order('order_index'),

    supabase
      .from('offer_products')
      .select(
        `
        *,
        category:event_categories(
          id, name, icon_id,
          custom_icon:custom_icons(id, name, svg_code, preview_color)
        )
      `,
      )
      .order('display_order'),

    supabase.from('offer_templates').select('*').order('is_default', { ascending: false }),
  ]);

  if (categoriesRes.error) throw categoriesRes.error;
  if (productsRes.error) throw productsRes.error;
  if (templatesRes.error) throw templatesRes.error;

  return {
    offers: enrichedOffers,
    categories: categoriesRes.data ?? [],
    products: productsRes.data ?? [],
    templates: templatesRes.data ?? [],
  };
});
