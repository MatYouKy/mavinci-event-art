'use client';
import { useCallback, useEffect, useState } from 'react';
import { useOperationalStages } from '@/hooks/useOperationalStages';
import { OPERATIONAL_LABELS } from '@/lib/CRM/events/operationalStages';
import WarehouseMessageModal from './WarehouseMessageModal';
import { supabase } from '@/lib/supabase/browser';

type Handoff = {
  accepted_at: string | null;
  accepted_by_name: string | null;
  ready_at: string | null;
  ready_by_name: string | null;
};
export default function WarehouseHandoffPanel({
  eventId,
  status,
  onAccepted,
}: {
  eventId: string;
  status: string;
  onAccepted: () => void;
}) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const { stage, refresh } = useOperationalStages([{ id: eventId, status }], true);
  const currentStage = stage({ id: eventId, status });
  const [messageMode, setMessageMode] = useState<'request' | 'message' | null>(null);
  const [canContact, setCanContact] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [record, permission, contactPermission] = await Promise.all([
      supabase
        .from('event_warehouse_handoffs')
        .select('accepted_at,accepted_by_name,ready_at,ready_by_name')
        .eq('event_id', eventId)
        .maybeSingle(),
      supabase.rpc('can_prepare_warehouse_event', { p_event_id: eventId }),
      supabase.rpc('can_contact_event_warehouse', { p_event_id: eventId }),
    ]);
    setAllowed(false);
    setCanContact(false);
    if (record.error || permission.error || contactPermission.error) {
      setError('Nie udało się odczytać potwierdzenia magazynu.');
      return;
    }
    setHandoff(record.data);
    setAllowed(permission.data === true);
    setCanContact(contactPermission.data === true);
    setError('');
  }, [eventId]);
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`warehouse-handoff-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
        () => {
          void load();
        },
      )
      .subscribe();
    const refresh = () => {
      void load();
    };
    window.addEventListener('focus', refresh);
    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', refresh);
    };
  }, [eventId, status, load]);
  const accept = async () => {
    if (saving || !allowed) return;
    setSaving(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('accept_warehouse_event', { p_event_id: eventId });
      if (error) throw error;
      setHandoff(data);
      void refresh();
      onAccepted();
    } catch (e: any) {
      setError(e.message || 'Nie udało się przyjąć realizacji.');
    } finally {
      setSaving(false);
    }
  };
  const advance = async (action: 'ready') => {
    if (saving || !allowed) return;
    setSaving(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('advance_warehouse_event', {
        p_event_id: eventId,
        p_action: action,
      });
      if (error) throw error;
      setHandoff(data);
      await refresh();
    } catch (e: any) {
      setError(e.message || 'Nie udało się zapisać etapu magazynu.');
    } finally {
      setSaving(false);
    }
  };
  if (!handoff && !['offer_accepted', 'in_preparation'].includes(status)) return null;
  return (
    <section className="rounded-xl bg-[#d3bb73]/10 p-4" aria-busy={saving}>
      <h3 className="font-medium">{allowed ? 'Akcje magazynu' : 'Przygotowanie przez magazyn'}</h3>
      <p className="mt-2 text-sm text-[#d3bb73]">{OPERATIONAL_LABELS[currentStage]}</p>
      {handoff?.accepted_at ? (
        <p className="mt-2 text-sm">
          Przyjęto do przygotowania: <strong>{handoff.accepted_by_name}</strong> ·{' '}
          {new Date(handoff.accepted_at).toLocaleString('pl-PL')}
        </p>
      ) : (
        <p className="mt-2 text-sm text-[#e5e4e2]/70">
          Oczekuje na przyjęcie przez magazyn. Do sprawdzenia: dostępność sprzętu, braki i niezbędne
          zamówienia.
        </p>
      )}
      {allowed &&
        !handoff?.accepted_at &&
        ['offer_accepted', 'in_preparation'].includes(status) && (
          <button
            disabled={saving}
            onClick={accept}
            className="mt-3 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#210811] disabled:opacity-60"
          >
            {saving ? 'Przyjmowanie…' : 'Przyjmij do przygotowania'}
          </button>
        )}
      {allowed && handoff?.accepted_at && !handoff.ready_at && currentStage === 'in_preparation' && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void advance('ready')}
          className="mt-3 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#210811] disabled:opacity-60"
        >
          {saving ? 'Zapisywanie…' : 'Gotowe do realizacji'}
        </button>
      )}
      {handoff?.ready_at && (
        <p className="mt-2 text-sm">
          Gotowość potwierdził(a): <strong>{handoff.ready_by_name}</strong> ·{' '}
          {new Date(handoff.ready_at).toLocaleString('pl-PL')}
        </p>
      )}
      {canContact && !allowed && <div className="mt-3 flex flex-wrap gap-2">
        {!handoff?.accepted_at && <button type="button" onClick={() => setMessageMode('request')} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#210811]">Poproś o podjęcie akcji</button>}
        <button type="button" onClick={() => setMessageMode('message')} className="rounded-lg bg-[#d3bb73]/15 px-4 py-2 text-[#d3bb73]">Napisz do magazynu</button>
      </div>}
      {messageMode && canContact && <WarehouseMessageModal eventId={eventId} request={messageMode === 'request'} onClose={() => setMessageMode(null)} />}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}{' '}
          <button onClick={() => void load()} className="underline">
            Odśwież
          </button>
        </p>
      )}
    </section>
  );
}
