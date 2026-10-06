import { DEMO_COMPANY_ID, DEMO_PRODUCTS, parseSellerDemoInput, demoInputError, validateDemoImage, validateDemoPortrait, DEFAULT_DEMO } from './sellerDemo.ts';
export async function createSellerDemoOffer(supabase: any, raw: unknown, id: string): Promise<any> {
  const input = parseSellerDemoInput(raw);
  const invalid = demoInputError(input);
  if (invalid) throw new Error(invalid);
  for (const key of ['logo', 'cover'] as const) {
    if ((raw as any)?.[key] && !input[key]) throw new Error('Grafika jest za duża lub ma nieobsługiwany format.');
    validateDemoImage(input[key]);
  }
  if ((raw as any)?.portrait && !input.portrait) throw new Error('Zdjęcie stopki jest za duże lub ma nieobsługiwany format.');
  validateDemoPortrait(input.portrait);
  // Explicit columns and a fixed allowlist: no catalogue prices or private offers.
  const { data: products, error } = await supabase.from('offer_products').select('id,offer_image_path,offer_image_alt').in('id',DEMO_PRODUCTS.map(p=>p.id)).eq('is_active',true);
  if (error || products?.length !== 3) throw new Error('Usługi demonstracyjne są chwilowo niedostępne.');
  return {
    id, name: input.title || DEFAULT_DEMO.title, title: input.title || DEFAULT_DEMO.title, offer_number: 'DEMO', created_at: new Date().toISOString(),
    my_company_id: DEMO_COMPANY_ID, sales_channel: 'seller_portal', partner_organization_id: DEMO_COMPANY_ID,
    description: 'Przykładowy zakres wydarzenia: konferencja, oprawa muzyczna i multimedia. Wpisane ceny są wyłącznie próbną kalkulacją użytkownika. Więcej usług udostępnimy po rozpoczęciu współpracy.',
    portal_client_company: 'Przykładowe wydarzenie', portal_client_name: '', tax_percent: 23,
    offer_items: DEMO_PRODUCTS.map((p,index)=>({
      id:p.id,product_id:p.id,name:p.name,description:p.description,quantity:1,unit:'usługa',client_unit_price:Number(input.prices[index] || 0),demo_price_entered:input.prices[index] !== '',display_order:index,
      show_product_variants_in_pdf:false,show_variant_prices_in_pdf:false,
      product:{...products.find((row:any)=>row.id===p.id),name:p.name,description:p.description,offer_short_description:p.description,offer_description:p.description,offer_benefits:[],offer_page_enabled:true,variants:[],offer_page_variant:'default'},
    })),
    partner_branding_snapshot:{
      identity_version:2,organization_id:DEMO_COMPANY_ID,organization_name:input.organization||'Twój hotel / agencja',
      display_name:input.fullName||'Twój opiekun wydarzenia',contact_email:input.email,contact_phone:input.phone,
      organization_website:input.website,portrait_url:input.portrait,
      hotel_logo_url:input.logo,hotel_cover_image_url:input.cover,heading_font_family:'Noto Sans',
      brand_primary_color:input.primary,brand_secondary_color:input.accent,brand_surface_color:input.surface,
      position_title:'OPIEKUN WYDARZENIA',footer_text:'DEMONSTRACJA STREFY SPRZEDAWCY · KALKULACJA TESTOWA',
      disclosure_text:'Dokument testowy. Nie stanowi oferty handlowej ani rezerwacji. Więcej usług i warunki współpracy udostępnimy po rozpoczęciu współpracy.',
    },
  };
}
