import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { usePublicHolidays } from '../hooks/usePublicHolidays';
import { specialDaysInRange } from '../lib/publicHolidays';

const TONE = {
  danger: { border: colors.status.error, text: '#fecaca', icon: 'x-octagon' as const },
  warning: { border: colors.status.warning, text: '#fde68a', icon: 'alert-triangle' as const },
  info: { border: colors.status.info, text: '#bfdbfe', icon: 'info' as const },
};

/** Jak w CRM (src/components/crm/SpecialDayNotice.tsx): święto, niedziela, długi weekend, dzień „pomost”, Sylwester. */
export default function SpecialDayNotice({ from, to, style }: { from?: string | null; to?: string | null; style?: object }) {
  const holidays = usePublicHolidays(from, to);
  const days = specialDaysInRange(from, to, holidays).slice(0, 3);
  if (days.length === 0) return null;
  return (
    <View style={[styles.wrap, style]}>
      {days.map((day) => {
        const tone = TONE[day.tone];
        return (
          <View key={day.date} style={[styles.box, { borderColor: tone.border + '66', backgroundColor: tone.border + '14' }]}>
            <Feather name={tone.icon} size={14} color={tone.border} style={styles.icon} />
            <Text style={[styles.text, { color: tone.text }]}>{day.message}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  box: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  icon: { marginTop: 2, marginRight: 6 },
  text: { flex: 1, fontSize: 12, lineHeight: 17 },
});
