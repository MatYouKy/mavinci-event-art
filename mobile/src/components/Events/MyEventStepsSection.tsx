import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { canView } from '../../lib/permissions';
import { useForegroundEffect } from '../../hooks/useForegroundEffect';
import { createRefreshQueue } from '../../lib/refreshQueue';
import { navigateToEvent, openInCrmWeb } from '../../navigation/navigationRef';
import { colors, spacing, borderRadius, typography, tone } from '../../theme';
import { MyEventStep } from '../../lib/eventSteps';
import { eventStepDetailLink } from '../../lib/eventStepLinks';
import EventStepsHelpModal from './EventStepsHelpModal';
import { EventStepRow, type EventStepRowLink, isEventStepsUnavailable, useEventStepActions } from './EventStepsPanel';

/*
 * „Moje kroki” na Dashboardzie — kroki realizacji, które bieżąca osoba może wykonać teraz (RPC get_my_event_steps),
 * w kolejności terminów. Ukryte, gdy lista jest pusta. Główną czynność można wykonać od razu; dotknięcie karty (poza
 * przyciskami) albo nazwy eventu otwiera event w zakładce „Kroki realizacji” — tam, gdzie krok czeka. „Przejdź” prowadzi do
 * zakładki, w której krok się zamyka (bez osobnej zakładki — do „Kroków realizacji”).
 * Tablet: siatka na całą szerokość (2 albo 3 kolumny, w podglądzie dwa rzędy); telefon — lista.
 */

const PREVIEW = 5;
const GRID_GAP = spacing.sm;

/** Liczba kolumn siatki dla szerokości obszaru kart. */
const gridColumns = (width: number) => (width >= 960 ? 3 : width >= 600 ? 2 : 1);

const eventDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

export default function MyEventStepsSection({ refreshKey }: { refreshKey: number }) {
  const { employee } = useAuth();
  const focused = useIsFocused();
  const [steps, setSteps] = useState<MyEventStep[] | null>(null);
  const [error, setError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const readVersion = useRef(0);
  const channelSuffix = useRef(Math.random().toString(36).slice(2, 10)).current;
  const employeeId = employee?.id;
  const canOpenEvents = canView(employee, 'events');
  const isWarehouseWorker = employee?.permissions?.includes('equipment_manage') === true;

  // „Przejdź”: zakładka eventu, w której krok się zamyka; umowa i finanse — CRM w przeglądarce; pozostałe — „Kroki realizacji”.
  const stepLink = (step: MyEventStep): EventStepRowLink | null => {
    const eventId = step.event?.id || step.event_id;
    if (!eventId) return null;
    const stepsTab: EventStepRowLink | null = canOpenEvents
      ? { label: 'Kroki realizacji', external: false, onPress: () => navigateToEvent(eventId, 'steps') }
      : null;
    const target = eventStepDetailLink(eventId, step.key, {
      isWedding: step.key === 'wedding_card',
      // Ekran wydarzenia sam wraca do „Szczegółów”, gdy zakładki Floty, Magazynu lub Podsumowania nie ma.
      hasFleet: true,
      hasWarehouse: isWarehouseWorker,
      hasSummary: true,
    });
    if (!target) return stepsTab;
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
  const columns = gridColumns(gridWidth);
  const preview = columns > 1 ? columns * 2 : PREVIEW;
  const visible = showAll ? steps : steps.slice(0, preview);
  const itemWidth = columns > 1 ? Math.floor((gridWidth - GRID_GAP * (columns - 1)) / columns) : undefined;
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

      <View
        style={columns > 1 ? styles.grid : null}
        onLayout={(event) => {
          const width = Math.round(event.nativeEvent.layout.width);
          setGridWidth((current) => (current === width ? current : width));
        }}
      >
      {visible.map((step) => {
        const date = eventDate(step.event?.event_date ?? null);
        const label = [step.event?.name || 'Event', date].filter(Boolean).join(' · ');
        const eventId = step.event?.id || step.event_id;
        const openEvent = canOpenEvents && eventId ? () => navigateToEvent(eventId, 'steps') : undefined;
        return (
          // Cała karta prowadzi do eventu (przyciski w środku działają po swojemu); czytnik ekranu — link z nazwą eventu.
          <Pressable key={step.id} accessible={false} disabled={!openEvent} onPress={openEvent}
            style={({ pressed }) => [itemWidth ? { width: itemWidth } : null, pressed ? styles.pressed : null]}>
            <EventStepRow
              style={itemWidth ? styles.gridItem : undefined}
              step={step}
              eventLabel={label}
              onOpenEvent={openEvent}
              link={stepLink(step)}
              actionsMode="primary"
              busyKey={runner.busyKey}
              error={rowError?.stepId === step.id ? rowError.message : null}
              onAction={runner.start}
            />
          </Pressable>
        );
      })}
      </View>

      {steps.length > preview && (
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
    fontWeight: '400',
    color: colors.text.primary,
  },
  summary: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 4 },
  alert: { color: tone('#ff9999'), fontWeight: typography.fontWeights.semibold },
  link: { color: colors.primary.gold, paddingVertical: 10 },
  error: { color: tone('#ff9999'), marginTop: spacing.sm },
  pressed: { opacity: 0.85 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, marginTop: spacing.sm },
  // Karta w siatce wypełnia wysokość wiersza (równe karty obok siebie); odstęp daje siatka.
  gridItem: { flex: 1, marginTop: 0 },
});
