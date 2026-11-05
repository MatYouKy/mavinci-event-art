import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import EmployeeAvatar from '../../EmployeeAvatar';
import { colors } from '../../../theme';
import type { EquipmentChecklistPerson } from '../../../lib/equipmentChecklist';
import { formatEventStepDate } from '../../../lib/eventSteps';

/*
 * Kto i kiedy — mały awatar (zdjęcie z `people[...]` albo inicjał, wspólny EmployeeAvatar jak w czacie i zadaniach)
 * z imieniem: badge „Załadowane / Załadowane po wydarzeniu / Zwrócone” przy pozycji (jak w CRM) i podpis
 * zatwierdzenia etapu. Dotknięcie pokazuje osobę z datą i godziną.
 */

type Actor = { name: string | null; at: string | null; person?: EquipmentChecklistPerson | null };

export function showEquipmentActor(title: string, actor: Actor) {
  const name = actor.person?.name || actor.name || 'Pracownik';
  const when = formatEventStepDate(actor.at);
  Alert.alert(title, when ? `${name}\n${when}` : name);
}

function Avatar({ actor, size }: { actor: Actor; size: number }) {
  const name = actor.person?.name || actor.name || 'Pracownik';
  return (
    <EmployeeAvatar
      avatarUrl={actor.person?.avatar_url ?? null}
      avatarMetadata={(actor.person?.avatar_metadata as any) ?? null}
      employeeName={name}
      size={size}
    />
  );
}

/** Badge wykonanej pozycji: ✓ etykieta etapu + awatar + imię; dotknięcie → osoba, data i godzina. */
export function EquipmentDoneBadge({ label, actor }: { label: string; actor: Actor }) {
  const name = actor.person?.name || actor.name;
  return (
    <TouchableOpacity
      style={styles.badge}
      onPress={() => showEquipmentActor(label, actor)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${label}${name ? `: ${name}` : ''}${actor.at ? `, ${formatEventStepDate(actor.at)}` : ''}`}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    >
      <Feather name="check" size={13} color={GREEN_TEXT} />
      <Text style={styles.badgeLabel}>{label}</Text>
      {!!name && (
        <>
          <Avatar actor={actor} size={20} />
          <Text style={styles.badgeName} numberOfLines={1}>
            {name}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

/** Podpis zatwierdzenia etapu: „Wydanie potwierdził(a)” + awatar + imię + data. */
export function EquipmentPersonStamp({ label, actor, color }: { label: string; actor: Actor; color?: string }) {
  const name = actor.person?.name || actor.name;
  return (
    <TouchableOpacity
      style={styles.stamp}
      onPress={() => showEquipmentActor(label, actor)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${name || ''}${actor.at ? `, ${formatEventStepDate(actor.at)}` : ''}`}
    >
      <Text style={[styles.stampLabel, color ? { color } : null]}>{label}:</Text>
      {actor.person || actor.name ? <Avatar actor={actor} size={22} /> : null}
      <Text style={[styles.stampName, color ? { color } : null]} numberOfLines={1}>
        {[name, formatEventStepDate(actor.at)].filter(Boolean).join(' · ')}
      </Text>
    </TouchableOpacity>
  );
}

const GREEN_TEXT = '#86efac';

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 4,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: 14,
    maxWidth: '100%',
    backgroundColor: colors.status.success + '26',
  },
  badgeLabel: { fontSize: 12, fontWeight: '700', color: GREEN_TEXT },
  badgeName: { flexShrink: 1, fontSize: 12, color: colors.text.secondary },
  stamp: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, flexWrap: 'nowrap' },
  stampLabel: { fontSize: 13, color: colors.text.secondary },
  stampName: { flexShrink: 1, fontSize: 13, color: colors.text.primary },
});
