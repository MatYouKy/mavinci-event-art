'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Circle, Hourglass, Loader2, RefreshCw, Send, UserCheck } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import {
  SELLER_READINESS_MIGRATION, sellerReadinessSteps, sellerReadinessSummary,
  type SellerReadinessAction, type SellerReadinessFacts, type SellerReadinessState,
} from '@/lib/seller/readiness';
import { requestPortalAccess } from './CrmSellerProfileSettings';

const stateIcon: Record<SellerReadinessState, { Icon: typeof Check; className: string; label: string }> = {
  done: { Icon: Check, className: 'bg-emerald-300/15 text-emerald-200', label: 'Zrobione' },
  todo: { Icon: Circle, className: 'bg-amber-300/15 text-amber-100', label: 'Do zrobienia' },
  waiting: { Icon: Hourglass, className: 'bg-sky-300/15 text-sky-100', label: 'Czeka na hotel' },
  optional: { Icon: Circle, className: 'bg-white/5 text-white/35', label: 'Zalecane' },
};

/**
 * „Gotowość do pracy” — lista w sprzedaży sprzedawcy (podsumowanie i ustawienia): co jeszcze ustawić po dodaniu sprzedawcy,
 * czy hotel się zalogował, przeszedł przewodnik i wysłał pierwszą ofertę. Po komplecie zwija się do jednej linii.
 */
export default function CrmSellerReadiness({ partnerId, onOpenSettings, onOpenBranding }: {
  partnerId: string;
  onOpenSettings: (section: 'organization' | 'pricing' | 'access' | 'manager') => void;
  onOpenBranding: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [facts, setFacts] = useState<SellerReadinessFacts | null>(null);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [resending, setResending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_crm_seller_readiness', { p_partner: partnerId });
    if (loadError) {
      if (loadError.code === '42501') setHidden(true);
      else setError(['PGRST202', '42883'].includes(loadError.code || '')
        ? `Lista „Gotowość do pracy” wymaga migracji ${SELLER_READINESS_MIGRATION}.`
        : loadError.message || 'Nie udało się sprawdzić gotowości sprzedawcy.');
    } else { setFacts(data as SellerReadinessFacts); setError(''); setHidden(false); }
    setLoading(false);
  }, [partnerId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('seller-workspace-changed', refresh);
    return () => window.removeEventListener('seller-workspace-changed', refresh);
  }, [load]);

  if (hidden) return null;
  if (error) return <p role="status" className="rounded-xl bg-white/[0.035] p-4 text-xs text-white/50">{error}</p>;
  if (!facts) return loading ? <p role="status" className="flex items-center gap-2 rounded-xl bg-white/[0.035] p-4 text-xs text-white/45"><Loader2 className="h-4 w-4 animate-spin" />Sprawdzanie gotowości sprzedawcy…</p> : null;

  const steps = sellerReadinessSteps(facts);
  const summary = sellerReadinessSummary(steps);
  const open = expanded ?? !summary.complete;
  const runAction = async (action: SellerReadinessAction) => {
    if (action.kind === 'settings') onOpenSettings(action.section);
    else if (action.kind === 'branding') onOpenBranding();
    else if (action.kind === 'resend') {
      setResending(true);
      try {
        const result = await requestPortalAccess(partnerId, true);
        showSnackbar(result.emailSent ? `Zaproszenie wysłano ponownie na ${result.email}.` : `Konto ${result.email} jest już połączone z portalem.`, 'success');
        void load();
      } catch (cause) {
        showSnackbar(cause instanceof Error ? cause.message : 'Nie udało się wysłać zaproszenia.', 'error');
      } finally { setResending(false); }
    }
  };

  return <section aria-labelledby={`seller-readiness-${partnerId}`} className="rounded-xl bg-[#1c1f33] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={() => setExpanded(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${summary.complete ? 'bg-emerald-300/15 text-emerald-200' : 'bg-[#d3bb73]/15 text-[#d3bb73]'}`}><UserCheck className="h-4 w-4" /></span>
        <span className="min-w-0">
          <span id={`seller-readiness-${partnerId}`} className="block text-sm font-medium">{summary.complete ? 'Sprzedawca gotowy do pracy' : summary.ready ? 'Gotowy do startu — reszta po stronie hotelu' : 'Gotowość do pracy'}</span>
          <span className="block text-xs text-white/45">Wymagane: {summary.requiredDone}/{summary.requiredTotal} · wszystkie kroki: {summary.done}/{summary.total}</span>
        </span>
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-white/40 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      <button type="button" onClick={() => void load()} disabled={loading} aria-label="Odśwież gotowość sprzedawcy" className="rounded-lg bg-white/5 p-2 text-[#d3bb73] disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden="true"><div className={`h-full rounded-full ${summary.complete ? 'bg-emerald-300/60' : 'bg-[#d3bb73]/70'}`} style={{ width: `${Math.round(summary.done / summary.total * 100)}%` }} /></div>
    {open && <ol className="mt-4 space-y-2">{steps.map((step) => {
      const icon = stateIcon[step.state];
      return <li key={step.key} className="flex flex-wrap items-start gap-3 rounded-lg bg-black/15 p-3 sm:flex-nowrap">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${icon.className}`} title={icon.label}><icon.Icon className="h-3.5 w-3.5" aria-label={icon.label} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm">{step.label}
            {step.required && step.state === 'todo' && <span className="rounded bg-amber-300/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-100/80">wymagane</span>}
            {step.state === 'waiting' && <span className="rounded bg-sky-300/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-100/80">czeka na hotel</span>}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-white/50">{step.detail}</span>
        </span>
        {step.action && (step.action.kind === 'link'
          ? <Link href={step.action.href} className="shrink-0 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15">{step.action.label}</Link>
          : <button type="button" disabled={resending && step.action.kind === 'resend'} onClick={() => void runAction(step.action!)} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15 disabled:opacity-50">
              {step.action.kind === 'resend' && (resending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />)}{step.action.label}</button>)}
      </li>;
    })}</ol>}
  </section>;
}
