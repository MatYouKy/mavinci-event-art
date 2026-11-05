'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSellerPortalContext } from '@/lib/seller/portal';
import { writeSellerWelcome } from '@/lib/seller/welcome';
import SellerChatPanel, { ChatOffer } from '@/components/seller/SellerChatPanel';
import SellerManagerCard from '@/components/seller/SellerManagerCard';

export default function SellerMessagesPage() {
  const { context, loading, error, reload } = useSellerPortalContext();
  const [offers, setOffers] = useState<ChatOffer[]>([]);
  const [offersError, setOffersError] = useState('');
  useEffect(() => {
    let active = true;
    if (!context) return;
    // Opening the conversations completes the "Poznaj swojego opiekuna" step.
    writeSellerWelcome(context.profile.id, { manager: true });
    void (async () => {
      const { data, error: loadError } = await supabase.from('offers').select('id,my_company_id,title,offer_number').eq('sales_partner_id', context.profile.id).order('created_at', { ascending: false });
      if (!active) return;
      if (loadError) setOffersError('Nie udało się wczytać ofert do powiązania z rozmową.');
      else { setOffers(data || []); setOffersError(''); }
    })();
    return () => { active = false; };
  }, [context]);
  if (loading) return <p role="status" className="flex items-center gap-2 p-6 text-sm text-white/55"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie rozmów…</p>;
  if (!context || error) return <div role="alert" className="space-y-3 p-6 text-sm text-amber-200"><p>{error || 'Brak aktywnego dostępu do portalu.'}</p><button type="button" onClick={() => void reload()} className="inline-flex min-h-10 items-center rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73]">Spróbuj ponownie</button></div>;
  return <div className="mx-auto max-w-6xl space-y-4 p-4 text-[#e5e4e2] md:p-6">
    <header className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div><h1 className="text-2xl font-light uppercase">Rozmowy z opiekunem</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Pytania, ustalenia i wsparcie przy sprzedaży. Rozmowa ogólna służy do bieżącego kontaktu, a każda oferta ma swój osobny wątek.</p></div>
      <SellerManagerCard manager={context.manager} partnerId={context.profile.id} compact />
    </header>
    {offersError && <p role="alert" className="text-sm text-amber-200">{offersError}</p>}
    <SellerChatPanel key={context.profile.id} partnerId={context.profile.id} brands={context.brands.map((brand) => ({ id: brand.my_company_id, name: brand.name }))} offers={offers} />
  </div>;
}
