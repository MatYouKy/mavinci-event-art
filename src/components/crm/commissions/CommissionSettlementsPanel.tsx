'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Banknote, Check, Loader2, RefreshCw, Search, X } from 'lucide-react';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import CommissionEarningsChart from './CommissionEarningsChart';
import { buildCommissionSettlementStats } from '@/lib/CRM/events/commissionSettlementStats';
import type { CommissionSettlement, CommissionSettlementsResponse, CommissionSettlementAccountType } from '@/lib/CRM/events/commissionSettlements';
import { commissionPaymentLabels, commissionStatusLabels, formatCommissionMoney } from '@/lib/CRM/events/eventCommission';

type Props = { mode: 'crm' | 'seller'; accountType?: CommissionSettlementAccountType; accountId?: string };
type PaymentDraft = { commissionId: string; amount: number; paymentDate: string; reference: string; note: string; idempotencyKey: string };
const fieldClass = 'w-full rounded-lg border border-white/10 bg-[var(--brand-burgundy-950,#200711)] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-white/30 focus:border-white/20';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-[#d3bb73] transition-colors hover:bg-white/10 disabled:opacity-40';
const money = (amount: number) => formatCommissionMoney(Number(amount || 0));
const dateLabel = (value: string | null) => value ? value.slice(0, 10).split('-').reverse().join('.') : 'Data nie została zapisana';
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
const cents = (value: number) => Math.round(Number(value || 0) * 100);
const amountFromText = (value: string): number | null => {
  const text = value.replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const parsed = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed / 100 : null;
};

export default function CommissionSettlementsPanel(props: Props) {
  return <SettlementsWorkspace key={`${props.mode}:${props.accountType || ''}:${props.accountId || ''}`} {...props} />;
}

function SettlementsWorkspace({ mode, accountType, accountId }: Props) {
  const pendingStorageKey = `commission-payment-pending:${mode}:${accountType || ''}:${accountId || ''}`;
  const [data, setData] = useState<CommissionSettlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [brand, setBrand] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'open' | 'all' | 'history'>('open');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(today);
  const [dateValid, setDateValid] = useState(true);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const pendingPayment = useRef<PaymentDraft | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ mode });
      if (mode === 'crm') {
        if (!accountType || !accountId) throw new Error('Brak wskazanego konta rozliczeń.');
        params.set('accountType', accountType);
        params.set('accountId', accountId);
      }
      const response = await fetch(`/bridge/commissions/settlements?${params}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.commissions)) throw new Error(result.error || 'Nie udało się wczytać rozliczeń.');
      if (request === sequence.current) setData(result as CommissionSettlementsResponse);
      return result as CommissionSettlementsResponse;
    } catch (failure) {
      if (request === sequence.current) {
        setData(null);
        setError(failure instanceof Error ? failure.message : 'Nie udało się wczytać rozliczeń.');
      }
      return null;
    } finally { if (request === sequence.current) setLoading(false); }
  }, [mode, accountType, accountId]);

  useEffect(() => {
    if (mode === 'crm') {
      try {
        const stored = sessionStorage.getItem(pendingStorageKey);
        if (stored) {
          const draft = JSON.parse(stored) as PaymentDraft;
          if (typeof draft.commissionId === 'string' && typeof draft.idempotencyKey === 'string' && Number.isFinite(draft.amount) && draft.amount > 0 && typeof draft.paymentDate === 'string') {
            pendingPayment.current = draft;
            setSelectedId(draft.commissionId);
            setAmount(draft.amount.toFixed(2).replace('.', ','));
            setPaymentDate(draft.paymentDate);
            setReference(draft.reference || '');
            setNote(draft.note || '');
            setConfirmed(true);
            setUncertain(true);
          }
        }
      } catch { /* A retry is never sent automatically on page load. */ }
    }
    void load();
    return () => { sequence.current += 1; };
  }, [load, mode, pendingStorageKey]);
  useEffect(() => { setPage(1); }, [query, brand, view]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!busy && !uncertain) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [busy, uncertain]);

  const rows = data?.commissions || [];
  const brands = useMemo(() => {
    const result = new Map<string, string>();
    for (const row of rows) if (row.my_company_id) result.set(row.my_company_id, row.company_name || 'Marka bez nazwy');
    return [...result.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pl'));
  }, [rows]);
  const brandRows = useMemo(() => rows.filter(row => !brand || row.my_company_id === brand), [rows, brand]);
  const stats = useMemo(() => buildCommissionSettlementStats(brandRows), [brandRows]);
  const normalizedQuery = query.trim().toLocaleLowerCase('pl-PL');
  const matches = (row: CommissionSettlement) => !normalizedQuery || [row.event_name, row.beneficiary_name, row.company_name, row.event_date].join(' ').toLocaleLowerCase('pl-PL').includes(normalizedQuery);
  const filteredRows = brandRows.filter(row => matches(row) && (view !== 'open' || (row.status !== 'cancelled' && row.status !== 'paid' && (row.automatic_waiting_for_offer || Number(row.remaining_amount) > 0))));
  const payments = brandRows.flatMap(row => row.payments.map(payment => ({ row, payment })))
    .filter(({ row, payment }) => matches(row) || [payment.reference, payment.note].join(' ').toLocaleLowerCase('pl-PL').includes(normalizedQuery))
    .sort((a, b) => (b.payment.payment_date || '').localeCompare(a.payment.payment_date || '') || (b.payment.recorded_at || '').localeCompare(a.payment.recorded_at || '') || a.payment.id.localeCompare(b.payment.id));
  const count = view === 'history' ? payments.length : filteredRows.length;
  const pages = Math.max(1, Math.ceil(count / 15));
  const currentPage = Math.min(page, pages);
  const selected = rows.find(row => row.id === selectedId);

  const openPayment = (row: CommissionSettlement) => {
    if (busy || uncertain || !row.can_manage || row.status !== 'approved') return;
    pendingPayment.current = null;
    setSelectedId(row.id);
    setAmount(Number(row.remaining_amount).toFixed(2).replace('.', ','));
    setPaymentDate(today());
    setDateValid(true);
    setReference('');
    setNote('');
    setConfirmed(false);
    setFormError('');
    setNotice('');
  };
  const closePayment = () => {
    if (busy || uncertain) return;
    setSelectedId('');
    pendingPayment.current = null;
  };
  const approve = async (row: CommissionSettlement) => {
    if (busy || uncertain || mode !== 'crm' || !row.can_manage || row.status !== 'planned' || row.automatic_waiting_for_offer) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/bridge/commissions/settlements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', commissionId: row.id, expectedAmount: Number(row.amount) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Nie udało się zatwierdzić prowizji.');
      setNotice('Prowizja zatwierdzona. Wypłatę zapisz dopiero po jej faktycznym wykonaniu.');
      await load();
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Nie udało się zatwierdzić prowizji. Odśwież jej status przed ponowieniem.');
    } finally { setBusy(false); }
  };
  const savePayment = async () => {
    if (busy || mode !== 'crm') return;
    let payload = pendingPayment.current;
    if (!payload) {
      const value = amountFromText(amount);
      if (!selected?.can_manage || selected.status !== 'approved' || selected.automatic_waiting_for_offer) { setFormError('Ta prowizja nie jest gotowa do rozliczenia. Odśwież dane.'); return; }
      if (value === null || cents(value) > cents(Number(selected.remaining_amount))) { setFormError('Podaj dodatnią kwotę nie większą niż pozostałe saldo, z maksymalnie dwoma miejscami po przecinku.'); return; }
      if (!dateValid || !paymentDate || paymentDate > today()) { setFormError('Wpisz prawidłową datę wykonanej wypłaty, nie późniejszą niż dzisiaj.'); return; }
      if (!confirmed) { setFormError('Potwierdź, że ta wypłata została już wykonana.'); return; }
      payload = { commissionId: selected.id, amount: value, paymentDate, reference: reference.trim(), note: note.trim(), idempotencyKey: crypto.randomUUID() };
      try { sessionStorage.setItem(pendingStorageKey, JSON.stringify(payload)); }
      catch { setFormError('Nie udało się zachować identyfikatora operacji w tej karcie. Zapis nie został wysłany — sprawdź dostępność pamięci przeglądarki.'); return; }
      pendingPayment.current = payload;
    }
    setBusy(true);
    setFormError('');
    let outcomeKnown = false;
    try {
      const response = await fetch('/bridge/commissions/settlements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        // Server errors can occur after a commit. Keep exactly the same request for a safe retry.
        if (response.status < 500 && result.error) {
          outcomeKnown = true;
          try { sessionStorage.removeItem(pendingStorageKey); } catch { /* Repeating the stored key remains idempotent. */ }
          pendingPayment.current = null;
          setUncertain(false);
        }
        throw new Error(result.error || 'Nie udało się potwierdzić zapisu wypłaty.');
      }
      if (!result.ok) throw new Error('Brak potwierdzenia zapisu wypłaty.');
      outcomeKnown = true;
      try { sessionStorage.removeItem(pendingStorageKey); } catch { /* Repeating the stored key remains idempotent. */ }
      pendingPayment.current = null;
      setUncertain(false);
      setSelectedId('');
      setNotice(result.duplicate ? 'Ta wypłata była już zapisana — nie dodano duplikatu.' : 'Wypłata zapisana. Saldo zostało pomniejszone, historia pozostaje dostępna.');
      window.dispatchEvent(new Event('commission-settlements-changed'));
      await load();
    } catch (failure) {
      if (!outcomeKnown) setUncertain(true);
      setFormError(failure instanceof Error ? failure.message : 'Nie udało się potwierdzić zapisu.');
    } finally { setBusy(false); }
  };

  return <section className="space-y-5 text-[#e5e4e2]">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Banknote className="h-5 w-5 text-[#d3bb73]" />Rozliczenia prowizji</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-white/50">{mode === 'seller' ? 'Twoje naliczenia, zarejestrowane wypłaty i pozostałe saldo. Dane obejmują dostępne dla Ciebie marki.' : 'Zapisuj wykonane wypłaty w całości lub częściach. Ten rejestr nie wykonuje przelewów bankowych.'} Kwoty dotyczą wynagrodzenia osoby, nie kosztu podatkowego spółki.</p></div>
      <button type="button" disabled={busy || loading} onClick={() => void load()} className={buttonClass}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież</button>
    </header>
    {notice && <p role="status" className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#d3bb73]">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-400/10 p-4 text-sm text-rose-200">{error} Saldo nie jest pokazywane jako zero — odśwież dane.</p>}
    {loading && !data && <p className="flex items-center gap-2 py-8 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Wczytuję rozliczenia…</p>}
    {uncertain && <div role="alert" className="rounded-xl bg-amber-300/10 p-4 text-sm text-amber-200"><p>Odpowiedź na zapis jest niepewna. Nie wpisuj tej wypłaty ponownie jako nowej i nie zamykaj strony. Ponowienie użyje tego samego identyfikatora i nie doda duplikatu.</p><button type="button" disabled={busy} className={`${buttonClass} mt-3`} onClick={() => void savePayment()}>{busy ? 'Sprawdzam…' : 'Ponów bezpiecznie zapis tej wypłaty'}</button></div>}
    {data && <>
      {brands.length > 1 && <label className="block max-w-xs text-xs text-white/55">Marka rozliczenia<select value={brand} onChange={event => setBrand(event.target.value)} className={`${fieldClass} mt-1.5`}><option value="">Wszystkie dostępne marki</option>{brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
      <CommissionEarningsChart summary={stats} />
      <p className="text-xs leading-5 text-white/40">Podsumowanie obejmuje całą historię wybranej marki. Filtry listy nie zmieniają sum. Planowana prowizja nie jest jeszcze zatwierdzoną należnością do wypłaty.</p>
      {selected && mode === 'crm' && <form onSubmit={event => { event.preventDefault(); void savePayment(); }} className="rounded-xl bg-white/[0.045] p-5">
        <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Zapis wykonanej wypłaty</h3><p className="mt-1 text-sm text-[#d3bb73]">{selected.event_name || 'Wydarzenie'} · {selected.beneficiary_name}</p><p className="mt-1 text-xs text-white/50">Naliczone: {money(Number(selected.amount))} · Wypłacone: {money(Number(selected.paid_amount))} · Pozostało: {money(Number(selected.remaining_amount))}</p></div><button type="button" aria-label="Zamknij formularz wypłaty" disabled={busy || uncertain} onClick={closePayment} className={buttonClass}><X className="h-4 w-4" /></button></div>
        <fieldset disabled={busy || uncertain} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="text-xs text-white/55">Kwota wypłacona (PLN)<input required inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} className={`${fieldClass} mt-1.5`} /><span className="mt-1 block text-white/35">Może być mniejsza od pozostałego salda.</span></label>
          <SellerDatePicker value={paymentDate} onChange={setPaymentDate} onValidityChange={setDateValid} label="Data faktycznej wypłaty" />
          <label className="text-xs text-white/55">Numer przelewu / dokumentu (opcjonalnie)<input value={reference} maxLength={200} onChange={event => setReference(event.target.value)} className={`${fieldClass} mt-1.5`} placeholder="Np. numer referencyjny przelewu" /></label>
          <label className="text-xs text-white/55">Opis rozliczenia (opcjonalnie)<textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} className={`${fieldClass} mt-1.5 resize-y`} rows={2} placeholder="Np. pierwsza część prowizji za realizację…" /><span className="mt-1 block text-white/35">Notatka wewnętrzna CRM.</span></label>
          <label className="flex items-start gap-2 text-xs leading-5 text-white/65 sm:col-span-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#d3bb73]" />Potwierdzam, że wskazana wypłata została wykonana. Zapisuję jej historię, nie zlecam przelewu.</label>
        </fieldset>
        {formError && <p role="alert" className="mt-3 text-sm text-rose-200">{formError}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy || uncertain} onClick={closePayment} className={buttonClass}>Anuluj</button><button type="submit" disabled={busy || uncertain || !confirmed} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#211017] disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Zapisz wykonaną wypłatę</button></div>
      </form>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Widok rozliczeń" className="flex flex-wrap gap-2">{([{ id: 'open', label: 'Do rozliczenia' }, { id: 'all', label: 'Wszystkie naliczenia' }, { id: 'history', label: 'Historia wypłat' }] as const).map(item => <button type="button" key={item.id} onClick={() => setView(item.id)} aria-pressed={view === item.id} className={`${buttonClass} ${view === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/55'}`}>{item.label}</button>)}</nav>
        <div className="relative w-full sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-white/35" /><input aria-label="Szukaj w rozliczeniach" value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'history' ? 'Wydarzenie, opis lub numer wypłaty…' : 'Wydarzenie lub beneficjent…'} className={`${fieldClass} pl-9`} /></div>
      </div>
      {view === 'history' ? <div className="space-y-2">{payments.slice((currentPage - 1) * 15, currentPage * 15).map(({ row, payment }) => <article key={`${row.id}:${payment.id}`} className="rounded-xl bg-white/[0.035] p-4">
        <div className="flex flex-wrap justify-between gap-3"><div><p className="text-sm font-medium">{dateLabel(payment.payment_date)} · {row.event_name || 'Wydarzenie'}</p><p className="mt-1 text-xs text-white/45">{row.beneficiary_name}{row.company_name ? ` · ${row.company_name}` : ''}</p></div><p className="whitespace-nowrap text-sm font-semibold text-emerald-300">{money(Number(payment.amount))}</p></div>
        {payment.reference && <p className="mt-2 break-words text-xs text-white/60">Numer przelewu / dokumentu: {payment.reference}</p>}
        {mode === 'crm' && payment.note && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-white/55">{payment.note}</p>}
        {payment.source === 'legacy' && <p className="mt-2 text-xs text-amber-200/75">Historyczne oznaczenie „wypłacona”.{payment.payment_date ? ' Data pochodzi z wcześniejszego zapisu statusu, nie z potwierdzenia bankowego.' : ' Nie uzupełniamy brakującej daty domyślnie.'} Brak osobnego zapisu przelewu.</p>}
      </article>)}</div> : <div className="overflow-x-auto rounded-xl bg-white/[0.025]">
        <table className="w-full text-left text-xs"><thead className="bg-white/[0.035] text-[10px] uppercase tracking-wide text-white/40"><tr><th className="px-4 py-3 font-medium">Za co / kiedy</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 text-right font-medium">Naliczone</th><th className="px-3 py-3 text-right font-medium">Wypłacone</th><th className="px-3 py-3 text-right font-medium">Pozostało</th>{mode === 'crm' && <th className="px-4 py-3 text-right font-medium">Rozliczenie</th>}</tr></thead>
          <tbody className="divide-y divide-white/5">{filteredRows.slice((currentPage - 1) * 15, currentPage * 15).map(row => <tr key={row.id}>
            <td className="min-w-[190px] max-w-sm px-4 py-3"><p className="font-medium text-[#e5e4e2]">{mode === 'crm' ? <Link href={`/crm/events/${row.event_id}?tab=overview`} className="hover:text-[#d3bb73] hover:underline">{row.event_name || 'Wydarzenie'}</Link> : row.event_name || 'Wydarzenie'}</p><p className="mt-1 text-white/40">{row.event_date ? dateLabel(row.event_date) : 'Bez daty wydarzenia'}{row.company_name ? ` · ${row.company_name}` : ''}</p><p className="mt-1 text-white/40">{row.beneficiary_name}</p>{row.due_date && <p className="mt-1 text-white/40">Termin rozliczenia: {dateLabel(row.due_date)}</p>}</td>
            <td className="px-3 py-3"><span className={`rounded-md px-2 py-1 ${row.status === 'paid' ? 'bg-emerald-300/10 text-emerald-300' : row.status === 'approved' ? 'bg-[#d3bb73]/10 text-[#d3bb73]' : 'bg-white/5 text-white/50'}`}>{row.automatic_waiting_for_offer ? 'Oczekuje na podstawę' : Number(row.paid_amount) > 0 && row.status === 'approved' ? 'Częściowo wypłacona' : commissionStatusLabels[row.status]}</span><p className="mt-2 text-[10px] text-white/35">{commissionPaymentLabels[row.payment_method]}</p></td>
            <td className="whitespace-nowrap px-3 py-3 text-right">{row.automatic_waiting_for_offer ? 'Nieustalone' : money(Number(row.amount))}</td><td className="whitespace-nowrap px-3 py-3 text-right text-emerald-300">{money(Number(row.paid_amount))}</td><td className="whitespace-nowrap px-3 py-3 text-right text-[#d3bb73]">{row.automatic_waiting_for_offer ? '—' : money(Number(row.remaining_amount))}</td>
            {mode === 'crm' && <td className="px-4 py-3 text-right">{row.can_manage && !row.automatic_waiting_for_offer && Number(row.amount) > 0 && row.status === 'planned' ? <button type="button" disabled={busy || uncertain || Boolean(selectedId)} className={buttonClass} onClick={() => void approve(row)}>Zatwierdź do wypłaty</button> : row.can_manage && row.status === 'approved' && Number(row.remaining_amount) > 0 ? <button type="button" disabled={busy || uncertain || Boolean(selectedId)} className={buttonClass} onClick={() => openPayment(row)}>Zapisz wypłatę</button> : <span className="text-white/30">{row.automatic_waiting_for_offer ? 'Ustal podstawę w wydarzeniu' : row.status === 'paid' ? 'Rozliczona' : '—'}</span>}</td>}
          </tr>)}</tbody></table>
      </div>}
      {count === 0 && <p className="rounded-lg bg-white/[0.02] px-4 py-8 text-center text-sm text-white/40">{normalizedQuery ? 'Brak wyników dla tego wyszukiwania.' : view === 'history' ? 'Brak zapisanych wypłat.' : view === 'open' ? 'Brak nierozliczonych prowizji w tym zakresie.' : 'Brak naliczeń w tym zakresie.'}</p>}
      {pages > 1 && <div className="flex items-center justify-center gap-4 text-xs text-white/50"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className={buttonClass}>Poprzednie</button><span>{currentPage} / {pages} · {count} pozycji</span><button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className={buttonClass}>Następne</button></div>}
    </>}
  </section>;
}
