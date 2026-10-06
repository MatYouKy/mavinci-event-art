'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Copy } from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import SystemBadge from '@/components/UI/SystemBadge';
import { getOfferPricingTotals } from '@/lib/CRM/Offers/offerTotals';

export default function InquiryOffersPanel({ offers, selectedId, canManage, onCreate, onChanged }: {
  offers: any[]; selectedId: string | null; canManage: boolean; onCreate: () => void; onChanged: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [choice, setChoice] = useState<any>(null);
  const [note, setNote] = useState('');
  const [packageId, setPackageId] = useState('');
  const run = async (operation: () => Promise<void>) => {
    if (lock.current || !canManage) return;
    lock.current = true; setBusy(true);
    try { await operation(); onChanged(); }
    catch (error: any) { showSnackbar(error.message || 'Nie udało się zapisać zmiany.', 'error'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl bg-[#1c1f33] p-5">
    <div className="flex items-center justify-between"><h2 className="text-lg">Warianty ofert</h2>{canManage && <button disabled={busy} type="button" onClick={onCreate} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33]">Nowa oferta</button>}</div>
    <p className="text-sm opacity-60">Każda oferta ma własny zakres i wycenę. Możesz skopiować wariant i zmienić jego treść. Akceptacja zapisuje wybór klienta.</p>
    {!offers.length && <p className="text-sm opacity-60">Brak ofert dla tego zapytania.</p>}
    {offers.map(offer => <article key={offer.id} className="space-y-3 rounded-lg bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/crm/offers/${offer.id}`} className="min-w-0 flex-1 break-words text-[#d3bb73]">{offer.offer_number} — {offer.title || 'Oferta'}</Link>
        <div className="flex shrink-0 items-center gap-2">
          <SystemBadge value={offer.status} />
          {canManage && <ResponsiveActionBar
            alwaysDropdown
            compact
            disabledBackground
            actions={[
              {
                label: 'Duplikuj',
                icon: <Copy className="h-4 w-4" />,
                disabled: busy,
                onClick: () => void run(async () => {
                  const { error } = await supabase.rpc('duplicate_sales_offer', { p_offer: offer.id, p_request_id: crypto.randomUUID() });
                  if (error) throw error;
                  showSnackbar('Utworzono kopię oferty.', 'success');
                }),
              },
              {
                label: 'Zapisz akceptację klienta',
                icon: <CheckCircle2 className="h-4 w-4" />,
                variant: 'primary',
                show: !offer.event_id && selectedId !== offer.id,
                disabled: busy || Boolean(selectedId),
                onClick: () => { setChoice(offer); setPackageId(''); setNote(''); },
              },
              {
                label: 'Akceptacja i rezerwacje',
                icon: <ArrowRight className="h-4 w-4" />,
                show: Boolean(offer.event_id),
                onClick: () => router.push(`/crm/offers/${offer.id}`),
              },
            ]}
          />}
        </div>
      </div>
      {offer.package_mode && offer.pricing_source !== 'calculation' ? <p className="text-sm">{(offer.offer_packages || []).filter((pkg: any) => !offer.accepted_package_id || pkg.id === offer.accepted_package_id).map((pkg: any) => `${pkg.name}: ${Number(pkg.price_net).toLocaleString('pl-PL')} zł netto`).join(' · ')}</p> : <p className="text-sm">{getOfferPricingTotals(offer).gross.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })} brutto{offer.pricing_source === 'calculation' ? ` · kalkulacja: ${offer.calculation_snapshot?.name || 'Zapisana wersja'}` : ' · pozycje oferty'}</p>}
      {selectedId === offer.id && <p className="text-sm text-green-300">Wybrana przez klienta</p>}

    </article>)}
    {selectedId && <p className="text-xs opacity-60">Aby zmienić zaakceptowaną ofertę, najpierw otwórz negocjacje ponownie, podając powód.</p>}
    {choice && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-lg space-y-4 rounded-xl bg-[#1c1f33] p-6">
      <h3 className="text-lg">Akceptacja: {choice.offer_number}</h3>
      <p className="text-sm opacity-60">Zapisz, kto i w jaki sposób potwierdził zakres. Rezerwację zasobów zatwierdzisz przy przekazaniu do realizacji.</p>
      {choice.package_mode && <label className="block text-sm">Pakiet<select value={packageId} onChange={e => setPackageId(e.target.value)} className="mt-2 w-full rounded bg-black/20 p-3"><option value="">Wybierz pakiet</option>{(choice.offer_packages || []).map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="Potwierdzenie klienta, np. rozmowa z dnia…" className="w-full rounded border border-white/10 bg-black/20 p-3" />
      <div className="flex justify-end gap-4"><button disabled={busy} onClick={() => setChoice(null)}>Anuluj</button><button disabled={busy || !note.trim() || (choice.package_mode && !packageId)} className="rounded bg-[#d3bb73] px-4 py-2 text-[#1c1f33] disabled:opacity-40" onClick={() => void run(async () => { const { error } = await supabase.rpc('accept_inquiry_offer', { p_offer: choice.id, p_note: note, p_expected_selected: selectedId, p_package: packageId || null }); if (error) throw error; setChoice(null); showSnackbar('Zapisano zaakceptowany wariant.', 'success'); })}>Potwierdź wybór</button></div>
    </div></div>}
  </section>;
}
