import React, { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, tone, withAlpha } from '../../theme';
import EmployeeAvatar from '../EmployeeAvatar';
import { taskDueBadge, taskPriority, type BoardTask, type TaskPerson } from '../../lib/tasksBoard';

/*
 * Karta zadania na tablicy — te same informacje co karta na Macu i w CRM (`TaskCard`): tytuł, początek opisu, priorytet, osoba
 * pracująca (licznik), termin (po terminie — czerwony, dziś/jutro — bursztynowy), komentarze, załączniki, przypisane osoby
 * (Ty na początku). Dotknięcie — szczegóły; uchwyt ≡ (jak w lejku zapytań) albo przytrzymanie karty — przeciąganie do innej
 * kolumny (jak w Trello); „⋯” — szybkie czynności.
 */

const avatarMetadata = (person: TaskPerson) =>
  person.avatar ? { desktop: { position: { posX: person.avatar.x, posY: person.avatar.y, scale: person.avatar.scale }, objectFit: person.avatar.fit } } : null;

const DUE_COLORS = { overdue: '#f87171', soon: '#fbbf24', later: '', done: '#4ade80' } as const;

type Props = {
  task: BoardTask;
  me: string | null;
  timerActive: boolean;
  busy?: boolean;
  /** Karta podniesiona (kopia pod palcem). */
  lifted?: boolean;
  onPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  onPressOut?: () => void;
  onMenu?: () => void;
  /** Uchwyt ≡ do przeciągania (tylko gdy wolno przenosić) — dotyk od razu podnosi kartę. */
  grip?: ReactNode;
};

export const TaskBoardCard = forwardRef<View, Props>(function TaskBoardCard(
  { task, me, timerActive, busy = false, lifted = false, onPress, onLongPress, onPressOut, onMenu, grip },
  ref,
) {
  const priority = taskPriority(task.priority);
  const due = taskDueBadge(task.dueDate, task.boardColumn === 'completed');
  const people = [...task.assignees.filter((person) => person.id === me), ...task.assignees.filter((person) => person.id !== me)];
  const dueColor = due && DUE_COLORS[due.state] ? tone(DUE_COLORS[due.state]) : colors.text.tertiary;

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      delayLongPress={260}
      disabled={lifted}
      style={({ pressed }) => [styles.card, timerActive && styles.cardTimer, pressed && !lifted && styles.cardPressed, lifted && styles.cardLifted]}
      accessibilityRole="button"
      accessibilityLabel={`Zadanie: ${task.titleLabel}`}
      accessibilityHint={grip ? 'Dotknij, aby otworzyć. Przeciągnij za uchwyt albo przytrzymaj, aby przenieść do innej kolumny.' : 'Dotknij, aby otworzyć.'}
    >
      <View style={styles.labelRow}>
        <View style={[styles.label, { backgroundColor: withAlpha(priority.color, 0.18) }]}>
          <Text style={[styles.labelText, { color: tone(priority.color) }]}>{priority.label}</Text>
        </View>
        {task.isPrivate ? <Feather name="lock" size={12} color={colors.text.tertiary} accessibilityLabel="Zadanie prywatne" /> : null}
        <View style={styles.flex} />
        {busy ? <ActivityIndicator size="small" color={colors.primary.gold} /> : null}
        {onMenu && !lifted ? (
          <TouchableOpacity onPress={onMenu} hitSlop={10} style={styles.menu} accessibilityRole="button" accessibilityLabel={`Czynności: ${task.titleLabel}`}>
            <Feather name="more-horizontal" size={18} color={colors.text.secondary} />
          </TouchableOpacity>
        ) : null}
        {!lifted ? grip : null}
      </View>

      <Text style={styles.title} numberOfLines={3}>{task.titleLabel}</Text>
      {task.description ? <Text style={styles.description} numberOfLines={2}>{task.description}</Text> : null}

      <View style={styles.badges}>
        {task.workingName ? (
          <View style={[styles.badge, { backgroundColor: withAlpha('#22c55e', 0.14) }]}>
            <View style={styles.workingDot} />
            <Text style={[styles.badgeText, { color: tone('#4ade80') }]} numberOfLines={1}>{task.workingName}</Text>
          </View>
        ) : null}
        {due ? (
          <View style={[styles.badge, due.state !== 'later' && { backgroundColor: withAlpha(DUE_COLORS[due.state] || '#9ca3af', 0.14) }]}>
            <Feather name={due.state === 'done' ? 'check' : 'clock'} size={12} color={dueColor} />
            <Text style={[styles.badgeText, { color: dueColor }]}>{due.label}</Text>
          </View>
        ) : null}
        {task.description ? <Feather name="align-left" size={13} color={colors.text.tertiary} accessibilityLabel="Ma opis" /> : null}
        {task.comments > 0 ? (
          <View style={styles.badge}>
            <Feather name="message-square" size={12} color={colors.text.tertiary} />
            <Text style={styles.badgeText}>{task.comments}</Text>
          </View>
        ) : null}
        {task.attachments > 0 ? (
          <View style={styles.badge}>
            <Feather name="paperclip" size={12} color={colors.text.tertiary} />
            <Text style={styles.badgeText}>{task.attachments}</Text>
          </View>
        ) : null}
        <View style={styles.flex} />
        {people.length ? (
          <View style={styles.people}>
            {people.slice(0, 4).map((person, index) => (
              <View key={person.id} style={[styles.avatar, index > 0 && styles.avatarOverlap]}>
                <EmployeeAvatar avatarUrl={person.avatarUrl} avatarMetadata={avatarMetadata(person)} employeeName={person.name} size={24} />
              </View>
            ))}
            {people.length > 4 ? <Text style={styles.more}>+{people.length - 4}</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    gap: 6, padding: spacing.sm + 4, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary,
    borderWidth: 1, borderColor: glow(0.08),
  },
  cardTimer: { borderColor: withAlpha('#22c55e', 0.5) },
  cardPressed: { opacity: 0.85 },
  cardLifted: {
    borderColor: colors.primary.gold, backgroundColor: colors.background.elevated,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 22 },
  label: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  labelText: { fontSize: 11, fontWeight: typography.fontWeights.semibold },
  menu: { width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.sm + 1, fontWeight: typography.fontWeights.semibold, lineHeight: 20 },
  description: { color: colors.text.secondary, fontSize: typography.fontSizes.xs + 1, lineHeight: 17 },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2, minHeight: 24 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, maxWidth: 160 },
  badgeText: { color: colors.text.tertiary, fontSize: 11, fontWeight: typography.fontWeights.medium },
  workingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ade80' },
  people: { flexDirection: 'row', alignItems: 'center' },
  avatar: { borderRadius: 13, borderWidth: 1, borderColor: colors.background.tertiary },
  avatarOverlap: { marginLeft: -7 },
  more: { color: colors.text.tertiary, fontSize: 11, marginLeft: 4 },
});
