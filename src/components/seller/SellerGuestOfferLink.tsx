'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Eye, Link2, Loader2, RefreshCw, Share2, Unlink } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useDialog } from '@/contexts/DialogContext';

export type SellerOfferShareState = {
  active: boolean;
  token?: string;
  path?: string;
  created_at?: string;
  first_viewed_at?: string | null;
  last_viewed_at?: string | null;
  view_count?: number;
  accepted_at?: string | null;
  accepted_name?: string | null;
  accepted_email?: string | null;
  accepted_note?: string | null;
  /** Sumy z chwili akceptacji (oferta mogła się później zmienić). */
  accepted_totals?: { net: number; vat: number; gross: number; vat_percent: number } | null;
  accepted_document?: { id: string; filename: string | null; created_at: string } | null;
  /** false — oferta czeka na zatwierdzenie MAVINCI albo sprzedawca / marka są nieaktywni: link nie działa. */
  guest_ready?: boolean;
};

const pln = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2 }).format(Number(value || 0));

const when = (value?: string | null) => value
  ? new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short' }) : '';
const views = (count: number) => count === 1 ? '1 raz' : `${count} razy`;
const errorText = (cause: unknown, fallback: string) =>
  cause && typeof cause === 'object' && 'message' in cause && typeof (cause as { message?: unknown }).message === 'string' && (cause as { message: string }).message
    ? (cause as { message: string }).message : fallback;

/** Guest share link of a portal offer (create / state / revoke). */
export function useSellerOfferShare(offerId: string, enabled: boolean) {
  const [state, setState] = useState<SellerOfferShareState | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const current = ++sequence.current;
    const { data, error: loadError } = await supabase.rpc('get_seller_offer_share_state', { p_offer: offerId });
    if (current !== sequence.current) return;
    if (loadError) setError('Nie udało się sprawdzić linku dla gościa.');
    else { setState((data as SellerOfferShareState | null) || { active: false }); setError(''); }
    setLoading(false);
  }, [enabled, offerId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { sequence.current += 1; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [enabled, load]);

  return { state, loading, error, reload: load, setError };
}

