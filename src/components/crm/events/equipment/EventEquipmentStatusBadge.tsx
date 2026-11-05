'use client';
import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { createRefreshQueue } from '@/lib/CRM/refreshQueue';
import { channelSuffix } from '../steps/stepUi';

type BadgeState = { label: string; cls: string } | null;

/** Statusy, w których sprzęt jest już „do wydania” (wcześniej — oferta, zapytanie — badge się nie pokazuje). */
const PREPARATION_STATUSES = new Set(['offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress']);

/**
 * Stan sprzętu w nagłówku wydarzenia (tani odczyt etapów checklisty + licznik pozycji, odświeżany na żywo):
 * do wydania → wydany, czeka na załadunek po wydarzeniu → czeka na zwrot → rozbieżności / zwrócony.
 */
export default function EventEquipmentStatusBadge({
  eventId,
  eventStatus,
  onOpen,
}: {
  eventId: string;
  eventStatus?: string | null;
  /** Otwiera zakładkę Sprzęt (gdy dostępna). */
  onOpen?: () => void;
}) {
  const [state, setState] = useState<BadgeState>(null);

  useEffect(() => {
    if (!eventId) return;
    setState(null);
    const controller = new AbortController();
    const queue = createRefreshQueue(controller.signal, async signal => {
      const [stages, lines] = await Promise.all([
        supabase
          .from('event_equipment_checklists')
          .select('dispatch_confirmed_at,loadback_confirmed_at,return_confirmed_at,return_issue_count,issues_ack_at')
          .eq('event_id', eventId)
          .abortSignal(signal)
          .maybeSingle(),
        supabase
          .from('event_equipment')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', eventId)
          .not('removed_from_offer', 'is', true)
          .abortSignal(signal),
      ]);
      if (signal.aborted) return;
      // Brak tabeli (baza bez migracji) albo brak dostępu do obszaru „Realizacja” — bez badge'a.
      if (stages.error || lines.error) {
        setState(null);
        return;
      }
      const row = stages.data;
      if (row?.return_confirmed_at) {
        setState(
          Number(row.return_issue_count || 0) > 0 && !row.issues_ack_at
            ? { label: 'Sprzęt: rozbieżności', cls: 'bg-red-500/20 text-red-200' }
            : { label: 'Sprzęt: zwrócony', cls: 'bg-emerald-500/15 text-emerald-200' },
        );
      } else if (row?.loadback_confirmed_at) {
        setState({ label: 'Sprzęt: czeka na zwrot', cls: 'bg-amber-400/15 text-amber-200' });
      } else if (row?.dispatch_confirmed_at) {
        setState({ label: 'Sprzęt: wydany — czeka na załadunek po wydarzeniu', cls: 'bg-sky-400/15 text-sky-200' });
      } else if ((lines.count ?? 0) > 0 && PREPARATION_STATUSES.has(eventStatus || '')) {
        setState({ label: 'Sprzęt: do wydania', cls: 'bg-white/10 text-[#e5e4e2]/75' });
      } else {
        setState(null);
      }
    });
    void queue.refresh();
    const filter = `event_id=eq.${eventId}`;
    const channel = supabase
      .channel(`equipment-status-${eventId}-${channelSuffix()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_equipment_checklists', filter }, () => queue.schedule())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_equipment', filter }, () => queue.schedule())
      .subscribe();
    return () => {
      controller.abort();
      void supabase.removeChannel(channel);
    };
  }, [eventId, eventStatus]);

  if (!state) return null;
  const content = (
    <>
      <Package className="h-3.5 w-3.5" aria-hidden />
      {state.label}
    </>
  );
  const cls = `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${state.cls}`;
  return onOpen ? (
    <button type="button" data-brand-badge="true" onClick={onOpen} title="Otwórz checklistę sprzętu" className={`${cls} hover:brightness-125`}>
      {content}
    </button>
  ) : (
    <span data-brand-badge="true" className={cls}>
      {content}
    </span>
  );
}
