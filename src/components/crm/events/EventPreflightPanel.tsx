'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
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
  issues: PreflightIssue[];
};

export default function EventPreflightPanel({
  eventId,
  onNavigate,
}: {
  eventId: string;
  onNavigate: (tab: string) => void;
}) {
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
    ['contracts','employee_assignments','event_equipment','event_vehicles','event_agendas','tasks','wedding_cards','event_payment_milestones'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `event_id=eq.${eventId}` }, refresh);
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

  if (!available) return null;
  if (loading) return <div className="flex min-h-24 items-center justify-center rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]"><Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" /></div>;
  if (!data) return null;

  return (
    <section className={`overflow-hidden rounded-xl border ${data.ready ? 'border-green-500/15 bg-green-500/5' : data.critical_count ? 'border-red-500/20 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
      <div className="flex items-start gap-3 p-5">
        {data.ready ? <CheckCircle2 className="mt-0.5 h-6 w-6 flex-none text-green-400" /> : data.critical_count ? <AlertTriangle className="mt-0.5 h-6 w-6 flex-none text-red-400" /> : <ShieldCheck className="mt-0.5 h-6 w-6 flex-none text-amber-300" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-medium text-[#e5e4e2]">Kontrola przed wydarzeniem</h3><p className="mt-0.5 text-xs text-[#e5e4e2]/45">{daysLeft === null ? 'Termin nieznany' : daysLeft < 0 ? `${Math.abs(daysLeft)} dni po wydarzeniu` : daysLeft === 0 ? 'Wydarzenie jest dzisiaj' : `Do wydarzenia: ${daysLeft} dni`}</p></div>
            <button onClick={() => load()} className="rounded-lg p-2 text-[#e5e4e2]/45 hover:bg-[#0f1119]"><RefreshCw className="h-4 w-4" /></button>
          </div>
          {data.ready ? <div className="mt-4 rounded-lg bg-green-500/10 p-3 text-sm text-green-200">Umowa, płatności, zespół i zasoby są przygotowane. Brak wykrytych konfliktów.</div> : <div className="mt-4 space-y-2">{data.issues.map((issue) => <button key={issue.code} onClick={() => onNavigate(issue.tab)} className="flex w-full items-center gap-3 rounded-lg border border-[#e5e4e2]/8 bg-[#0f1119]/75 p-3 text-left hover:border-[#d3bb73]/25"><span className={`h-2 w-2 flex-none rounded-full ${issue.severity === 'critical' ? 'bg-red-400' : 'bg-amber-300'}`} /><span className="flex-1 text-sm text-[#e5e4e2]/80">{issue.label}</span><ChevronRight className="h-4 w-4 text-[#e5e4e2]/30" /></button>)}</div>}
        </div>
      </div>
    </section>
  );
}
