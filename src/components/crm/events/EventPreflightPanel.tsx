'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

type PreflightIssue = {
  code: string;
  label: string;
  severity: 'critical' | 'warning';
  tab: string;
};

type Preflight = {
  event_id: string;
  event_date: string;
  ready: boolean;
  critical_count: number;
  warning_count: number;
  accepted_employee_conflicts?: number;
  issues: PreflightIssue[];
};

/** Pozycje umowy i płatności — tylko dla osób z obszarem „oferta, umowa i formalności”. */
const COMMERCIAL_ISSUE_CODES = new Set(['contract', 'payment_overdue', 'payment_schedule', 'deposit']);
const COMMERCIAL_ISSUE_TABS = new Set(['contract', 'finances']);

export default function EventPreflightPanel({
  eventId,
  onNavigate,
  hideCommercial = false,
  defaultCollapsed = false,
  canOpenTab,
}: {
  eventId: string;
  onNavigate: (tab: string) => void;
  /** Ukrywa pozycje umowy i płatności (brak obszaru commercial_docs). */
  hideCommercial?: boolean;
  /** Panel zwinięty na start (widać tylko nagłówek z podsumowaniem). */
  defaultCollapsed?: boolean;
  /** Czy zakładka jest dostępna — pozycja do niedostępnej zakładki nie jest przyciskiem. */
  canOpenTab?: (tab: string) => boolean;
}) {
  const regionId = useId();
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const [data, setData] = useState<Preflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data: result, error } = await supabase.rpc('get_event_preflight', { p_event_id: eventId });
    if (error) {
      if (['42883', 'PGRST202'].includes(error.code ?? '')) setAvailable(false);
      setLoading(false);
      return;
    }
    setData(result as Preflight);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!available) return;
    const channel = supabase.channel(`event-preflight-${eventId}`);
    const refresh = () => void load(true);
    ['contracts','event_partner_arrangements','employee_assignments','event_equipment','event_vehicles','event_agendas','tasks','wedding_cards','event_payment_milestones'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `event_id=eq.${eventId}` }, refresh);
    });
    ['event_phase_assignments', 'event_employee_conflict_acceptances'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    });
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [available, eventId, load]);

  const daysLeft = useMemo(() => {
    if (!data?.event_date) return null;
    const eventDay = new Date(data.event_date); eventDay.setHours(0,0,0,0);
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.ceil((eventDay.getTime() - today.getTime()) / 86400000);
  }, [data?.event_date]);

  // Bez obszaru handlowego: bez pozycji umowy i płatności; gotowość liczona z pozostałych pozycji.
  const issues = useMemo(
    () =>
      (data?.issues ?? []).filter(
        (issue) => !hideCommercial || (!COMMERCIAL_ISSUE_CODES.has(issue.code) && !COMMERCIAL_ISSUE_TABS.has(issue.tab)),
      ),
    [data?.issues, hideCommercial],
  );
  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.length - criticalCount;
  // Jak w bazie: gotowe, gdy nie ma pozycji poza harmonogramem płatności (a ten bez obszaru handlowego jest ukryty).
  const ready = hideCommercial ? issues.length === 0 : Boolean(data?.ready);

  if (!available) return null;
  if (loading && !data) return <div className="flex min-h-16 items-center justify-center rounded-xl bg-white/5"><Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" /></div>;
  if (!data) return null;

  const summary = issues.length === 0
    ? 'Bez uwag'
    : [criticalCount ? `pilne: ${criticalCount}` : '', warningCount ? `do sprawdzenia: ${warningCount}` : ''].filter(Boolean).join(' · ');

  return (
    <section className={`overflow-hidden rounded-xl ${ready ? 'bg-green-500/5' : criticalCount ? 'bg-red-500/[0.07]' : 'bg-amber-500/[0.07]'}`}>
      <div className="flex items-start gap-3 p-4 sm:p-5">
        {ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-green-400" /> : criticalCount ? <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-red-400" /> : <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-amber-300" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={regionId}
              onClick={() => setExpanded((value) => !value)}
              className="-m-1 flex min-w-0 flex-1 items-start gap-2 rounded-lg p-1 text-left hover:bg-white/[0.03]"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-[#e5e4e2]">Kontrola przed wydarzeniem</span>
                <span className="mt-0.5 block text-xs text-[#e5e4e2]/50">
                  {daysLeft === null ? 'Termin nieznany' : daysLeft < 0 ? `${Math.abs(daysLeft)} dni po wydarzeniu` : daysLeft === 0 ? 'Wydarzenie jest dzisiaj' : `Do wydarzenia: ${daysLeft} dni`}
                  {' · '}
                  {summary}
                </span>
              </span>
              <ChevronDown className={`mt-1 h-4 w-4 flex-none text-[#e5e4e2]/45 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            <button type="button" onClick={() => load()} aria-label="Odśwież kontrolę przed wydarzeniem" title="Odśwież" className="rounded-lg p-2 text-[#e5e4e2]/45 hover:bg-white/5"><RefreshCw className="h-4 w-4" aria-hidden /></button>
          </div>
          <div id={regionId} hidden={!expanded}>
          {issues.length === 0 ? <div className="mt-4 rounded-lg bg-green-500/10 p-3 text-sm text-green-200">{hideCommercial ? 'Zespół i zasoby są przygotowane. Brak nierozwiązanych konfliktów.' : 'Formalności, płatności, zespół i zasoby są przygotowane. Brak nierozwiązanych konfliktów.'}</div> : <div className="mt-4 space-y-2">{issues.map((issue) => {
            const content = <><span className={`h-2 w-2 flex-none rounded-full ${issue.severity === 'critical' ? 'bg-red-400' : 'bg-amber-300'}`} /><span className="flex-1 text-sm text-[#e5e4e2]/80">{issue.label}</span></>;
            return !canOpenTab || canOpenTab(issue.tab)
              ? <button type="button" key={issue.code} onClick={() => onNavigate(issue.tab)} className="flex w-full items-center gap-3 rounded-lg bg-black/20 p-3 text-left transition-colors hover:bg-black/30">{content}<ChevronRight className="h-4 w-4 text-[#e5e4e2]/30" aria-hidden /></button>
              : <div key={issue.code} className="flex w-full items-center gap-3 rounded-lg bg-black/20 p-3">{content}</div>;
          })}</div>}
          {(data.accepted_employee_conflicts ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('team')}
              className="mt-3 flex w-full items-center gap-3 rounded-lg bg-blue-400/5 p-3 text-left transition-colors hover:bg-blue-400/10"
            >
              <ShieldCheck className="h-4 w-4 flex-none text-blue-300" />
              <span className="flex-1 text-xs leading-5 text-blue-100/75">
                Zaakceptowane nakładanie pracy między wydarzeniami:{' '}
                {data.accepted_employee_conflicts}. Decyzje mają zapisane uzasadnienie i osobę
                akceptującą.
              </span>
              <ChevronRight className="h-4 w-4 text-blue-200/35" aria-hidden />
            </button>
          )}
          </div>
        </div>
      </div>
    </section>
  );
}
