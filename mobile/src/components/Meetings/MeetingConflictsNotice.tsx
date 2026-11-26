import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../theme';
import { conflictHeadline, conflictText, meetingConflicts, type AvailabilityBlock } from '../../lib/teamAvailability';
import { fetchAvailability } from '../../lib/teamAvailabilityApi';

/*
 * Ostrzeżenie w formularzu spotkania (jak w CRM i na Macu, docs/team-availability.md): kto z uczestników z firmy (także Ty) ma
 * w tym terminie spotkanie, event, fazę albo nieobecność. Nie blokuje zapisu; edytowane spotkanie się nie liczy.
 */
export default function MeetingConflictsNotice({ employeeIds, start, end, excludeMeetingId, names }: {
  employeeIds: string[];
  start: Date | null;
  end: Date | null;
  excludeMeetingId?: string | null;
  /** Nazwy osób (bieżący pracownik — „Ty”). */
  names: Record<string, string>;
}) {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const key = useMemo(() => Array.from(new Set(employeeIds.filter(Boolean))).sort().join(','), [employeeIds]);
  const from = start ? start.getTime() : NaN;
  const to = end ? end.getTime() : NaN;
  const valid = Number.isFinite(from) && Number.isFinite(to) && to > from;

  useEffect(() => {
    if (!valid || !key) {
      setBlocks([]);
      return undefined;
    }
    let cancelled = false;
    // Krótka zwłoka — zmiana godziny nie odpytuje bazy po każdym kroku.
    const timer = setTimeout(() => {
      setLoading(true);
      fetchAvailability(key.split(','), new Date(from), new Date(to), excludeMeetingId)
        .then((next) => { if (!cancelled) setBlocks(next); })
        .catch(() => { if (!cancelled) setBlocks([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, from, to, excludeMeetingId, valid]);

  const conflicts = useMemo(
    () => (valid && key ? meetingConflicts(blocks, new Date(from).toISOString(), new Date(to).toISOString(), key.split(',')) : []),
    [blocks, from, to, key, valid],
  );

  if (!conflicts.length) {
    return loading ? (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.text.tertiary} />
        <Text style={styles.loadingText}>Sprawdzanie, czy uczestnicy są wolni…</Text>
      </View>
    ) : null;
  }

  return (
    <View style={styles.box}>
      <View style={styles.headRow}>
        <Feather name="alert-triangle" size={15} color={colors.status.warning} />
        <Text style={styles.head}>{conflictHeadline(conflicts.length)}</Text>
      </View>
      {conflicts.map((conflict) => (
        <Text key={conflict.employeeId} style={styles.line}>
          <Text style={styles.name}>{names[conflict.employeeId] || 'Pracownik'}: </Text>
          {conflictText(conflict)}
        </Text>
      ))}
      <Text style={styles.hint}>Możesz zapisać spotkanie mimo to — uczestnicy zdecydują w odpowiedzi.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  loadingText: { color: colors.text.tertiary, fontSize: 12 },
  box: {
    marginTop: spacing.sm, padding: spacing.sm, borderRadius: 10, gap: 4, borderWidth: 1,
    borderColor: colors.status.warning + '55', backgroundColor: colors.status.warning + '14',
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  head: { flex: 1, color: colors.status.warning, fontSize: 13, fontWeight: '600' },
  line: { color: colors.text.secondary, fontSize: 12, lineHeight: 17 },
  name: { color: colors.text.primary, fontWeight: '600' },
  hint: { color: colors.text.tertiary, fontSize: 11, marginTop: 2 },
});
