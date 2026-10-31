'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import SellerLedPackageConfigurator from './SellerLedPackageConfigurator';
import { isSellerLedPackage } from '@/lib/seller/ledPackage';
import ModularProductConfigurator from '@/components/crm/offers/ModularProductConfigurator';
import { configurationPrice, type OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { calculateModular } from '@/lib/CRM/Offers/modularProduct';
import { applySellerSelection, missingSellerConfigurationRate } from '@/lib/seller/productSelection';
import { sellerConfigurationRequest } from '@/lib/seller/productConfiguration.browser';
import type { SellerConfigurationCatalog, SellerConfigurationQuote } from '@/lib/seller/productConfiguration';
import { sellerMoney } from '@/lib/seller/portal';

export default function SellerProductConfigurator({ productId, brandId, initial, onCancel, onAdd }: {
  productId: string; brandId: string; initial?: OfferConfiguration; onCancel: () => void; onAdd: (quote: SellerConfigurationQuote) => void;
}) {
  const [catalog, setCatalog] = useState<SellerConfigurationCatalog | null>(null);
  const [configuration, setConfiguration] = useState<OfferConfiguration | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setCatalog(null); setConfiguration(null); setError('');
    sellerConfigurationRequest<SellerConfigurationCatalog>(productId, brandId).then(result => {
      if (!active) return;
      setCatalog(result);
      setConfiguration(initial ? applySellerSelection(result.configuration, initial) : result.configuration);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [productId, brandId, revision, initial]);
  const save = async () => {
    if (!catalog || !configuration || busy) return;
    const configurationError = configuration.modular ? calculateModular(configuration.modular).error : null;
    const rateError = missingSellerConfigurationRate(configuration, catalog.rates);
    if (configurationError || rateError) { setError(rateError || configurationError || 'Uzupełnij konfigurację.'); return; }
    setBusy(true); setError('');
    try {
      const quote = await sellerConfigurationRequest<SellerConfigurationQuote>(productId, brandId, { method: 'POST', body: { revision: catalog.revision, configuration } });
      onAdd(quote);
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać konfiguracji.'); }
    finally { setBusy(false); }
  };
  const missingRate = configuration && catalog ? missingSellerConfigurationRate(configuration, catalog.rates) : null;
  const configurationError = configuration?.modular ? calculateModular(configuration.modular).error : null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-labelledby="seller-product-heading">
    <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-[var(--brand-burgundy-900,#341021)] p-5 text-[#e5e4e2] shadow-xl">
      <div className="mb-4 flex items-start justify-between gap-4"><div><h2 id="seller-product-heading" className="text-lg">{catalog?.name || 'Konfiguracja produktu'}</h2><p className="mt-1 text-sm text-white/60">{isSellerLedPackage(configuration) ? 'Wybierz wymiary. Pełną obsługę liczymy według Twojej stawki pakietowej za m².' : 'Wybierz rozmiar i wyposażenie. Używamy Twojego indywidualnego cennika.'}</p></div><button type="button" autoFocus disabled={busy} onClick={onCancel} aria-label="Zamknij konfigurator" className="rounded-lg bg-white/5 px-3 py-2">✕</button></div>
      {initial && <p className="mb-4 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">Zmiana konfiguracji korzysta z aktualnego cennika. Dopiero zatwierdzenie poniżej zastąpi poprzednią wycenę.</p>}
      {error && <div role="alert" className="mb-4 rounded-lg bg-red-300/10 p-3 text-sm text-red-100">{error}<button type="button" disabled={busy} className="ml-3 underline" onClick={() => setRevision(n => n + 1)}>Wczytaj aktualny cennik</button></div>}
      {!configuration && !error && <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-48 flex-col items-center justify-center gap-4 rounded-xl bg-white/[0.03] p-6"><Loader2 aria-hidden="true" className="h-10 w-10 animate-spin text-[#d3bb73]" /><p className="text-center text-sm">Pobieramy konfigurator, dostępne wyposażenie i Twój cennik…</p><p className="text-xs text-white/50">Za chwilę wybierzesz rozmiar i dodatki.</p></div>}
      {isSellerLedPackage(configuration)
        ? <SellerLedPackageConfigurator disabled={busy} value={configuration.modular} onChange={modular => { setConfiguration({ ...configuration, modular }); setError(''); }} />
        : configuration?.modular && <ModularProductConfigurator seller disabled={busy} value={configuration.modular} onChange={modular => setConfiguration({ ...configuration, modular })} />}
      {isSellerLedPackage(configuration) && configurationError && !missingRate && <p role="alert" className="my-3 text-sm text-amber-100">{configurationError}</p>}
      {missingRate && <p role="alert" className="my-3 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">{missingRate}</p>}
      {configuration && !configuration.modular && <div className="space-y-3">{configuration.addons.map(a => <label key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/5 p-3"><span>{a.name}<small className="mt-1 block text-white/60">{a.price_on_request ? 'Do wyceny przez opiekuna' : `${sellerMoney(a.unit_price)} netto / ${a.unit}`}{a.kind === 'over_limit' ? ` · w cenie ${a.included_quantity} ${a.unit}` : ''}</small></span>{a.kind === 'optional' ? <input type="checkbox" disabled={busy} checked={a.enabled} onChange={e => setConfiguration({ ...configuration, addons: configuration.addons.map(x => x.id === a.id ? { ...x, enabled: e.target.checked } : x) })} /> : <input type="number" aria-label={'Ilość: ' + a.name} min="0" step="0.01" disabled={busy} value={a.quantity} onChange={e => setConfiguration({ ...configuration, addons: configuration.addons.map(x => x.id === a.id ? { ...x, quantity: e.target.valueAsNumber } : x) })} className="w-24 rounded-lg bg-black/20 p-2" />}</label>)}<p className="text-right text-[#d3bb73]">Wstępnie: {sellerMoney(configurationPrice(configuration))} netto</p></div>}
      <p className="my-4 text-xs leading-5 text-white/60">Konfiguracja nie rezerwuje sprzętu ani terminu. Opiekun sprawdzi dostępność, a potwierdzenie wydarzenia otrzymasz w tej samej sprawie. Brak stawki wymaga wyceny — nie oznacza ceny 0 zł.</p>
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg bg-white/5 px-4 py-3">Anuluj</button><button type="button" disabled={busy || !configuration || Boolean(configurationError || missingRate)} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 font-medium text-[#200711] disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true"/>}{busy ? 'Sprawdzanie wyceny…' : 'Zatwierdź konfigurację i cenę'}</button></div>
    </section>
  </div>;
}
