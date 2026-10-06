'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSellerPortalContext } from '@/lib/seller/portal';
import SellerChatPanel, { ChatOffer } from '@/components/seller/SellerChatPanel';

export default function SellerMessagesPage() {
  const { context, loading, error } = useSellerPortalContext();
  const [offers, setOffers] = useState<ChatOffer[]>([]);
  const [offersError, setOffersError] = useState('');
  useEffect(() => {
    let active = true;
    if (!context) return;
    void (async () => {
      const { data, error: loadError } = await supabase.from('offers').select('id,my_company_id,title,offer_number').eq('sales_partner_id', context.profile.id).order('created_at', { ascending: false });
      if (!active) return;
      if (loadError) setOffersError('Nie udało się wczytać ofert do powiązania z rozmową.');
      else { setOffers(data || []); setOffersError(''); }
    })();
    return () => { active = false; };
  }, [context]);
  if (loading) return <p className="p-6 text-sm text-white/50">Wczytywanie rozmów…</p>;
  if (!context || error) return <p className="p-6 text-sm text-amber-200">{error || 'Brak aktywnego dostępu do portalu.'}</p>;
  return <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">{offersError && <p className="text-sm text-amber-200">{offersError}</p>}<SellerChatPanel key={context.profile.id} partnerId={context.profile.id} brands={context.brands.map((brand) => ({ id: brand.my_company_id, name: brand.name }))} offers={offers} /></div>;
}
