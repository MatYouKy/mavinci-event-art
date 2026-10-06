import { canView } from '../../lib/permissions';
import { navigateToChat } from '../../navigation/navigationRef';
import { openEventAuthorChat } from '../../services/eventAuthorChat';
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useOperationalStages } from '../../hooks/useOperationalStages';
import { useForegroundEffect } from '../../hooks/useForegroundEffect';
import { createRefreshQueue } from '../../lib/refreshQueue';
import { useAuth } from '../../contexts/AuthContext';
import { canAcceptWarehouseHandoff, WarehouseHandoff, warehouseOwnerLabel } from '../../lib/warehouseHandoff';
import { OPERATIONAL_LABELS } from '../../lib/operationalStages';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../theme';

export default function WarehouseHandoffPanel({ eventId, status, onAccepted }: {
  eventId: string;
  status: string;
  onAccepted: () => void;
}) {
  const { employee } = useAuth();
  const focused = useIsFocused();
  const [record, setRecord] = useState<WarehouseHandoff | null>(null);
  const { stage, refresh } = useOperationalStages([{ id: eventId, status }], true);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [managerRequired, setManagerRequired] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatLock = useRef(false);
  const lock = useRef(false);
  const readVersion = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++readVersion.current;
    try {
      const [row, permission] = await Promise.all([
        supabase.from('event_warehouse_handoffs')
          .select('event_id,accepted_at,accepted_by,accepted_by_name,ready_at,ready_by_name')
          .eq('event_id', eventId).maybeSingle(),
        supabase.rpc('can_prepare_warehouse_event', { p_event_id: eventId }),
      ]);
      if (signal?.aborted || version !== readVersion.current) return;
      if (row.error || permission.error) throw row.error || permission.error;
      setRecord(row.data);
      setAllowed(permission.data === true);
      setError('');
    } catch {
      if (!signal?.aborted && version === readVersion.current) {
        setAllowed(false);
        setError('Nie udało się sprawdzić odpowiedzialności magazynu. Odśwież przed wykonaniem akcji.');
      }
    } finally {
      if (!signal?.aborted && version === readVersion.current) setLoading(false);
    }
  }, [eventId]);

  useForegroundEffect(signal => {
    if (!focused) return;
    const queue = createRefreshQueue(signal, load);
    void queue.refresh();
    const channel = supabase.channel(`mobile-warehouse-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_warehouse_handoffs', filter: `event_id=eq.${eventId}` }, queue.schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, queue.schedule)
      .subscribe();
    // Also covers deployments where the handoff table is not in the Realtime publication.
    const timer = setInterval(queue.schedule, 30000);
    return () => { readVersion.current++; clearInterval(timer); return supabase.removeChannel(channel); };
  }, [eventId, status, focused, load]);

  const run = async (action: 'accept' | 'ready') => {
    if (lock.current || !allowed) return;
    lock.current = true; setBusy(true); setError('');
    readVersion.current++;
    try {
      const result = action === 'accept'
        ? await supabase.rpc('accept_warehouse_event', { p_event_id: eventId })
        : await supabase.rpc('advance_warehouse_event', { p_event_id: eventId, p_action: 'ready' });
      if (result.error) throw result.error;
      setRecord(result.data);
      setManagerRequired(false);
      await refresh();
      // The server returns the actual owner if another worker accepted first.
      onAccepted();
    } catch (cause: any) {
      if (action === 'ready' && /wyznaczyć kierownika/i.test(cause?.message || '')) setManagerRequired(true);
      setError(cause?.message || 'Nie udało się zapisać przygotowania. Odśwież i spróbuj ponownie.');
    } finally { lock.current = false; setBusy(false); }
  };
  const contactAuthor = async () => {
    if (chatLock.current || !employee?.id || !canView(employee, 'chat')) return;
    chatLock.current = true; setOpeningChat(true); setChatError('');
    try {
      const conversationId = await openEventAuthorChat(eventId, employee.id);
      navigateToChat(conversationId);
    } catch (cause: any) {
      setChatError(cause?.message || 'Nie udało się otworzyć rozmowy z autorem. Spróbuj ponownie.');
    } finally { chatLock.current = false; setOpeningChat(false); }
  };
  const currentStage = stage({ id: eventId, status });
  const action = (label: string, kind: 'accept' | 'ready') => <TouchableOpacity
    accessibilityRole="button" disabled={busy || loading} onPress={() => void run(kind)}
    style={{ backgroundColor: colors.primary.gold, padding: 12, borderRadius: 8, marginTop: 12, opacity: busy ? 0.6 : 1 }}>
    {busy ? <ActivityIndicator color={colors.background.primary} /> : <Text style={{ color: colors.background.primary, fontWeight: '600' }}>{label}</Text>}
  </TouchableOpacity>;

  return <View style={{ padding: spacing.md, margin: spacing.md, borderRadius: 12, backgroundColor: colors.background.secondary }}>
    <Text style={{ color: colors.primary.gold, fontWeight: '600' }}>Odpowiedzialność magazynu</Text>
    <Text style={{ color: colors.text.secondary, marginTop: 8 }}>{OPERATIONAL_LABELS[currentStage] || 'Przygotowanie wydarzenia'}</Text>
    {loading ? <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary.gold} /> : <>
      <Text style={{ color: colors.text.primary, marginTop: 8 }}>
        {record?.accepted_at
          ? `${warehouseOwnerLabel(record, employee?.id)}\nPrzejęto: ${new Date(record.accepted_at).toLocaleString('pl-PL')}`
          : canAcceptWarehouseHandoff(status, record)
            ? 'Wydarzenie oczekuje na przejęcie przygotowania przez magazyn.'
            : 'Wydarzenie nie oczekuje na przejęcie przez magazyn.'}
      </Text>
      <Text style={{ color: colors.text.secondary, marginTop: 10, lineHeight: 20 }}>
        Zakres przygotowania: sprawdzenie sprzętu i braków, zamówienia, kompletacja oraz potwierdzenie gotowości. Przejęcie zapisuje osobę odpowiedzialną za przygotowanie magazynowe.
      </Text>
      {allowed && canAcceptWarehouseHandoff(status, record) && action('Przejmij przygotowanie wydarzenia', 'accept')}
      {record?.ready_at && <Text style={{ color: colors.text.primary, marginTop: 10 }}>Gotowość potwierdził(a): {record.ready_by_name} · {new Date(record.ready_at).toLocaleString('pl-PL')}</Text>}
      {allowed && record?.accepted_at && !record.ready_at && currentStage === 'in_preparation' && action('Potwierdź gotowość do realizacji', 'ready')}
      {allowed && record?.accepted_at && !record.ready_at && <Text style={{ color: colors.text.secondary, marginTop: 8 }}>Przed potwierdzeniem gotowości autor wydarzenia musi wyznaczyć kierownika realizacji.</Text>}
    </>}
    {managerRequired && !record?.ready_at && <View style={{ marginTop: 12 }}>
      {canView(employee, 'chat') ? <TouchableOpacity accessibilityRole="button"
        disabled={openingChat || busy} onPress={() => void contactAuthor()}
        style={{ backgroundColor: colors.primary.gold, padding: 12, borderRadius: 8, opacity: openingChat ? 0.6 : 1 }}>
        {openingChat ? <ActivityIndicator color={colors.background.primary} /> : <Text style={{ color: colors.background.primary, fontWeight: '600' }}>Napisz do autora</Text>}
      </TouchableOpacity> : <Text style={{ color: colors.text.secondary }}>Skontaktuj się z autorem wydarzenia w sprawie kierownika. Twoje konto nie ma dostępu do komunikatora.</Text>}
      {!!chatError && <Text accessibilityRole="alert" style={{ color: '#ff9999', marginTop: 8 }}>{chatError}</Text>}
    </View>}
    {!!error && <View style={{ marginTop: 10 }}><Text accessibilityRole="alert" style={{ color: '#ff9999' }}>{error}</Text><TouchableOpacity disabled={busy} onPress={() => void load()}><Text style={{ color: colors.primary.gold, paddingVertical: 10 }}>Odśwież</Text></TouchableOpacity></View>}
  </View>;
}
