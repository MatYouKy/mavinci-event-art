-- Portal sprzedawcy, karta „Twój opiekun”: zdjęcie opiekuna było przycinane do środka oryginału, a nie tak jak miniatura
-- pracownika w CRM (`EmployeeAvatar` — kadr zapisany w `employees.avatar_metadata.desktop`: przesunięcie w % i skala).
-- `get_seller_portal_context()` zwraca teraz także `manager.photo_frame` = { position: {posX, posY, scale}, objectFit }
-- (tylko te dwa pola metadanych, bez adresów plików). Reszta funkcji bez zmian (jak w 20261105150000_seller_manager_cockpit.sql);
-- CREATE OR REPLACE zachowuje dotychczasowe uprawnienia (EXECUTE: authenticated, service_role). Portal bez tej migracji
-- pokazuje zdjęcie jak dotąd (wyśrodkowane).

CREATE OR REPLACE FUNCTION public.get_seller_portal_context()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT jsonb_build_object(
    'default_offer_organization_id', public.seller_default_offer_organization(p.id),
    'organizations', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', org.id,
      'name', COALESCE(NULLIF(org.alias, ''), org.name), 'business_type', org.business_type)
      ORDER BY COALESCE(NULLIF(org.alias, ''), org.name), org.id)
      FROM public.seller_partner_organization_ids(p.id) h JOIN public.organizations org ON org.id = h.organization_id), '[]'::jsonb),
    'profile', jsonb_build_object('id', p.id, 'partner_type', p.partner_type, 'organization_id', p.organization_id,
      'person', jsonb_build_object('name', c.full_name, 'email', c.email, 'phone', COALESCE(c.mobile, c.phone), 'photo_url', c.avatar_url,
        'position', (SELECT r.position FROM public.contact_organizations r WHERE r.contact_id = p.contact_id AND r.organization_id = p.organization_id AND r.is_current LIMIT 1)),
      'organization', jsonb_build_object('id', o.id, 'name', o.name, 'alias', o.alias, 'email', o.email, 'phone', o.phone, 'website', o.website, 'address', o.address, 'city', o.city)),
    'manager', (SELECT jsonb_build_object('name', nullif(btrim(concat_ws(' ', m.name, m.surname)), ''), 'email', m.email,
                  'phone', nullif(m.phone_number, ''), 'photo_url', m.avatar_url,
                  -- Kadr zdjęcia jak miniatura w CRM (EmployeeAvatar): tylko przesunięcie, skala i dopasowanie.
                  'photo_frame', CASE WHEN jsonb_typeof(m.avatar_metadata -> 'desktop') = 'object'
                    THEN jsonb_build_object('position', m.avatar_metadata -> 'desktop' -> 'position',
                                            'objectFit', m.avatar_metadata -> 'desktop' -> 'objectFit') END,
                  'position', coalesce(nullif(m.occupation, ''), 'Opiekun sprzedawców'))
                  FROM public.employees m WHERE m.id = public.seller_partner_manager_id(p.id, NULL) AND m.is_active),
    'brands', COALESCE((SELECT jsonb_agg(jsonb_build_object('my_company_id', t.my_company_id, 'name', b.name, 'legal_name', b.legal_name, 'logo_url', b.logo_url,
      'commission_enabled', t.commission_enabled, 'commissions_visible', t.commissions_visible,
      -- Ukryte wynagrodzenie: bez stawki i sposobu wypłaty (null). Marka bez prowizji — jak dotąd.
      'default_commission_rate', CASE WHEN t.commission_enabled AND NOT t.commissions_visible THEN NULL ELSE t.default_commission_rate END,
      'default_payment_method', CASE WHEN t.commission_enabled AND NOT t.commissions_visible THEN NULL ELSE t.default_payment_method END,
      'branding', public.resolve_seller_offer_branding_for_organization(p.id, t.my_company_id, public.seller_default_offer_organization(p.id))) ORDER BY b.name)
      FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id = t.my_company_id
      WHERE t.sales_partner_id = p.id AND t.is_active AND b.is_active), '[]'::jsonb))
  FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id = p.contact_id
  LEFT JOIN public.organizations o ON o.id = p.organization_id
  WHERE p.id = public.current_sales_partner_id() AND p.portal_enabled AND p.status = 'active';
$function$;
