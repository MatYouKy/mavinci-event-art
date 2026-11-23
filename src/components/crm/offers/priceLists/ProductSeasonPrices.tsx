'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Tags } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { priceListSeason, priceListStatusLabels, type PriceListStatus } from '@/lib/CRM/Offers/seasonPrices';

/*
 * Karta produktu → „Ceny w cennikach sezonowych”: cena bazowa i ceny wariantów produktu w cennikach marek (aktywne, szkice,
 * archiwum) z odnośnikiem do edycji w Oferty → Cenniki. Bez migracji cenników sekcja się nie pokazuje.
 */

type ListRow = {
  id: string;
  name: string;
  season_from: string;
  season_to: string;
  status: PriceListStatus;
  company: string;
  base: number | null;
  variants: { id: string; name: string; catalog: number; price: number }[];
};

const money = (value: number) => `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
type Raw = Record<string, any>;

export default function ProductSeasonPrices({ productId, basePrice }: { productId: string; basePrice: number }) {
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [entries, variants, companies] = await Promise.all([
        supabase.from('price_list_entries')
          .select('price_list_id, product_variant_id, price_net, price_list:price_lists(id, name, season_from, season_to, status, my_company_id)')
          .eq('product_id', productId),
        supabase.from('offer_product_variants').select('id, name, price_net, display_order').eq('product_id', productId),
        supabase.from('my_companies').select('id, name'),
      ]);
      if (!active) return;
      if (entries.error) { setAvailable(false); return; }
      const companyNames = new Map(((companies.data || []) as Raw[]).map((row) => [String(row.id), String(row.name)]));
      const variantRows = ((variants.data || []) as Raw[]).sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
      const byList = new Map<string, ListRow>();
      for (const entry of (entries.data || []) as Raw[]) {
        const list = (Array.isArray(entry.price_list) ? entry.price_list[0] : entry.price_list) as Raw | null;
        if (!list) continue;
        const row = byList.get(String(list.id)) || {
          id: String(list.id), name: String(list.name), season_from: String(list.season_from), season_to: String(list.season_to),
          status: list.status as PriceListStatus, company: companyNames.get(String(list.my_company_id)) || 'Marka', base: null, variants: [],
        };
        if (!entry.product_variant_id) row.base = Number(entry.price_net);
        byList.set(row.id, row);
      }
      for (const row of byList.values()) {
        row.variants = variantRows
          .map((variant) => {
            const entry = ((entries.data || []) as Raw[]).find((item) => item.price_list_id === row.id && item.product_variant_id === variant.id);
            return entry ? { id: String(variant.id), name: String(variant.name), catalog: Number(variant.price_net) || 0, price: Number(entry.price_net) } : null;
          })
          .filter((value): value is ListRow['variants'][number] => value !== null);
      }
      const order: Record<PriceListStatus, number> = { active: 0, draft: 1, archived: 2 };
      setRows([...byList.values()].sort((a, b) => order[a.status] - order[b.status] || b.season_from.localeCompare(a.season_from)));
    })();
    return () => { active = false; };
  }, [productId]);

  if (!available) return null;
  if (!rows) return <p role="status" className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie cenników…</p>;
  if (!rows.length) {
    return (
      <div className="space-y-2 text-sm text-[#e5e4e2]/60">
        <p>Produkt nie ma cen w cennikach sezonowych — oferty biorą cenę z katalogu.</p>
        <Link href="/crm/offers?tab=pricelists" className="inline-flex items-center gap-1.5 text-[#d3bb73] hover:underline"><Tags className="h-4 w-4" />Oferty → Cenniki</Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-[#e5e4e2]/50">Aktywny cennik marki podpowiada cenę w ofertach eventów z datą w swoim sezonie. Cena z katalogu: {money(basePrice)} netto.</p>
      {rows.map((row) => (
        <div key={row.id} className="rounded-lg bg-black/10 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm text-[#e5e4e2]">{row.name}</p>
              <p className="text-xs text-[#e5e4e2]/45">{row.company} · sezon {priceListSeason(row)} · {priceListStatusLabels[row.status]}</p>
            </div>
            <Link href={`/crm/offers?tab=pricelists&list=${row.id}`} className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline">Edytuj w cenniku<ExternalLink className="h-3 w-3" /></Link>
          </div>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {row.base !== null && <div className="flex justify-between gap-3"><dt className="text-[#e5e4e2]/55">Cena bazowa</dt><dd className="tabular-nums text-[#e5e4e2]">{money(row.base)}</dd></div>}
            {row.variants.map((variant) => (
              <div key={variant.id} className="flex justify-between gap-3">
                <dt className="truncate text-[#e5e4e2]/55">{variant.name}</dt>
                <dd className="tabular-nums text-[#e5e4e2]">{money(variant.price)} <span className="text-xs text-[#e5e4e2]/35">(katalog {money(variant.catalog)})</span></dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
