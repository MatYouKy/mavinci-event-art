import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { useForegroundEffect } from '../../hooks/useForegroundEffect';
import { createRefreshQueue } from '../../lib/refreshQueue';
import { colors, spacing, borderRadius, typography } from '../../theme';
import {
  EVENT_STEP_KIND_LABELS,
  EVENT_STEP_ROLE_LABELS,
  EVENT_STEP_STATUS_LABELS,
  EventStep,
  EventStepAction,
  EventStepRole,
  EventStepTone,
  EventStepsSnapshot,
  eventStepActionBlocked,
  eventStepActionLabel,
  eventStepActionNeedsForm,
  eventStepAvailableActions,
  eventStepDueLabel,
  eventStepErrorMessage,
  eventStepHistoryLabel,
  eventStepNoteRule,
  eventStepOwnerLabel,
  eventStepPrimaryAction,
  eventStepQuantityLabel,
  eventStepTone,
  formatEventStepDate,
  groupEventStepsByStage,
  isEventStepLive,
} from '../../lib/eventSteps';
import EventStepsHelpModal from './EventStepsHelpModal';
import { AddEventStepModal, EventStepActionModal, EventStepActionRequest, NewEventStepInput } from './EventStepForms';

/*
 * „Kroki realizacji” wydarzenia — kto, co i do kiedy (RPC get_event_steps / update_event_step / add_event_step,
 * migracja 20261104200000). Stan kroków zmienia wyłącznie baza; aplikacja pokazuje przyciski według eventSteps.ts
 * (ta sama kopia co w CRM), a odpowiedź RPC jest nowym stanem panelu.
 */

/** Kolory tonów statusu z eventStepTone w palecie aplikacji (jaśniejsze odcienie dla czytelności na ciemnym tle). */
export const EVENT_STEP_TONE_COLORS: Record<EventStepTone, string> = {
  neutral: colors.text.secondary,
  progress: '#60a5fa',
  success: '#4ade80',
  danger: '#f87171',
  muted: colors.text.tertiary,
  warning: '#fbbf24',
};

const ERROR_TEXT = '#ff9999';

/** Brak dostępu (42501) albo brak funkcji przed wdrożeniem migracji — panel się nie pokazuje. */
export function isEventStepsUnavailable(error: { code?: string } | null | undefined): boolean {
  return ['42501', 'PGRST202', '42883'].includes(error?.code ?? '');
}

function readErrorMessage(error: unknown): string {
  const message = eventStepErrorMessage(error);
  return message.startsWith('Brak połączenia') ? message : 'Nie udało się odświeżyć kroków realizacji.';
}

function callPhone(phone: string) {
  const number = phone.replace(/[^+\d]/g, '');
  if (!number) return;
  void Linking.openURL(`tel:${number}`).catch(() => Alert.alert('Kontakt', 'Nie udało się otworzyć aplikacji telefonu.'));
}

/** Główna czynność kroku — wspólna reguła z `lib/eventSteps` (ta sama w CRM). */
export { eventStepPrimaryAction };

// ---------------------------------------------------------------------------------------------------------------
// Wykonywanie czynności (wspólne dla panelu wydarzenia i „Moje kroki”)
// ---------------------------------------------------------------------------------------------------------------

