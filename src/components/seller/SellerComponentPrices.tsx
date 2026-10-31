'use client';
import { useState } from 'react';
import { sellerConfigurationRequest } from '@/lib/seller/productConfiguration.browser';
import { isSellerLedPackage } from '@/lib/seller/ledPackage';
import type { SellerConfigurationCatalog } from '@/lib/seller/productConfiguration';

export default function SellerComponentPrices({ partnerId, brandId, productId }: { partnerId: string; brandId: string; productId: string }) {
  const [data, setData] = useState<SellerConfigurationCatalog | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const load = async () => {
    setBusy(true); setMessage('');
    try { setData(await sellerConfigurationRequest<SellerConfigurationCatalog>(productId, brandId, { partnerId })); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Nie udało się odczytać stawek.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!data) return;
    setBusy(true); setMessage('');
    try {
      await sellerConfigurationRequest(productId, brandId, { partnerId, method: 'PUT', body: { revision: data.revision, rates: data.rates } });
      setData(await sellerConfigurationRequest<SellerConfigurationCatalog>(productId, brandId, { partnerId }));
      setMessage('Stawki zapisane. Zapisane konfiguracje wcześniejszych ofert nie zostały przeliczone.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Nie udało się zapisać stawek.'); }
    finally { setBusy(false); }
  };
  return <details className="m-4 rounded-lg bg-black/10 p-3"><summary className="cursor-pointer text-sm text-[#d3bb73]" onClick={() => { if (!data && !busy) void load(); }}>Ceny konfiguracji i rozszerzeń dla tego sprzedawcy</summary>
    <p className="my-3 text-xs text-white/50">Dotyczą produktu podstawowego. Puste pole oznacza „do wyceny”, 0 oznacza składnik wliczony w cenę. Stawki magazynowe nie są automatycznie udostępniane sprzedawcy. Dostępność produktu włącz i zapisz w cenniku powyżej.</p>
    {message && <p role="status" className="my-3 text-sm text-amber-100">{message}</p>}
    {busy && <p role="status" className="text-sm">Zapisywanie / pobieranie stawek…</p>}
    {data && isSellerLedPackage(data.configuration) && <p className="my-3 rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#d3bb73]">Dla ekranu LED ustaw jedną pełną stawkę za m² i dzień, uwzględniającą konstrukcję, procesor oraz realizatora. Sprzedawca wybiera tylko wymiary. Brak stawki blokuje zatwierdzenie wyceny; cen magazynowych ani wcześniejszych cen samych kabinetów nie używamy jako ceny pakietu.</p>}
    {data?.rates.map(r => <label key={r.key} className="mb-2 flex items-center justify-between gap-3 text-sm"><span>{r.label}</span><input type="number" min="0" max="9999999" step="0.01" disabled={busy} value={r.price ?? ''} placeholder="Do wyceny" className="w-36 rounded-lg bg-black/20 p-2" onChange={e => setData({ ...data, rates: data.rates.map(row => row.key === r.key ? { ...row, price: e.target.value === '' ? null : e.target.valueAsNumber } : row) })} /></label>)}
    {data && !data.rates.length && <p className="text-sm text-white/50">Produkt nie ma konfiguratora ani rozszerzeń. Używa ceny podstawowej lub wariantu.</p>}
    <div className="mt-3 flex gap-3"><button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg bg-white/5 px-3 py-2 text-sm">Wczytaj aktualne stawki</button>{Boolean(data?.rates.length) && <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-sm text-[#d3bb73]">Zapisz stawki konfiguracji</button>}</div>
  </details>;
}
