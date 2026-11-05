'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, Copy, Download, Loader2, Plus, Printer, QrCode, RefreshCw, Unlink } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useDialog } from '@/contexts/DialogContext';
import type { SellerPortalContext } from '@/lib/seller/portal';

type InquiryLink = {
  id: string; my_company_id: string; brand_name: string | null; label: string | null; token: string; path: string;
  created_at: string; revoked_at: string | null; submission_count: number; last_submission_at: string | null;
};

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';
const shortDate = (value: string | null) => value ? new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '';
const fileName = (label: string | null) => `kod-qr-${(label || 'zapytanie').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zapytanie'}.png`;

/** QR codes leading guests to the public inquiry form, plus a printable A5 card. */
export default function SellerQrMaterials({ context }: { context: SellerPortalContext }) {
  const { showConfirm } = useDialog();
  const hotelName = context.profile.organization?.alias || context.profile.organization?.name || 'Nasz hotel';
  const [links, setLinks] = useState<InquiryLink[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [brandId, setBrandId] = useState(context.brands[0]?.my_company_id || '');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [qr, setQr] = useState<{ id: string; dataUrl: string } | null>(null);
  const [qrError, setQrError] = useState('');
  const [copied, setCopied] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_seller_inquiry_links');
    if (error) setLoadError('Nie udało się wczytać kodów QR.');
    else { setLinks((data || []) as InquiryLink[]); setLoadError(''); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const activeLinks = useMemo(() => (links || []).filter((link) => !link.revoked_at), [links]);
  const revokedLinks = useMemo(() => (links || []).filter((link) => link.revoked_at), [links]);
  const selected = activeLinks.find((link) => link.id === selectedId) || activeLinks[0];
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const selectedUrl = selected ? `${origin}${selected.path}` : '';

  useEffect(() => {
    if (!selected || !selectedUrl) { setQr(null); return; }
    let active = true;
    setQrError('');
    QRCode.toDataURL(selectedUrl, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then((dataUrl) => { if (active) setQr({ id: selected.id, dataUrl }); })
      .catch(() => { if (active) setQrError('Nie udało się wygenerować kodu QR. Odśwież stronę.'); });
    return () => { active = false; };
  }, [selected?.id, selectedUrl]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (creating) return;
    if (!label.trim()) { setFormError('Nazwij miejsce kodu, np. „Recepcja” albo „Karta w pokoju”.'); return; }
    if (!brandId) { setFormError('Brak aktywnej marki MAVINCI.'); return; }
    setCreating(true); setFormError('');
    const { data, error } = await supabase.rpc('create_seller_inquiry_link', { p_company: brandId, p_label: label.trim() });
    setCreating(false);
    if (error) { setFormError(error.message || 'Nie udało się utworzyć kodu QR.'); return; }
    setLabel('');
    await load();
    const created = data as { id?: string } | null;
    if (created?.id) setSelectedId(created.id);
  };
  const revoke = async (link: InquiryLink) => {
    if (busyId || !(await showConfirm({ title: 'Wyłączyć ten kod QR?', message: 'Wydrukowane karty z tym kodem przestaną działać. Zapytania wysłane wcześniej pozostaną zapisane.', confirmText: 'Wyłącz kod', cancelText: 'Anuluj' }))) return;
    setBusyId(link.id);
    const { error } = await supabase.rpc('revoke_seller_inquiry_link', { p_id: link.id });
    setBusyId('');
    if (error) { setLoadError(error.message || 'Nie udało się wyłączyć kodu.'); return; }
    await load();
  };
  const copy = async (link: InquiryLink) => {
    try { await navigator.clipboard.writeText(`${origin}${link.path}`); setCopied(link.id); window.setTimeout(() => setCopied(''), 2500); }
    catch { setLoadError('Nie udało się skopiować adresu. Zaznacz go i skopiuj ręcznie.'); }
  };
  const download = () => {
    if (!qr || !selected) return;
    const anchor = document.createElement('a');
    anchor.href = qr.dataUrl; anchor.download = fileName(selected.label);
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  };

  return <div className="space-y-5">
    <style>{`@media print {
      @page { size: A5 portrait; margin: 0; }
      body * { visibility: hidden !important; }
      #seller-qr-print-card, #seller-qr-print-card * { visibility: visible !important; }
      #seller-qr-print-card { position: fixed !important; inset: 0 !important; display: flex !important; }
    }`}</style>

    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby="qr-create-title" className="space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
        <div><h2 id="qr-create-title" className="text-base uppercase">Nowy kod QR</h2>
          <p className="mt-1 text-xs leading-5 text-white/55">Każde miejsce może mieć własny kod — zobaczysz, skąd przychodzą zapytania gości.</p></div>
        <form onSubmit={create} className="space-y-3">
          {context.brands.length > 1 && <label className="block text-xs text-white/60">Marka MAVINCI<select value={brandId} onChange={(event) => setBrandId(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg bg-[#0f1119] px-3 text-sm outline-none focus:border-[#d3bb73]/45">{context.brands.map((brand) => <option key={brand.my_company_id} value={brand.my_company_id}>{brand.name}</option>)}</select></label>}
          <label className="block text-xs text-white/60">Gdzie umieścisz kod?<input value={label} maxLength={120} onChange={(event) => { setLabel(event.target.value); setFormError(''); }} placeholder="np. Recepcja, Karta w pokoju, Restauracja" className="mt-1.5 min-h-11 w-full rounded-lg bg-[#0f1119] px-3 text-sm outline-none placeholder:text-white/30 focus:border-[#d3bb73]/45" /></label>
          {formError && <p role="alert" className="text-sm text-rose-200">{formError}</p>}
          <button type="submit" disabled={creating} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522] disabled:opacity-50">{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Utwórz kod QR</button>
        </form>

        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between"><h3 className="text-sm uppercase text-white/70">Aktywne kody</h3><button type="button" onClick={() => void load()} aria-label="Odśwież listę kodów" className="flex h-10 w-10 items-center justify-center rounded-lg text-white/50 hover:bg-white/5"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
          {loadError && <div role="alert" className="space-y-2 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100"><p>{loadError}</p><button type="button" onClick={() => void load()} className={button}>Spróbuj ponownie</button></div>}
          {!loadError && links === null && <p role="status" className="text-sm text-white/50">Wczytywanie…</p>}
          {links && !activeLinks.length && <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-white/55">Nie masz jeszcze kodów QR. Utwórz pierwszy powyżej.</p>}
          <ul className="space-y-2">{activeLinks.map((link) => <li key={link.id}>
            <div className={`rounded-lg p-3 transition ${selected?.id === link.id ? 'bg-[#d3bb73]/10' : 'bg-white/[0.03]'}`}>
              <button type="button" onClick={() => setSelectedId(link.id)} aria-pressed={selected?.id === link.id} className="block w-full text-left">
                <span className="flex items-center gap-2 text-sm"><QrCode className="h-4 w-4 shrink-0 text-[#d3bb73]" />{link.label || 'Kod QR'}</span>
                <span className="mt-1 block text-xs text-white/50">Zapytania: {Number(link.submission_count || 0)}{link.last_submission_at ? ` · ostatnie ${shortDate(link.last_submission_at)}` : ''}{context.brands.length > 1 && link.brand_name ? ` · ${link.brand_name}` : ''}</span>
              </button>
              <div className="mt-2 flex flex-wrap gap-x-3">
                <button type="button" onClick={() => void copy(link)} className="inline-flex min-h-10 items-center gap-1.5 text-xs text-[#d3bb73]">{copied === link.id ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied === link.id ? 'Skopiowano' : 'Kopiuj adres'}</button>
                <button type="button" disabled={busyId === link.id} onClick={() => void revoke(link)} className="inline-flex min-h-10 items-center gap-1.5 text-xs text-rose-200/75 hover:text-rose-200 disabled:opacity-40"><Unlink className="h-3.5 w-3.5" />Wyłącz</button>
              </div>
            </div>
          </li>)}</ul>
          {revokedLinks.length > 0 && <details className="rounded-lg bg-white/[0.02] p-3 text-xs text-white/50"><summary className="flex min-h-10 cursor-pointer items-center">Wyłączone kody ({revokedLinks.length})</summary>
            <ul className="mt-2 space-y-1">{revokedLinks.map((link) => <li key={link.id}>{link.label || 'Kod QR'} · wyłączony {shortDate(link.revoked_at)} · zapytania: {Number(link.submission_count || 0)}</li>)}</ul></details>}
        </div>
      </section>

      <section aria-labelledby="qr-preview-title" className="space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
        <h2 id="qr-preview-title" className="text-base uppercase">Karta dla gości</h2>
        {!selected ? <p className="text-sm text-white/55">Utwórz lub wybierz kod, aby zobaczyć kartę do druku.</p> : <>
          <div className="mx-auto w-full max-w-xs rounded-2xl bg-white p-6 text-center text-[#16131a] shadow-xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6d6570]">{hotelName}</p>
            <p className="mt-3 text-xl font-semibold leading-tight">Planujesz wydarzenie?</p>
            <p className="mt-1 text-sm text-[#4d4550]">Zeskanuj kod i wyślij zapytanie</p>
            {qr?.id === selected.id
              // eslint-disable-next-line @next/next/no-img-element -- generated data URL
              ? <img src={qr.dataUrl} alt={`Kod QR: ${selected.label || 'zapytanie o wydarzenie'}`} className="mx-auto mt-4 aspect-square w-full max-w-[13rem]" />
              : <div className="mx-auto mt-4 flex aspect-square w-full max-w-[13rem] items-center justify-center bg-[#f4f1ec]"><Loader2 className="h-6 w-6 animate-spin text-[#6d6570]" /></div>}
            <p className="mt-3 text-[11px] text-[#6d6570]">Wesela · konferencje · gale · przyjęcia</p>
          </div>
          {qrError && <p role="alert" className="text-sm text-rose-200">{qrError}</p>}
          <label className="block text-xs text-white/55">Adres formularza<input readOnly value={selectedUrl} onFocus={(event) => event.currentTarget.select()} className="mt-1.5 min-h-11 w-full rounded-lg bg-[#0f1119] px-3 text-sm outline-none" /></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!qr || qr.id !== selected.id} onClick={download} className={button}><Download className="h-4 w-4" />Pobierz PNG</button>
            <button type="button" disabled={!qr || qr.id !== selected.id} onClick={() => window.print()} className={button}><Printer className="h-4 w-4" />Drukuj kartę A5</button>
            <a href={selectedUrl} target="_blank" rel="noopener noreferrer" className={button}>Otwórz formularz</a>
          </div>
          <p className="text-xs leading-5 text-white/45">Zapytania z formularza trafiają do Twojego opiekuna i na listę „Zapytania” w portalu.</p>
        </>}
      </section>
    </div>

    {selected && qr?.id === selected.id && <div id="seller-qr-print-card" aria-hidden="true" className="hidden flex-col items-center justify-center bg-white p-[14mm] text-center text-[#16131a]">
      <p style={{ fontSize: '11pt', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#6d6570' }}>{hotelName}</p>
      <p style={{ fontSize: '28pt', fontWeight: 600, marginTop: '10mm', lineHeight: 1.1 }}>Planujesz wydarzenie?</p>
      <p style={{ fontSize: '15pt', marginTop: '4mm' }}>Zeskanuj kod i wyślij zapytanie</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL for print */}
      <img src={qr.dataUrl} alt="" style={{ width: '80mm', height: '80mm', marginTop: '10mm' }} />
      <p style={{ fontSize: '11pt', marginTop: '8mm', color: '#4d4550' }}>Wesela · konferencje · gale · przyjęcia firmowe</p>
      <p style={{ fontSize: '8pt', marginTop: '4mm', color: '#8d8590', wordBreak: 'break-all' }}>{selectedUrl}</p>
    </div>}
  </div>;
}