export function useEventStepActions(
  onSuccess: (snapshot: EventStepsSnapshot | null, step: EventStep, action: EventStepAction) => void,
) {
  const lock = useRef(false);
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [request, setRequest] = useState<EventStepActionRequest | null>(null);
  const [formError, setFormError] = useState('');
  const [rowError, setRowError] = useState<{ stepId: string; message: string } | null>(null);

  const execute = async (
    step: EventStep,
    action: EventStepAction,
    note: string | null,
    payload: Record<string, string>,
    fromForm: boolean,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusyKey(`${step.id}:${action}`);
    setFormError('');
    setRowError(null);
    try {
      const { data, error } = await supabase.rpc('update_event_step', {
        p_step_id: step.id,
        p_action: action,
        p_note: note || null,
        p_payload: payload,
      });
      if (error) throw error;
      setRequest(null);
      successRef.current((data as EventStepsSnapshot) ?? null, step, action);
    } catch (cause) {
      const message = eventStepErrorMessage(cause);
      if (fromForm) setFormError(message);
      else setRowError({ stepId: step.id, message });
    } finally {
      lock.current = false;
      setBusyKey(null);
    }
  };

  /** withNote = przytrzymanie przycisku: otwiera okno z opcjonalną notatką. */
  const start = (step: EventStep, action: EventStepAction, withNote = false) => {
    if (lock.current || eventStepActionBlocked(step, action)) return;
    setRowError(null);
    if (eventStepActionNeedsForm(step, action) || (withNote && eventStepNoteRule(step, action))) {
      setFormError('');
      setRequest({ step, action });
      return;
    }
    void execute(step, action, null, {}, false);
  };

  const modal = (
    <EventStepActionModal
      request={request}
      busy={busyKey !== null}
      error={formError}
      onCancel={() => {
        if (!lock.current) setRequest(null);
      }}
      onSubmit={(note, payload) => {
        if (request) void execute(request.step, request.action, note, payload, true);
      }}
    />
  );

  return { busyKey, rowError, start, modal };
}

// ---------------------------------------------------------------------------------------------------------------
// Wiersz kroku
// ---------------------------------------------------------------------------------------------------------------

