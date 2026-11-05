'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarSearch, CheckCircle2, Loader2, MessageSquare, QrCode, RefreshCw, Send, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSellerPortalContext } from '@/lib/seller/portal';
import { readSellerNotice, useSellerInbox } from '@/lib/seller/inbox';
import SellerInquiryFields from '@/components/seller/SellerInquiryFields';
import {
  emptySellerInquiry, sellerDayLabel, sellerInquiryEventTypeLabel, sellerInquiryPayload, sellerInquirySourceLabel,
  sellerInquiryStatusClass, sellerInquiryStatusLabel, validateSellerInquiry, type SellerInquiry, type SellerInquiryValues,
} from '@/lib/seller/inquiries';

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';

export default function SellerInquiriesPage() {
  const { context, loading: contextLoading, error: contextError, reload: reloadContext } = useSellerPortalContext();
  const [brandId, setBrandId] = useState('');
  const [values, setValues] = useState<SellerInquiryValues>(emptySellerInquiry);
  const [dateValidity, setDateValidity] = useState({ event_date: true, event_end_date: true });
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [inquiries, setInquiries] = useState<SellerInquiry[] | null>(null);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (context && !context.brands.some((brand) => brand.my_company_id === brandId)) setBrandId(context.brands[0]?.my_company_id || '');
  }, [context, brandId]);

  const loadInquiries = useCallback(async () => {
    setListLoading(true);
    const { data, error } = await supabase.rpc('get_seller_inquiries', { p_limit: 50 });
    if (error) setListError('Nie udało się wczytać Twoich zapytań.');
    else { setInquiries((data || []) as SellerInquiry[]); setListError(''); }
    setListLoading(false);
  }, []);
  useEffect(() => { if (context) void loadInquiries(); }, [context, loadInquiries]);
  // Answers are visible on this page: clear their notifications once the list is shown.
  const inbox = useSellerInbox(Boolean(context));
  useEffect(() => {
    if (!inquiries || document.visibilityState !== 'visible') return;
    inbox.items.filter((item) => item.kind === 'notification' && item.action_url?.startsWith('/seller/inquiries')).forEach((item) => void readSellerNotice(item));
  }, [inquiries, inbox.items]);

  const change = (patch: Partial<SellerInquiryValues>) => { setValues((current) => ({ ...current, ...patch })); setFormError(''); setSent(false); };
  const dirty = JSON.stringify(values) !== JSON.stringify(emptySellerInquiry());
  useEffect(() => {
    if (!dirty || sending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, sending]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    if (!brandId) { setFormError('Brak aktywnej marki MAVINCI. Napisz do opiekuna.'); return; }
    const problem = validateSellerInquiry(values, { datesValid: dateValidity.event_date && dateValidity.event_end_date });
    if (problem) { setFormError(problem); return; }
    const payload = sellerInquiryPayload(values);
    const key = JSON.stringify([brandId, payload]);
    // The same content retried after a lost response keeps its request id (no duplicate).
    if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
    setSending(true); setFormError('');
    try {
      const { error } = await supabase.rpc('submit_seller_inquiry', { p_company: brandId, p_request_id: requestRef.current.id, p_values: payload });
      if (error) throw error;
      requestRef.current = null;
      setValues(emptySellerInquiry()); setSent(true);
      window.dispatchEvent(new Event('seller-workspace-changed'));
      void loadInquiries();
    } catch (cause) {
      const message = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message?: string }).message || '') : '';
      setFormError(message || 'Nie udało się wysłać zapytania. Spróbuj ponownie — nie utworzymy duplikatu.');
    } finally { setSending(false); }
  };

  if (contextLoading) return <p role="status" className="flex items-center justify-center gap-2 p-10 text-[#d3bb73]"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie…</p>;
  if (!context) return <div role="alert" className="space-y-3 p-10 text-center text-white/60"><p>{contextError || 'Brak dostępu do portalu sprzedawcy.'}</p><button type="button" className={button} onClick={() => void reloadContext()}>Spróbuj ponownie</button></div>;

  return <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="flex items-center gap-3 text-2xl font-light uppercase"><CalendarSearch className="h-6 w-6 text-[#d3bb73]" />Sprawdź termin</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Gość pyta o wydarzenie? Wyślij szybkie zapytanie — opiekun MAVINCI sprawdzi termin i odpowie tutaj. Pełną ofertę przygotujesz później.</p></div>
        <Link href="/seller/materials" className={button}><QrCode className="h-4 w-4" />Formularz QR dla gości</Link>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <form ref={formRef} onSubmit={submit} noValidate className="space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
          <h2 className="text-base uppercase">Nowe zapytanie</h2>
          {context.brands.length > 1 && <label className="block text-xs text-white/60">Marka MAVINCI
            <select value={brandId} disabled={sending} onChange={(event) => setBrandId(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg bg-[#0f1119] px-3 text-sm outline-none focus:border-[#d3bb73]/45">
              {context.brands.map((brand) => <option key={brand.my_company_id} value={brand.my_company_id}>{brand.name}</option>)}
            </select></label>}
          <SellerInquiryFields value={values} onChange={change} disabled={sending}
            onDateValidity={(field, valid) => setDateValidity((current) => current[field] === valid ? current : { ...current, [field]: valid })} />
          {formError && <p role="alert" className="rounded-lg bg-rose-300/10 p-3 text-sm text-rose-200">{formError}</p>}
          {sent && <p role="status" className="flex items-start gap-2 rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Zapytanie wysłane. Opiekun otrzymał powiadomienie — odpowiedź pojawi się na liście obok.</p>}
          <button type="submit" disabled={sending} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#111522] disabled:opacity-50 sm:w-auto">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{sending ? 'Wysyłanie…' : 'Wyślij zapytanie do opiekuna'}
          </button>
        </form>

        <section aria-labelledby="seller-inquiries-list" className="space-y-3 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><h2 id="seller-inquiries-list" className="text-base uppercase">Twoje zapytania</h2>
            <button type="button" onClick={() => void loadInquiries()} disabled={listLoading} aria-label="Odśwież zapytania" className="flex h-10 w-10 items-center justify-center rounded-lg text-white/55 hover:bg-white/5"><RefreshCw className={`h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} /></button></div>
          {listError && <div role="alert" className="space-y-2 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100"><p>{listError}</p><button type="button" className={button} onClick={() => void loadInquiries()}>Spróbuj ponownie</button></div>}
          {!listError && inquiries === null && <p role="status" className="py-6 text-center text-sm text-white/50">Wczytywanie zapytań…</p>}
          {!listError && inquiries?.length === 0 && <p className="rounded-lg bg-white/[0.03] p-5 text-center text-sm text-white/50">Nie masz jeszcze zapytań. Wyślij pierwsze — zajmie to minutę.</p>}
          <ul className="space-y-3">{inquiries?.map((inquiry) => <li key={inquiry.id} className="space-y-2 rounded-lg bg-white/[0.035] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="break-words text-sm font-medium">{inquiry.guest_name}{inquiry.guest_company ? <span className="text-white/50"> · {inquiry.guest_company}</span> : null}</p>
                <p className="mt-1 text-xs text-white/50">{sellerDayLabel(inquiry.event_date)} · {sellerInquiryEventTypeLabel(inquiry.event_type)}{inquiry.guest_count ? <> · <Users className="inline h-3 w-3" /> {inquiry.guest_count}</> : null}</p></div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${sellerInquiryStatusClass(inquiry.status)}`}>{sellerInquiryStatusLabel(inquiry.status)}</span>
            </div>
            <p className="text-[11px] text-white/40">{sellerInquirySourceLabel(inquiry.source)}{inquiry.label ? ` · ${inquiry.label}` : ''}{inquiry.brand_name && context.brands.length > 1 ? ` · ${inquiry.brand_name}` : ''} · wysłane {new Date(inquiry.created_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</p>
            {inquiry.response && <div className="rounded-lg bg-[#d3bb73]/10 p-3"><p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#d3bb73]"><MessageSquare className="h-3.5 w-3.5" />Odpowiedź opiekuna{inquiry.responded_at ? ` · ${new Date(inquiry.responded_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p><p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6">{inquiry.response}</p></div>}
            {inquiry.status === 'answered' && <Link href="/seller/offers/new" className="inline-flex min-h-10 items-center text-xs text-[#d3bb73] underline underline-offset-4">Przygotuj ofertę dla tego gościa</Link>}
          </li>)}</ul>
        </section>
      </div>
    </div>
  </div>;
}
