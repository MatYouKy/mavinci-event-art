import { ArrowLeft, FileDown } from 'lucide-react';
import { CATEGORY_META } from './calculations.constants';
import { CalcItem, Category } from './EventCalculationsTab';
import { DEFAULT_VAT, fmt } from '../helpers/calculations/calculations.helper';
import { guessCategory } from './calculations.utils';
import { ImportableItem } from './calculations.types';
import { useState } from 'react';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';

export function ImportFromOfferModal({
  eventId,
  existingRefs,
  onClose,
  onImport,
}: {
  eventId: string;
  existingRefs: Set<string>;
  onClose: () => void;
  onImport: (items: CalcItem[]) => void;
}) {
  const [offerItems, setOfferItems] = useState<ImportableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: offers, error: offersErr } = await supabase
        .from('offers')
        .select('id, offer_number')
        .eq('event_id', eventId);

      if (offersErr) {
        console.error('offers fetch error', offersErr);
      }
      if (!offers?.length) {
        setOfferItems([]);
        setLoading(false);
        return;
      }

      const offerIds = offers.map((o) => o.id);
      const { data: itemsData, error: itemsErr } = await supabase
        .from('offer_items')
        .select('*')
        .in('offer_id', offerIds)
        .order('display_order');

      if (itemsErr) {
        console.error('offer_items fetch error', itemsErr);
      }

      const productIds = Array.from(
        new Set((itemsData ?? []).map((it: any) => it.product_id).filter(Boolean)),
      );

      let productMap = new Map<string, { category_id: string | null; vat_rate: number | null }>();
      let categoryMap = new Map<string, string>();

      if (productIds.length) {
        const { data: products } = await supabase
          .from('offer_products')
          .select('id, category_id, vat_rate')
          .in('id', productIds);
        (products ?? []).forEach((p: any) => productMap.set(p.id, p));

        const catIds = Array.from(
          new Set((products ?? []).map((p: any) => p.category_id).filter(Boolean)),
        );
        if (catIds.length) {
          const { data: cats } = await supabase
            .from('event_categories')
            .select('id, name')
            .in('id', catIds);
          (cats ?? []).forEach((c: any) => categoryMap.set(c.id, c.name));
        }
      }

      const mapped: ImportableItem[] = (itemsData ?? []).map((it: any) => {
        const off = offers.find((o) => o.id === it.offer_id);
        const product = it.product_id ? productMap.get(it.product_id) : null;
        const categoryName =
          product && product.category_id ? (categoryMap.get(product.category_id) ?? null) : null;
        const productVat = product && product.vat_rate != null ? Number(product.vat_rate) : null;
        return {
          id: it.id,
          name: it.name,
          description: it.description,
          quantity: Number(it.quantity || 1),
          unit: it.unit,
          unit_price: Number(it.unit_price || 0),
          total: Number(it.total || 0),
          offerId: it.offer_id,
          offerName: off?.offer_number || 'Oferta',
          categoryName,
          autoCategory: guessCategory(categoryName, it.name),
          vat_rate: productVat ?? DEFAULT_VAT,
        };
      });

      setOfferItems(mapped);
      setLoading(false);
    })();
  }, [eventId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const available = offerItems.filter((it) => !existingRefs.has(it.id));
    if (selected.size === available.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(available.map((it) => it.id)));
    }
  };

  const handleImport = () => {
    const picked: CalcItem[] = offerItems
      .filter((it) => selected.has(it.id))
      .map((it, idx) => ({
        category: it.autoCategory,
        name: it.name,
        description: it.description || '',
        unit: it.unit || 'szt.',
        quantity: it.quantity,
        unit_price: it.unit_price,
        days: 1,
        source: 'offer',
        source_ref: it.id,
        position: idx,
        vat_rate: it.vat_rate,
      }));
    onImport(picked);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-5 py-3">
          <h3 className="text-lg font-light text-[#e5e4e2]">Importuj z oferty</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[#e5e4e2]/60 hover:bg-[#0a0d1a] hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-[#d3bb73]/10 bg-[#0a0d1a]/60 px-5 py-3 text-sm text-[#e5e4e2]/70">
          <span>
            Zaznacz pozycje z oferty — kalkulacja sama przypisze je do właściwej kategorii.
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-md border border-[#d3bb73]/30 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            Zaznacz wszystkie
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-[#e5e4e2]/60">Wczytywanie...</div>
          ) : offerItems.length === 0 ? (
            <div className="p-8 text-center text-[#e5e4e2]/60">
              Brak pozycji w ofertach dla tego wydarzenia.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0a0d1a] text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                <tr>
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-3 py-2">Oferta</th>
                  <th className="px-3 py-2">Nazwa</th>
                  <th className="px-3 py-2">Kategoria</th>
                  <th className="px-3 py-2">Ilość</th>
                  <th className="px-3 py-2">Cena</th>
                  <th className="px-3 py-2 text-right">Wartość</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d3bb73]/10">
                {offerItems.map((it) => {
                  const alreadyImported = existingRefs.has(it.id);
                  return (
                    <tr
                      key={it.id}
                      className={alreadyImported ? 'opacity-40' : 'hover:bg-[#0a0d1a]/50'}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(it.id)}
                          disabled={alreadyImported}
                          onChange={() => toggle(it.id)}
                          className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a] text-[#d3bb73]"
                        />
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/60">{it.offerName}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]">
                        <div>{it.name}</div>
                        {it.categoryName && (
                          <div className="text-xs text-[#e5e4e2]/40">{it.categoryName}</div>
                        )}
                        {alreadyImported && (
                          <span className="mt-1 inline-block rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-xs text-[#d3bb73]">
                            Już zaimportowano
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={it.autoCategory}
                          disabled={alreadyImported}
                          onChange={(e) => {
                            const newCat = e.target.value as Category;
                            setOfferItems((prev) =>
                              prev.map((p) =>
                                p.id === it.id ? { ...p, autoCategory: newCat } : p,
                              ),
                            );
                          }}
                          className="rounded-md border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        >
                          {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_META[c].label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">
                        {it.quantity} {it.unit}
                      </td>
                      <td className="px-3 py-2 text-[#e5e4e2]/80">{fmt(it.unit_price)}</td>
                      <td className="px-3 py-2 text-right text-[#d3bb73]">{fmt(it.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#d3bb73]/10 px-5 py-3">
          <div className="text-sm text-[#e5e4e2]/60">Zaznaczono: {selected.size}</div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-sm text-[#e5e4e2]/80 hover:bg-[#0a0d1a]"
            >
              Anuluj
            </button>
            <button
              onClick={handleImport}
              disabled={selected.size === 0}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <FileDown className="h-4 w-4" />
              Importuj ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