export function EventStepRow({
  step,
  busyKey,
  error,
  onAction,
  actionsMode = 'all',
  eventLabel,
  onOpenEvent,
  now,
}: {
  step: EventStep;
  /** `${step.id}:${action}` trwającej czynności (dowolnego kroku). */
  busyKey?: string | null;
  error?: string | null;
  onAction?: (step: EventStep, action: EventStepAction, withNote?: boolean) => void;
  /** 'primary' — tylko główna czynność (lista „Moje kroki”). */
  actionsMode?: 'all' | 'primary' | 'none';
  /** Nazwa wydarzenia nad krokiem (lista „Moje kroki”). */
  eventLabel?: string;
  onOpenEvent?: () => void;
  now?: Date;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = eventStepTone(step);
  const toneColor = EVENT_STEP_TONE_COLORS[tone];
  const live = isEventStepLive(step);
  const available = eventStepAvailableActions(step);
  const primary = eventStepPrimaryAction(step, available);
  const actions: EventStepAction[] =
    actionsMode === 'none' || !onAction
      ? []
      : actionsMode === 'primary'
        ? primary
          ? [primary]
          : []
        : available;
  const dueLabel = eventStepDueLabel(step, now);
  const quantity = eventStepQuantityLabel(step);
  const phone = step.assignee?.phone && !step.is_mine ? step.assignee.phone : null;
  const hasMore =
    Boolean(step.details) || step.history.length > 0 || Boolean(step.completed_at) || Boolean(step.ordered_at);
  const anyBusy = Boolean(busyKey);

  const rowBackground =
    step.status === 'problem'
      ? 'rgba(239, 68, 68, 0.12)'
      : step.overdue && live
        ? 'rgba(245, 158, 11, 0.10)'
        : colors.background.tertiary;

  return (
    <View style={[styles.row, { backgroundColor: rowBackground }]}>
      {!!eventLabel && (
        <TouchableOpacity
          accessibilityRole={onOpenEvent ? 'link' : undefined}
          accessibilityLabel={onOpenEvent ? `Otwórz wydarzenie: ${eventLabel}` : undefined}
          disabled={!onOpenEvent}
          onPress={onOpenEvent}
        >
          <Text style={styles.eventLabel} numberOfLines={1}>
            {eventLabel}
            {onOpenEvent ? ' →' : ''}
          </Text>
        </TouchableOpacity>
      )}
      <View style={styles.chipRow}>
        <View style={[styles.statusChip, { backgroundColor: `${toneColor}26` }]}>
          <Text style={[styles.statusChipText, { color: toneColor }]}>{EVENT_STEP_STATUS_LABELS[step.status]}</Text>
        </View>
        <Text style={styles.kind}>{EVENT_STEP_KIND_LABELS[step.kind]}</Text>
        {step.blocks_ready && live && <Text style={styles.kind}>· wymagane przed gotowością</Text>}
      </View>
      <TouchableOpacity
        activeOpacity={onOpenEvent ? 0.7 : 1}
        disabled={!onOpenEvent}
        onPress={onOpenEvent}
      >
        <Text style={styles.title}>{step.title}</Text>
      </TouchableOpacity>

      {!!quantity && <Meta icon="hash" text={`Ilość: ${quantity}`} />}
      {!!step.supplier && <Meta icon="truck" text={`Dostawca: ${step.supplier}`} />}
      {!!step.expected_at && <Meta icon="package" text={`Dostawa: ${formatEventStepDate(step.expected_at)}`} />}
      <View style={styles.metaRow}>
        <Feather name="user" size={13} color={colors.text.tertiary} />
        <Text style={styles.metaText}>
          {eventStepOwnerLabel(step)}
          {step.is_mine ? ' (Ty)' : ''}
        </Text>
        {!!phone && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Zadzwoń: ${step.assignee?.name || 'osoba odpowiedzialna'}`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => callPhone(phone)}
          >
            <Text style={styles.callLink}>Zadzwoń</Text>
          </TouchableOpacity>
        )}
      </View>
      {!!dueLabel && (
        <View style={styles.metaRow}>
          <Feather name="clock" size={13} color={step.overdue ? ERROR_TEXT : colors.text.tertiary} />
          <Text style={[styles.metaText, step.overdue && styles.overdue]}>{dueLabel}</Text>
        </View>
      )}
      {step.blocked_by.length > 0 && live && (
        <View style={styles.metaRow}>
          <Feather name="lock" size={13} color={EVENT_STEP_TONE_COLORS.warning} />
          <Text style={[styles.metaText, { color: EVENT_STEP_TONE_COLORS.warning }]}>
            Czeka na:{' '}
            {step.blocked_by.map((item) => `${item.title} (${EVENT_STEP_ROLE_LABELS[item.owner_role]})`).join(', ')}
          </Text>
        </View>
      )}
      {!!step.status_note && (
        <Text style={[styles.note, step.status === 'problem' && { color: ERROR_TEXT }]}>{step.status_note}</Text>
      )}

      {hasMore && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={styles.expandBtn}
        >
          <Text style={styles.expandText}>{expanded ? 'Zwiń szczegóły' : 'Szczegóły i historia'}</Text>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary.gold} />
        </TouchableOpacity>
      )}
      {expanded && (
        <View style={styles.details}>
          {!!step.details && <Text style={styles.detailsText}>{step.details}</Text>}
          {!!step.ordered_at && <Text style={styles.historyText}>Zamówiono: {formatEventStepDate(step.ordered_at)}</Text>}
          {!!step.completed_at && (
            <Text style={styles.historyText}>
              {step.status === 'skipped' ? 'Pominięto' : 'Zamknięto'}: {formatEventStepDate(step.completed_at)}
              {step.completed_by_name ? ` · ${step.completed_by_name}` : ''}
            </Text>
          )}
          {step.history.length > 0 && <Text style={styles.historyHeading}>Ostatnie zmiany</Text>}
          {step.history.map((entry, index) => (
            <View key={`${entry.at}-${index}`} style={styles.historyEntry}>
              <Text style={styles.historyText}>{eventStepHistoryLabel(entry)}</Text>
              {!!entry.note && <Text style={styles.historyNote}>{entry.note}</Text>}
            </View>
          ))}
        </View>
      )}

      {actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((action) => {
            const blocked = eventStepActionBlocked(step, action);
            const busy = busyKey === `${step.id}:${action}`;
            const isPrimary = action === primary;
            const rule = eventStepNoteRule(step, action);
            const optionalNote = Boolean(rule) && !eventStepActionNeedsForm(step, action);
            const label = eventStepActionLabel(step, action);
            return (
              <TouchableOpacity
                key={action}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${step.title}`}
                accessibilityHint={
                  blocked ? 'Najpierw muszą być zamknięte wcześniejsze kroki' : optionalNote ? 'Przytrzymaj, aby dodać notatkę' : undefined
                }
                accessibilityState={{ disabled: blocked || anyBusy, busy }}
                disabled={blocked || anyBusy}
                onPress={() => onAction?.(step, action)}
                onLongPress={optionalNote ? () => onAction?.(step, action, true) : undefined}
                style={[
                  styles.actionBtn,
                  isPrimary ? styles.actionPrimary : styles.actionSecondary,
                  (blocked || (anyBusy && !busy)) && styles.actionDisabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={isPrimary ? colors.background.primary : colors.primary.gold} />
                ) : (
                  <View style={styles.actionInner}>
                    {blocked && <Feather name="lock" size={12} color={isPrimary ? colors.background.primary : colors.primary.gold} />}
                    <Text
                      style={[
                        styles.actionText,
                        isPrimary ? styles.actionPrimaryText : styles.actionSecondaryText,
                        action === 'problem' && !isPrimary && { color: ERROR_TEXT },
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.rowError}>
          {error}
        </Text>
      )}
    </View>
  );
}

function Meta({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) {
  return (
    <View style={styles.metaRow}>
      <Feather name={icon} size={13} color={colors.text.tertiary} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Panel wydarzenia
// ---------------------------------------------------------------------------------------------------------------

const WAITING_PREVIEW = 3;

export default function EventStepsPanel({
  eventId,
  onChanged,
  refreshKey,
  style,
}: {
  eventId: string;
  /** Po udanej czynności (np. przyjęcie przez magazyn zmienia stan wydarzenia). */
  onChanged?: () => void;
  /** Zmiana wartości wymusza odświeżenie (np. pociągnięcie ekranu). */
  refreshKey?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const focused = useIsFocused();
  const [snapshot, setSnapshot] = useState<EventStepsSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [stageOpen, setStageOpen] = useState<Record<string, boolean>>({});
  const readVersion = useRef(0);
  const addLock = useRef(false);
  const channelSuffix = useRef(Math.random().toString(36).slice(2, 10)).current;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  useEffect(() => {
    readVersion.current++;
    setSnapshot(null);
    setUnavailable(false);
    setLoadError('');
    setStageOpen({});
    setShowAllWaiting(false);
  }, [eventId]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++readVersion.current;
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_event_steps', { p_event_id: eventId });
        if (signal?.aborted || version !== readVersion.current) return;
        if (error) {
          if (isEventStepsUnavailable(error)) {
            setUnavailable(true);
            setSnapshot(null);
            setLoadError('');
          } else {
            setLoadError(readErrorMessage(error));
          }
          return;
        }
        setUnavailable(false);
        setSnapshot((data as EventStepsSnapshot) ?? null);
        setLoadError('');
      } catch (cause) {
        if (!signal?.aborted && version === readVersion.current) setLoadError(readErrorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [eventId],
  );

  useForegroundEffect(
    (signal) => {
      if (!focused) return;
      const queue = createRefreshQueue(signal, load);
      void queue.refresh();
      const channel = supabase
        .channel(`mobile-event-steps-${eventId}-${channelSuffix}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'event_steps', filter: `event_id=eq.${eventId}` },
          queue.schedule,
        )
        .subscribe();
      return () => {
        readVersion.current++;
        return supabase.removeChannel(channel);
      };
    },
    [eventId, focused, load],
  );

  // Tylko jawne odświeżenie z ekranu nadrzędnego (pociągnięcie ekranu); pierwszy odczyt robi efekt powyżej.
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefreshKey.current) return;
    lastRefreshKey.current = refreshKey;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const applySnapshot = (next: EventStepsSnapshot | null) => {
    // Wynik zapisu jest najnowszym stanem — unieważnia trwające odczyty.
    readVersion.current++;
    setLoading(false);
    if (next) setSnapshot(next);
    else void load();
    changedRef.current?.();
  };

  const runner = useEventStepActions((next) => applySnapshot(next));

  const addStep = async (input: NewEventStepInput) => {
    if (addLock.current) return;
    addLock.current = true;
    setAddBusy(true);
    setAddError('');
    try {
      const { data, error } = await supabase.rpc('add_event_step', {
        p_event_id: eventId,
        p_title: input.title,
        p_kind: input.kind,
        p_owner_role: input.ownerRole,
        p_due_at: input.dueAt,
        p_details: input.details,
        p_blocks_ready: input.blocksReady,
      });
      if (error) throw error;
      setAddOpen(false);
      applySnapshot((data as EventStepsSnapshot) ?? null);
    } catch (cause) {
      setAddError(eventStepErrorMessage(cause));
    } finally {
      addLock.current = false;
      setAddBusy(false);
    }
  };

  if (unavailable) return null;
  if (!snapshot) {
    if (!loadError) return null;
    return (
      <View style={[styles.panel, style]}>
        <Text style={styles.panelTitle}>Kroki realizacji</Text>
        <Text accessibilityRole="alert" style={styles.loadError}>
          {loadError}
        </Text>
        <TouchableOpacity accessibilityRole="button" disabled={loading} onPress={() => void load()}>
          <Text style={styles.refreshLink}>{loading ? 'Odświeżanie…' : 'Odśwież'}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!snapshot.steps?.length) return null;

  const progressValues = Object.values(snapshot.progress || {});
  const total = progressValues.reduce((sum, item) => sum + (item?.total || 0), 0) || snapshot.steps.length;
  const done = progressValues.reduce((sum, item) => sum + (item?.done || 0), 0);
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const myRoles = (Object.keys(snapshot.my_roles || {}) as EventStepRole[]).filter((role) => snapshot.my_roles[role]);
  const waiting = snapshot.waiting_for || [];
  const visibleWaiting = showAllWaiting ? waiting : waiting.slice(0, WAITING_PREVIEW);
  const groups = groupEventStepsByStage(snapshot.steps);
  const rowError = runner.rowError;

  return (
    <View style={[styles.panel, style]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={styles.panelTitle}>
            Kroki realizacji
          </Text>
          <Text style={styles.progressText}>
            Zamknięte {done} z {total}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Pomoc: kroki i odpowiedzialność"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => setHelpOpen(true)}
          style={styles.iconBtn}
        >
          <Feather name="help-circle" size={20} color={colors.primary.gold} />
        </TouchableOpacity>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>
      {myRoles.length > 0 && (
        <Text style={styles.roles}>
          {myRoles.length >= Object.keys(EVENT_STEP_ROLE_LABELS).length
            ? 'Możesz wykonywać kroki wszystkich ról'
            : `Twoje role: ${myRoles.map((role) => EVENT_STEP_ROLE_LABELS[role]).join(', ')}`}
        </Text>
      )}

      {waiting.length > 0 && (
        <View style={styles.waiting}>
          <Text style={styles.waitingTitle}>Czekamy na ({waiting.length})</Text>
          {visibleWaiting.map((step) => {
            const due = eventStepDueLabel(step);
            const phone = step.assignee?.phone && !step.is_mine ? step.assignee.phone : null;
            return (
              <View key={step.id} style={styles.waitingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.waitingStep}>{step.title}</Text>
                  <Text style={styles.waitingMeta}>
                    {eventStepOwnerLabel(step)}
                    {step.is_mine ? ' (Ty)' : ''}
                  </Text>
                  {!!due && <Text style={[styles.waitingMeta, step.overdue && styles.overdue]}>{due}</Text>}
                </View>
                {!!phone && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Zadzwoń: ${step.assignee?.name || 'osoba odpowiedzialna'}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => callPhone(phone)}
                    style={styles.phoneBtn}
                  >
                    <Feather name="phone" size={16} color={colors.primary.gold} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {waiting.length > WAITING_PREVIEW && (
            <TouchableOpacity accessibilityRole="button" onPress={() => setShowAllWaiting((value) => !value)}>
              <Text style={styles.refreshLink}>{showAllWaiting ? 'Pokaż mniej' : `Pokaż wszystkie (${waiting.length})`}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {groups.map((group) => {
        const progress = snapshot.progress?.[group.stage];
        const hasLive = group.steps.some(isEventStepLive);
        const open = stageOpen[group.stage] ?? hasLive;
        return (
          <View key={group.stage} style={styles.stage}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() => setStageOpen((current) => ({ ...current, [group.stage]: !open }))}
              style={styles.stageHeader}
            >
              <Text style={styles.stageTitle}>{group.label}</Text>
              {!!progress && (
                <Text style={[styles.stageProgress, progress.done >= progress.total && { color: EVENT_STEP_TONE_COLORS.success }]}>
                  {progress.done}/{progress.total}
                </Text>
              )}
              <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text.secondary} />
            </TouchableOpacity>
            {open &&
              group.steps.map((step) => (
                <EventStepRow
                  key={step.id}
                  step={step}
                  busyKey={runner.busyKey}
                  error={rowError?.stepId === step.id ? rowError.message : null}
                  onAction={runner.start}
                />
              ))}
          </View>
        );
      })}

      {snapshot.can_add && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => {
            setAddError('');
            setAddOpen(true);
          }}
          style={styles.addBtn}
        >
          <Feather name="plus" size={16} color={colors.primary.gold} />
          <Text style={styles.addText}>Dodaj krok</Text>
        </TouchableOpacity>
      )}

      {!!loadError && (
        <View style={{ marginTop: spacing.sm }}>
          <Text accessibilityRole="alert" style={styles.loadError}>
            {loadError}
          </Text>
          <TouchableOpacity accessibilityRole="button" disabled={loading} onPress={() => void load()}>
            <Text style={styles.refreshLink}>{loading ? 'Odświeżanie…' : 'Odśwież'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {runner.modal}
      <AddEventStepModal
        visible={addOpen}
        busy={addBusy}
        error={addError}
        onSubmit={(input) => void addStep(input)}
        onCancel={() => {
          if (!addLock.current) setAddOpen(false);
        }}
      />
      <EventStepsHelpModal visible={helpOpen} onClose={() => setHelpOpen(false)} myRoles={snapshot.my_roles} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background.secondary,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  panelTitle: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.md },
  progressText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 2 },
  iconBtn: { padding: 4 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background.tertiary,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary.gold },
  roles: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, marginTop: spacing.sm },
  waiting: {
    marginTop: spacing.md,
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(211, 187, 115, 0.08)',
    gap: spacing.sm,
  },
  waitingTitle: { color: colors.text.primary, fontWeight: typography.fontWeights.semibold },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  waitingStep: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  waitingMeta: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 1 },
  phoneBtn: { padding: 10, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  overdue: { color: ERROR_TEXT, fontWeight: typography.fontWeights.semibold },
  stage: { marginTop: spacing.md },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  stageTitle: { flex: 1, color: colors.text.primary, fontWeight: typography.fontWeights.semibold },
  stageProgress: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  row: { marginTop: spacing.sm, padding: 12, borderRadius: borderRadius.md, gap: 4 },
  eventLabel: { color: colors.primary.gold, fontSize: typography.fontSizes.xs, marginBottom: 2 },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.sm },
  statusChipText: { fontSize: 11, fontWeight: typography.fontWeights.semibold },
  kind: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.medium, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, flexShrink: 1 },
  callLink: { color: colors.primary.gold, fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.semibold },
  note: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, fontStyle: 'italic', marginTop: 2 },
  expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, alignSelf: 'flex-start' },
  expandText: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  details: { padding: 10, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary, gap: 4 },
  detailsText: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  historyHeading: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 4 },
  historyEntry: { gap: 1 },
  historyText: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  historyNote: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, fontStyle: 'italic' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: borderRadius.md, minHeight: 36, justifyContent: 'center' },
  actionInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionPrimary: { backgroundColor: colors.primary.gold },
  actionSecondary: { backgroundColor: colors.background.elevated },
  actionDisabled: { opacity: 0.45 },
  actionText: { fontSize: typography.fontSizes.sm },
  actionPrimaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
  actionSecondaryText: { color: colors.primary.gold },
  rowError: { color: ERROR_TEXT, marginTop: 6, fontSize: typography.fontSizes.sm },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
    alignSelf: 'flex-start',
  },
  addText: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  loadError: { color: ERROR_TEXT, marginTop: spacing.sm },
  refreshLink: { color: colors.primary.gold, paddingVertical: 8 },
});
