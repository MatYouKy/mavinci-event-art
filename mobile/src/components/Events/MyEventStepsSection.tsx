import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { canView } from '../../lib/permissions';
import { useForegroundEffect } from '../../hooks/useForegroundEffect';
import { createRefreshQueue } from '../../lib/refreshQueue';
import { navigateToEvent, openInCrmWeb } from '../../navigation/navigationRef';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { MyEventStep } from '../../lib/eventSteps';
import { eventStepDetailLink } from '../../lib/eventStepLinks';
import EventStepsHelpModal from './EventStepsHelpModal';
import { EventStepRow, type EventStepRowLink, isEventStepsUnavailable, useEventStepActions } from './EventStepsPanel';

/*
 * „Moje kroki” na Dashboardzie — kroki realizacji, które bieżąca osoba może wykonać teraz (RPC get_my_event_steps),
 * w kolejności terminów. Ukryte, gdy lista jest pusta. Główną czynność można wykonać od razu; dotknięcie
 * nazwy wydarzenia otwiera jego szczegóły.
 */

const PREVIEW = 5;

const eventDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

export default function MyEventStepsSection({ refreshKey }: { refreshKey: number }) {
  const { employee } = useAuth();
  const focused = useIsFocused();
  const [steps, setSteps] = useState<MyEventStep[] | null>(null);
  const [error, setError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const readVersion = useRef(0);
  const channelSuffix = useRef(Math.random().toString(36).slice(2, 10)).current;
  const employeeId = employee?.id;
  const canOpenEvents = canView(employee, 'events');
  const isWarehouseWorker = employee?.permissions?.includes('equipment_manage') === true;

  // „Przejdź”: zakładka wydarzenia, w której krok się zamyka; umowa i finanse — CRM w przeglądarce.
  const stepLink = (step: MyEventStep): EventStepRowLink | null => {
    const eventId = step.event?.id || step.event_id;
    if (!eventId) return null;
    const target = eventStepDetailLink(eventId, step.key, {
      isWedding: step.key === 'wedding_card',
      // Ekran wydarzenia sam wraca do „Szczegółów”, gdy zakładki Floty, Magazynu lub Podsumowania nie ma.
      hasFleet: true,
      hasWarehouse: isWarehouseWorker,
      hasSummary: true,
    });
    if (!target) return null;
    if (target.kind === 'crm') return { label: target.label, external: true, onPress: () => openInCrmWeb(target.path) };
    if (!canOpenEvents) return null;
    return { label: target.label, external: false, onPress: () => navigateToEvent(eventId, target.tab) };
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!employeeId) return;
      const version = ++readVersion.current;
      try {
        const { data, error: rpcError } = await supabase.rpc('get_my_event_steps');
        if (signal?.aborted || version !== readVersion.current) return;
        if (rpcError) {
          if (isEventStepsUnavailable(rpcError)) {
            setSteps(null);
            setError('');
          } else {
            setError('Nie udało się odświeżyć Twoich kroków realizacji.');
          }
          return;
        }
        setSteps(Array.isArray(data) ? (data as MyEventStep[]) : []);
        setError('');
      } catch {
        if (!signal?.aborted && version === readVersion.current) {
          setError('Nie udało się odświeżyć Twoich kroków realizacji.');
        }
      }
    },
    [employeeId],
  );

  useEffect(() => {
    readVersion.current++;
    setSteps(null);
    setError('');
  }, [employeeId]);

  useForegroundEffect(
    (signal) => {
      if (!focused || !employeeId) return;
      const queue = createRefreshQueue(signal, load);
      void queue.refresh();
      // RLS ogranicza zdarzenia do wydarzeń widocznych dla tej osoby; serie zmian kolejka łączy w jeden odczyt.
      const channel = supabase
        .channel(`mobile-my-event-steps-${employeeId}-${channelSuffix}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_steps' }, queue.schedule)
        .subscribe();
      return () => {
        readVersion.current++;
        return supabase.removeChannel(channel);
      };
    },
    [focused, employeeId, load],
  );

  // Tylko jawne odświeżenie z ekranu nadrzędnego (pociągnięcie ekranu); pierwszy odczyt robi efekt powyżej.
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefreshKey.current) return;
    lastRefreshKey.current = refreshKey;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Wynik czynności to stan jednego wydarzenia — listę „Moje kroki” czytamy ponownie.
  const runner = useEventStepActions(() => {
    void load();
  });

  // Pierwszy odczyt nieudany — krótki komunikat z ponowieniem zamiast pustego miejsca.
  if (!steps && error) {
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.title}>
          Moje kroki
        </Text>
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => void load()}>
          <Text style={styles.link}>Odśwież</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!steps || steps.length === 0) return null;
  const overdue = steps.filter((step) => step.overdue).length;
  const visible = showAll ? steps : steps.slice(0, PREVIEW);
  const rowError = runner.rowError;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Moje kroki
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Pomoc: kroki i odpowiedzialność"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => setHelpOpen(true)}
        >
          <Feather name="help-circle" size={20} color={colors.primary.gold} />
        </TouchableOpacity>
      </View>
      <Text style={styles.summary}>
        Do wykonania: {steps.length}
        {overdue > 0 ? <Text style={styles.alert}> · po terminie: {overdue}</Text> : null}
      </Text>

      {visible.map((step) => {
        const date = eventDate(step.event?.event_date ?? null);
        const label = [step.event?.name || 'Wydarzenie', date].filter(Boolean).join(' · ');
        return (
          <EventStepRow
            key={step.id}
            step={step}
            eventLabel={label}
            onOpenEvent={canOpenEvents && step.event?.id ? () => navigateToEvent(step.event.id, 'details') : undefined}
            link={stepLink(step)}
            actionsMode="primary"
            busyKey={runner.busyKey}
            error={rowError?.stepId === step.id ? rowError.message : null}
            onAction={runner.start}
          />
        );
      })}

      {steps.length > PREVIEW && (
        <TouchableOpacity accessibilityRole="button" onPress={() => setShowAll((value) => !value)}>
          <Text style={styles.link}>{showAll ? 'Pokaż mniej' : `Pokaż wszystkie (${steps.length})`}</Text>
        </TouchableOpacity>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}

      {runner.modal}
      <EventStepsHelpModal visible={helpOpen} onClose={() => setHelpOpen(false)} myRoles={null} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background.secondary,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.primary,
  },
  summary: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 4 },
  alert: { color: '#ff9999', fontWeight: typography.fontWeights.semibold },
  link: { color: colors.primary.gold, paddingVertical: 10 },
  error: { color: '#ff9999', marginTop: spacing.sm },
});
