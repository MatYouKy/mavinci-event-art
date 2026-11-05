'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import DemoSetup from './DemoSetup';
import DemoPresentation from './DemoPresentation';
import { DEMO_SAMPLE_SERVICES, type DemoBrand, type DemoConfig, type DemoService } from './demoData';

type ProductRow = {
  id: string;
  name: string;
  offer_short_description: string | null;
  description: string | null;
  price_net: number | null;
  unit: string | null;
  offer_image_path: string | null;
  category: { name: string | null } | { name: string | null }[] | null;
};

/**
 * „Pokaż portal hotelowi” — prezentacja portalu sprzedawcy na tablecie podczas wizyty w hotelu.
 * Tylko odczyt (marki, katalog produktów, nazwa organizacji). Żadnych zapisów w bazie; logo zostaje lokalnie.
 */
export default function HotelPortalDemo() {
  const params = useSearchParams();
  const { employee } = useCurrentEmployee();
  const [stage, setStage] = useState<'setup' | 'present'>('setup');
  const [brands, setBrands] = useState<DemoBrand[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [brandsError, setBrandsError] = useState('');
  const [services, setServices] = useState<DemoService[]>([]);
  const [servicesSource, setServicesSource] = useState<'catalog' | 'sample' | 'loading'>('loading');
  const [config, setConfig] = useState<DemoConfig>({
    brand: null,
    hotelName: params.get('hotel')?.slice(0, 120) || '',
    logoUrl: null,
    accent: '#d3bb73',
    showEarnings: true,
    presenterName: '',
    presenterEmail: '',
    presenterPhone: '',
  });
  const logoRef = useRef<string | null>(null);

  // Prowadzący pokaz = zalogowany pracownik (wizytówka „Twój opiekun” w portalu).
  useEffect(() => {
    if (!employee) return;
    setConfig(current => current.presenterName ? current : {
      ...current,
      presenterName: `${employee.name || ''} ${employee.surname || ''}`.trim(),
      presenterEmail: employee.email || '',
      presenterPhone: employee.phone_number || '',
    });
  }, [employee]);

  // Marki dostępne dla pracownika (bez danych finansowych).
  useEffect(() => {
    let active = true;
    (async () => {
      setBrandsLoading(true);
      const accessible = await supabase.rpc('get_my_accessible_companies');
      let rows: { id: string; name: string; logo_url?: string | null; is_active?: boolean | null }[] = [];
      if (!accessible.error) rows = (accessible.data || []) as typeof rows;
      else {
        const fallback = await supabase.from('my_companies').select('id,name,is_active').order('name');
        if (fallback.error) { if (active) { setBrandsError(fallback.error.message); setBrandsLoading(false); } return; }
        rows = (fallback.data || []) as typeof rows;
      }
      if (!active) return;
      const list = rows.filter(row => row.is_active !== false).map(row => ({ id: row.id, name: row.name, logoUrl: row.logo_url || null }));
      setBrands(list);
      setConfig(current => current.brand ? current : { ...current, brand: list[0] || null });
      setBrandsLoading(false);
    })();
    return () => { active = false; };
  }, []);

  // Katalog produktów — tylko odczyt, pozycje widoczne w portalu sprzedawcy.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase.from('offer_products')
        .select('id,name,offer_short_description,description,price_net,unit,offer_image_path,category:event_categories(name)')
        .eq('is_active', true)
        .eq('partner_portal_visible', true)
        .order('display_order')
        .limit(60);
      if (!active) return;
      const rows = (error ? [] : (data || [])) as ProductRow[];
      const mapped = rows.map(row => {
        const category = Array.isArray(row.category) ? row.category[0] : row.category;
        const description = (row.offer_short_description || row.description || '').replace(/\s+/g, ' ').trim();
        return {
          id: row.id,
          name: row.name,
          description: description.length > 180 ? `${description.slice(0, 177)}…` : description,
          priceNet: row.price_net == null ? null : Number(row.price_net),
          unit: row.unit || 'usługa',
          category: category?.name || null,
          imageUrl: row.offer_image_path ? `/bridge/products/thumbnail?id=${encodeURIComponent(row.id)}&w=480&v=${encodeURIComponent(row.offer_image_path)}` : null,
        } satisfies DemoService;
      });
      if (mapped.length) { setServices(mapped); setServicesSource('catalog'); }
      else { setServices(DEMO_SAMPLE_SERVICES); setServicesSource('sample'); }
    })();
    return () => { active = false; };
  }, []);

  // Nazwa hotelu z organizacji lub obecnej organizacji kontaktu (gdy nie podano jej w adresie).
  useEffect(() => {
    if (params.get('hotel')) return;
    const organizationId = params.get('organization');
    const contactId = params.get('contact');
    if (!organizationId && !contactId) return;
    let active = true;
    (async () => {
      let orgId = organizationId;
      if (!orgId && contactId) {
        const link = await supabase.from('contact_organizations').select('organization_id').eq('contact_id', contactId).eq('is_current', true).limit(1).maybeSingle();
        orgId = link.data?.organization_id || null;
      }
      if (!orgId) return;
      const { data } = await supabase.from('organizations').select('name,alias').eq('id', orgId).maybeSingle();
      if (active && data) setConfig(current => current.hotelName ? current : { ...current, hotelName: data.alias || data.name || '' });
    })();
    return () => { active = false; };
  }, [params]);

  const setLogo = useCallback((file: File | null) => {
    if (logoRef.current) URL.revokeObjectURL(logoRef.current);
    logoRef.current = file ? URL.createObjectURL(file) : null;
    setConfig(current => ({ ...current, logoUrl: logoRef.current }));
  }, []);
  useEffect(() => () => { if (logoRef.current) URL.revokeObjectURL(logoRef.current); }, []);

  if (stage === 'present') {
    return <DemoPresentation config={config} services={services} servicesSource={servicesSource === 'catalog' ? 'catalog' : 'sample'} onExit={() => setStage('setup')} />;
  }
  return <DemoSetup
    config={config}
    onChange={patch => setConfig(current => ({ ...current, ...patch }))}
    onLogo={setLogo}
    brands={brands}
    brandsLoading={brandsLoading}
    brandsError={brandsError}
    servicesCount={services.length}
    servicesSource={servicesSource}
    onStart={() => setStage('present')}
  />;
}
