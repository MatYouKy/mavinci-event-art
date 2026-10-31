'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CommissionSettlement } from '@/lib/CRM/events/commissionSettlements';
import { commissionStatusLabels, formatCommissionMoney } from '@/lib/CRM/events/eventCommission';

export default function SellerRealizationCommission({ eventId, revision, commissionEnabled }: { eventId: string | null; revision: number; commissionEnabled?: boolean }) {
  const [rows, setRows] = useState<CommissionSettlement[] | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!eventId) { setRows(null); return; }
    let active = true;
    fetch(`/bridge/commissions/settlements?mode=seller&eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' }).then(async response => {
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.commissions)) throw new Error(result.error || 'Rozliczenia chwilowo niedostępne.');
      if (active) { setRows(result.commissions); setError(''); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [eventId, revision, retry]);
  return <section id="seller-realization-commission" className="scroll-mt-6 rounded-xl bg-[#1c1f33] p-5">
    <h2 className="text-base uppercase">Twoje rozliczenie tej realizacji</h2>
    {error && <p role="alert" className="mt-3 text-sm text-amber-100">{error} Wcześniejsze dane mogą być nieaktualne. <button type="button" onClick={() => setRetry(n => n + 1)} className="underline">Spróbuj ponownie</button></p>}
    {!eventId ? <p className="mt-3 text-sm text-white/60">Po utworzeniu wydarzenia przez opiekuna pojawi się tutaj jego rozliczenie. Kwota szacowana w ofercie nie jest jeszcze zatwierdzoną wypłatą.</p>
      : rows === null ? <p role="status" className="mt-3 text-sm text-white/60">Wczytywanie rozliczenia…</p>
      : !rows.length ? <p className="mt-3 text-sm text-white/60">{commissionEnabled === false ? 'Brak naliczeń prowizyjnych dla tej realizacji. Marża z własnej ceny dla klienta jest osobnym modelem i nie oznacza wypłaty prowizji przez MAVINCI.' : 'Nie zapisano jeszcze Twojego naliczenia dla tego wydarzenia. Uzgodnij je z opiekunem w tej samej rozmowie.'}</p>
      : <div className="mt-4 space-y-4">{rows.map(row => <article key={row.id} className="rounded-lg bg-white/5 p-4"><p className="text-sm text-[#d3bb73]">{row.automatic_waiting_for_offer ? 'Oczekuje na ustalenie podstawy' : commissionStatusLabels[row.status] || 'Status do wyjaśnienia z opiekunem'}</p><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-white/50">Kwota naliczenia</dt><dd className="mt-1">{formatCommissionMoney(row.amount)}</dd></div><div><dt className="text-xs text-white/50">Wypłacono</dt><dd className="mt-1">{formatCommissionMoney(row.paid_amount)}</dd></div><div><dt className="text-xs text-white/50">Pozostałe saldo</dt><dd className="mt-1">{formatCommissionMoney(row.remaining_amount)}</dd></div></dl>{row.payments.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer text-[#d3bb73]">Historia wypłat ({row.payments.length})</summary><ul className="mt-2 space-y-2">{row.payments.map(payment => <li key={payment.id}>{payment.payment_date ? payment.payment_date.slice(0, 10).split('-').reverse().join('.') : 'Data niepodana'} · {formatCommissionMoney(payment.amount)}{payment.reference ? ` · ${payment.reference}` : ''}</li>)}</ul></details>}</article>)}</div>}
    <p className="mt-3 text-xs leading-5 text-white/45">Dane pochodzą z rozliczeń CRM. Status wydarzenia, naliczenie prowizji i wykonanie wypłaty są osobnymi informacjami.</p>
    <Link href="/seller/commissions" className="mt-3 inline-block text-sm text-[#d3bb73] underline">Wszystkie moje rozliczenia</Link>
  </section>;
}
