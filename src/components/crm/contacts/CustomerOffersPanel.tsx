'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import SystemBadge from '@/components/UI/SystemBadge';

type Offer = { id: string; offer_number: string | null; status: string; created_at: string; valid_until: string | null };

export default function CustomerOffersPanel({ contactId, organizationId }: { contactId?: string; organizationId?: string }) {
  const [items, setItems] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async (offset = 0) => {
    if (!contactId && !organizationId) return;
    const current = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const result = await supabase.from('offers')
        .select('id,offer_number,status,created_at,valid_until')
        .eq(contactId ? 'contact_id' : 'organization_id', contactId || organizationId!)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + 24);
      if (result.error) throw result.error;
      if (current !== generation.current) return;
      setItems(previous => offset ? [...previous, ...(result.data || [])] : result.data || []);
      setMore(result.data?.length === 25);
    } catch { if (current === generation.current) setError(true); }
    finally { if (current === generation.current) setLoading(false); }
  }, [contactId, organizationId]);
  useEffect(() => {
    setItems([]); setMore(false); void load();
    return () => { generation.current++; };
  }, [load]);

  return <section className="space-y-4 rounded-xl bg-black/10 p-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg">Oferty</h2>
      <button disabled={loading} onClick={() => void load()} className="text-sm text-[#d3bb73] disabled:opacity-50">Odśwież</button>
    </div>
    <p className="text-sm text-[#e5e4e2]/60">{contactId ? 'Oferty przygotowane dla tej osoby.' : 'Oferty przygotowane dla tej organizacji.'} Lista uwzględnia Twój zakres uprawnień.</p>
    {items.map(item => <Link key={item.id} href={`/crm/offers/${item.id}`} className="block space-y-2 rounded-lg bg-black/15 p-4 transition-colors hover:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium text-[#d3bb73]">{item.offer_number || 'Oferta bez numeru'}</span>
        <SystemBadge value={item.status} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#e5e4e2]/60">
        <span>Utworzono: {new Date(item.created_at).toLocaleDateString('pl-PL')}</span>
        {item.valid_until && <span>Ważna do: {new Date(item.valid_until).toLocaleDateString('pl-PL')}</span>}
      </div>
    </Link>)}
    {error && <p role="alert" className="text-sm text-red-300">Nie udało się pobrać ofert. <button onClick={() => void load(items.length)} className="underline">Spróbuj ponownie</button></p>}
    {loading ? <p role="status">Ładowanie ofert…</p> : !error && !items.length ? <p className="text-sm text-[#e5e4e2]/60">Brak powiązanych ofert.</p> : null}
    {more && !error && <button disabled={loading} onClick={() => void load(items.length)} className="text-sm text-[#d3bb73] disabled:opacity-50">Pokaż starsze oferty</button>}
  </section>;
}
