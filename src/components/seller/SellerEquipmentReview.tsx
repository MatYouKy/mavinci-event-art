'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { arrangementLocalDate } from '@/lib/seller/arrangements';
import { equipmentReviewLabels, type SellerEquipmentReview as EquipmentReport } from '@/lib/seller/equipmentReview';

export function useSellerEquipmentReview(offerId: string, enabled: boolean, contextKey: string | undefined) {
  const [data, setData] = useState<EquipmentReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled || !contextKey) return;
    const request = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 45000);
    setBusy(true); setError('');
    setData(current => current?.context_key === contextKey ? current : null);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
      const response = await fetch('/bridge/seller/offers/' + offerId, {
        method: 'POST', cache: 'no-store', signal: abort.signal,
        headers: { Authorization: 'Bearer ' + session.session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_equipment', expectedContextKey: contextKey }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Nie udało się sprawdzić sprzętu.');
      if (result.context_key !== contextKey) throw new Error('Dane oferty zmieniły się. Odśwież status oferty przed analizą.');
      if (request === sequence.current) setData(result);
    } catch (cause: any) {
      if (request === sequence.current) {
        setData(null);
        setError(cause?.name === 'AbortError' ? 'Sprawdzanie trwało zbyt długo. Ponów analizę; dostępność nie została potwierdzona.' : cause?.message || 'Analiza jest niedostępna. Ponów sprawdzenie.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (request === sequence.current) setBusy(false);
    }
  }, [offerId, enabled, contextKey]);
  useEffect(() => {
    if (!enabled) { setData(null); setError(''); setBusy(false); }
    else void refresh();
    return () => { ++sequence.current; controller.current?.abort(); };
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, refresh]);
  return { data: data?.context_key === contextKey ? data : null, busy, error, refresh };
}
export type EquipmentReviewState = ReturnType<typeof useSellerEquipmentReview>;
const button = 'inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40';

export function SellerEquipmentStatus({ review }: { review: EquipmentReviewState }) {
  const status = review.data?.status;
  return <div className="space-y-2 rounded-lg bg-white/[0.035] p-3">
    <p className="flex items-start gap-2 text-sm">
      {review.busy ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#d3bb73]"/> : status === 'clear'
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300"/> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200"/>}
      Sprzęt · analiza systemowa
    </p>
    <p role="status" className="text-xs text-white/65">{review.busy ? 'Sprawdzanie magazynu i rezerwacji…' : status ? equipmentReviewLabels[status] : 'Dostępność niepotwierdzona'}</p>
    <a href="#seller-equipment-review" className="text-xs text-[#d3bb73] hover:underline">Wynik analizy ↓</a>
  </div>;
}