export default function SellerGuestOfferLink({ offerId, share, disabled = false }: {
  offerId: string;
  share: ReturnType<typeof useSellerOfferShare>;
  /** The offer can no longer be presented (e.g. passed to realization). */
  disabled?: boolean;
}) {
  const { showConfirm } = useDialog();
  const [busy, setBusy] = useState<'' | 'create' | 'rotate' | 'revoke'>('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const { state, loading, error, reload, setError } = share;
  const url = state?.active && state.path && typeof window !== 'undefined' ? `${window.location.origin}${state.path}` : '';
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const create = async (rotate: boolean) => {
    if (busy) return;
    if (rotate && !(await showConfirm({ title: 'Utworzyć nowy link?', message: 'Dotychczasowy link przestanie działać. Gość, który go otrzymał, zobaczy komunikat o nieaktywnej ofercie.', confirmText: 'Utwórz nowy link', cancelText: 'Anuluj' }))) return;
    setBusy(rotate ? 'rotate' : 'create'); setNotice(''); setError('');
    try {
      const { error: createError } = await supabase.rpc('create_seller_offer_share_link', { p_offer: offerId, p_rotate: rotate });
      if (createError) throw createError;
      await reload();
      setNotice(rotate ? 'Utworzono nowy link. Poprzedni już nie działa.' : 'Link jest gotowy. Skopiuj go i wyślij gościowi.');
    } catch (cause) {
      setError(errorText(cause, 'Nie udało się utworzyć linku. Spróbuj ponownie.'));
    } finally { setBusy(''); }
  };
  const revoke = async () => {
    if (busy || !(await showConfirm({ title: 'Wyłączyć link dla gościa?', message: 'Gość nie otworzy już oferty pod tym adresem. Historia wyświetleń i akceptacji pozostanie zapisana.', confirmText: 'Wyłącz link', cancelText: 'Anuluj' }))) return;
    setBusy('revoke'); setNotice(''); setError('');
    try {
      const { error: revokeError } = await supabase.rpc('revoke_seller_offer_share_link', { p_offer: offerId });
      if (revokeError) throw revokeError;
      await reload();
      setNotice('Link został wyłączony.');
    } catch (cause) {
      setError(errorText(cause, 'Nie udało się wyłączyć linku. Spróbuj ponownie.'));
    } finally { setBusy(''); }
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true); window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setNotice('Nie udało się skopiować automatycznie. Zaznacz adres w polu i skopiuj go ręcznie.');
    }
  };
  const nativeShare = async () => {
    if (!url) return;
    try { await navigator.share({ title: 'Oferta wydarzenia', text: 'Oferta przygotowana dla Ciebie:', url }); } catch { /* Share sheet dismissed. */ }
  };

  return <section id="seller-guest-link" aria-labelledby="seller-guest-link-title" className="scroll-mt-6 space-y-3 rounded-xl bg-white/[0.035] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 id="seller-guest-link-title" className="flex items-center gap-2 text-base uppercase"><Link2 className="h-4 w-4 text-[#d3bb73]" />Link dla gościa</h2>
        <p className="mt-1 text-xs leading-5 text-white/55">Strona oferty z brandingiem hotelu: gość obejrzy ją na telefonie, pobierze PDF i zaakceptuje online.</p></div>
      {state?.active && <button type="button" onClick={() => void reload()} aria-label="Odśwież stan linku" className="flex h-10 w-10 items-center justify-center rounded-lg text-white/50 hover:bg-white/5"><RefreshCw className="h-4 w-4" /></button>}
    </div>
    {(loading || (!state && !error)) && <p role="status" className="flex items-center gap-2 text-sm text-white/55"><Loader2 className="h-4 w-4 animate-spin" />Sprawdzanie linku…</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">{error}</p>}
    {notice && <p role="status" className="text-sm text-[#d3bb73]">{notice}</p>}

    {state?.accepted_at && <div className="rounded-lg bg-emerald-300/10 p-4 text-sm text-emerald-100">
      <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 shrink-0" />Gość zaakceptował ofertę online</p>
      <p className="mt-1 text-emerald-100/80">{state.accepted_name || 'Gość'}{state.accepted_email ? ` · ${state.accepted_email}` : ''} · {when(state.accepted_at)}</p>
      {state.accepted_totals && <p className="mt-1 text-emerald-100/80">Zaakceptowana kwota: {pln(state.accepted_totals.net)} netto · {pln(state.accepted_totals.gross)} brutto{state.accepted_document?.filename ? ` · PDF: ${state.accepted_document.filename}` : ''}</p>}
      {state.accepted_note && <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/15 p-3 text-emerald-50/90">„{state.accepted_note}”</p>}
    </div>}

    {state?.guest_ready === false && !state.accepted_at && <p role="status" className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">{state.active ? 'Link jest wstrzymany: ' : ''}oferta czeka na zatwierdzenie zmian przez MAVINCI. Gość zobaczy ją pod tym samym linkiem po zatwierdzeniu.</p>}
    {!loading && state && !state.active && <div className="space-y-2">
      <button type="button" disabled={disabled || Boolean(busy) || state.guest_ready === false} onClick={() => void create(false)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522] disabled:opacity-40">{busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Utwórz link dla gościa</button>
      {disabled && <p className="text-xs text-white/50">Link można utworzyć dla oferty w przygotowaniu.</p>}
    </div>}

    {state?.active && url && <div className="space-y-3">
      <label className="block text-xs text-white/55">Adres oferty<input readOnly value={url} onFocus={(event) => event.currentTarget.select()} className="mt-1.5 min-h-11 w-full rounded-lg bg-[#0f1119] px-3 text-sm text-[#e5e4e2] outline-none focus:ring-1 focus:ring-[#d3bb73]/40" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#111522]">{copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Skopiowano' : 'Kopiuj link'}</button>
        {canNativeShare && <button type="button" onClick={() => void nativeShare()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Share2 className="h-4 w-4" />Udostępnij</button>}
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><ExternalLink className="h-4 w-4" />Podgląd jak gość</a>
      </div>
      <p className="flex items-center gap-2 text-sm text-white/65"><Eye className="h-4 w-4 shrink-0 text-white/45" />{state.view_count ? `Obejrzana ${views(Number(state.view_count))}${state.last_viewed_at ? ` · ostatnio ${when(state.last_viewed_at)}` : ''}` : 'Gość jeszcze nie otworzył linku.'}</p>
      <p className="text-xs text-white/45">Utworzono {when(state.created_at)}. Podgląd z Twojego konta nie liczy się jako wyświetlenie gościa.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" disabled={Boolean(busy)} onClick={() => void revoke()} className="inline-flex min-h-10 items-center gap-2 text-sm text-rose-200/80 hover:text-rose-200 disabled:opacity-40">{busy === 'revoke' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}Wyłącz link</button>
        <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void create(true)} className="inline-flex min-h-10 items-center gap-2 text-sm text-white/55 hover:text-white disabled:opacity-40">{busy === 'rotate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Utwórz nowy link</button>
      </div>
    </div>}
  </section>;
}
