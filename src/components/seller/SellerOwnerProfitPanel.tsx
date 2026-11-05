'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Calculator } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

/**
 * Dawny panel „Rentowność i prowizja opiekuna” — wyłączony (book_seller_owner_profit_commission zgłasza błąd).
 * Prowizję opiekuna sprzedawcy z portalu liczy teraz zakładka Podsumowanie w wydarzeniu (udział sprzedawcy wydarzenia).
 * Panel pokazuje tylko informację i link do podsumowania, gdy oferta ma wydarzenie.
 */
export default function SellerOwnerProfitPanel({ offerId, refreshKey = 0 }: { offerId: string; refreshKey?: number }) {
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase
      .from('offers')
      .select('event_id')
      .eq('id', offerId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setEventId(!error && data && typeof data.event_id === 'string' ? data.event_id : null);
      });
    return () => {
      active = false;
    };
  }, [offerId, refreshKey]);

  return (
    <section id="seller-owner-profit" aria-label="Prowizja opiekuna" className="scroll-mt-6 space-y-2 rounded-xl bg-white/[0.035] p-4 text-sm">
      <h3 className="flex items-center gap-2 text-sm uppercase text-[#e5e4e2]">
        <Calculator className="h-4 w-4 text-[#d3bb73]" aria-hidden />
        Prowizja opiekuna
      </h3>
      <p className="text-xs leading-5 text-[#e5e4e2]/65">
        Prowizję opiekuna liczy teraz zakładka Podsumowanie w wydarzeniu (udział sprzedawcy, 5% / 10% od zysku).
      </p>
      {eventId ? (
        <Link
          href={`/crm/events/${eventId}?tab=summary`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/20"
        >
          Otwórz podsumowanie wydarzenia
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : (
        <p className="text-xs text-[#e5e4e2]/45">Podsumowanie będzie dostępne po akceptacji oferty i utworzeniu wydarzenia.</p>
      )}
    </section>
  );
}