export default function SellerEquipmentReview({ review, confirmed, reason, disabled, onConfirmed, onReason }: {
  review: EquipmentReviewState; confirmed: boolean; reason: string; disabled: boolean;
  onConfirmed: (value: boolean) => void; onReason: (value: string) => void;
}) {
  const { data, busy, error } = review;
  return <section id="seller-equipment-review" aria-busy={busy} className="mt-3 scroll-mt-6 space-y-3 rounded-lg bg-white/[0.025] p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs uppercase">Automatyczna kontrola sprzętu</h4>
      <button type="button" className={button} disabled={busy || disabled} onClick={() => void review.refresh()}><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`}/>Sprawdź ponownie</button>
    </div>
    {error && <p role="alert" className="text-amber-200">{error}</p>}
    {!data && !error && <p role="status" className="text-xs text-white/55">Sprawdzamy sprzęt przypisany do produktów i zapisanych konfiguracji…</p>}
    {data && <>
      <p className="text-xs text-white/60">{arrangementLocalDate(data.period.start)} — {arrangementLocalDate(data.period.end)} · czas polski.
        {data.period.whole_days && ' Brak godzin: sprawdzamy pełne dni.'}
        {' Sprzęt jest liczony na cały okres, także pomiędzy dniami wydarzenia.'}
        {data.period.includes_preparation ? ' Uwzględniamy zapisany montaż i demontaż.' : ' Montaż i demontaż trzeba jeszcze uwzględnić po ich ustaleniu.'}
      </p>
      <p className={data.status === 'clear' ? 'text-emerald-200' : 'text-amber-200'}>{equipmentReviewLabels[data.status]} · {data.rows.length} modeli.</p>
      {data.issues.length > 0 && <ul className="space-y-2 text-xs text-amber-100">{data.issues.map((issue, index) => <li key={index}>
        <span className="font-medium">{issue.name}:</span> {issue.message}{issue.product_id && <Link href={`/crm/offers/products/${issue.product_id}`} target="_blank" rel="noreferrer" className="ml-2 text-[#d3bb73] underline underline-offset-2">Produkt ↗</Link>}
      </li>)}</ul>}
      {data.rows.length > 0 && <details open={data.status === 'conflict'} className="rounded-lg bg-black/10 p-3">
        <summary className="cursor-pointer text-xs text-[#d3bb73]">Sprzęt, ilości i powtórzenia w produktach ({data.rows.length})</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[440px] text-left text-xs">
          <thead className="text-white/50"><tr><th className="p-2 font-normal">Sprzęt / produkty</th><th className="p-2 text-right font-normal">Potrzeba</th><th className="p-2 text-right font-normal">Dostępne</th><th className="p-2 text-right font-normal">Brakuje</th></tr></thead>
          <tbody className="divide-y divide-white/5">{data.rows.map(row => <tr key={row.id} className={row.shortage ? 'bg-rose-300/5 text-rose-100' : ''}>
            <td className="p-2"><Link href={`/crm/equipment/${row.id}`} target="_blank" rel="noreferrer" className="text-[#d3bb73] hover:underline">{row.name} ↗</Link>
              <p className="mt-1 text-white/50">{row.sources.join(' · ') || 'Zapisany zamiennik'}</p>
              {row.repeated && <p className="mt-1 text-amber-200">Powtarza się w zakresie — ilości zsumowano</p>}
              <p className="mt-1 text-white/45">Sprawne: {row.total} · zajęte maksymalnie: {row.reserved}</p>
            </td><td className="p-2 text-right tabular-nums">{row.required}</td><td className="p-2 text-right tabular-nums">{row.available}</td><td className="p-2 text-right tabular-nums">{row.shortage || '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
      {data.status !== 'clear' && <div className="space-y-2 rounded-lg bg-amber-300/10 p-3">
        <p className="text-xs text-amber-100">System nie potwierdził pełnej dostępności. Uzupełnij powiązania lub uzgodnij zamienniki. Możesz dopuścić ofertę tylko po osobnej weryfikacji braków.</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={busy || disabled} onChange={event => onConfirmed(event.target.checked)} className="mt-0.5"/>Sprawdziłem niepełny zakres / niedobory poza systemem i potwierdzam sposób zapewnienia sprzętu.</label>
        {confirmed && <label className="block text-xs text-white/65">Wewnętrzne uzasadnienie — nie trafia do sprzedawcy
          <textarea rows={2} minLength={10} maxLength={2000} value={reason} disabled={busy || disabled} onChange={event => onReason(event.target.value)}
            placeholder="Jak zapewnimy brakujące zasoby? Dlaczego wskazana usługa nie wymaga sprzętu?"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 outline-none focus:border-[#d3bb73]/30"/>
          <span className="mt-1 block text-white/45">Co najmniej 10 znaków. Wynik i wyjątek zostaną zapisane w historii kontroli przy decyzji.</span>
        </label>}
      </div>}
      <p className="text-xs leading-5 text-white/45">Ostatnie sprawdzenie: {new Date(data.checked_at).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw' })}. Przed akceptacją sprawdzimy ponownie. To analiza, nie rezerwacja. Powtórzenia są sumowane, nie usuwane. Przewody i obsadę weryfikuje się oddzielnie.</p>
    </>}
  </section>;
}
