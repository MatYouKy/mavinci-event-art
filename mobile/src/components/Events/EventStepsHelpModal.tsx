import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import {
  EVENT_STEPS_RULES,
  EventStepRole,
  EventStepsHelpRole,
  eventStepsHelpForRoles,
} from '../../lib/eventSteps';

/**
 * Pomoc „Kroki realizacji”: zakres odpowiedzialności każdej roli i jak zamknąć swój zakres.
 * Treść pochodzi ze wspólnego pliku eventSteps.ts — ta sama co w CRM.
 * `myRoles` = role bieżącej osoby na wydarzeniu (z get_event_steps); `null` = bez kontekstu wydarzenia.
 */
export default function EventStepsHelpModal({
  visible,
  onClose,
  myRoles,
}: {
  visible: boolean;
  onClose: () => void;
  myRoles?: Partial<Record<EventStepRole, boolean>> | null;
}) {
  const { mine, others } = useMemo(() => eventStepsHelpForRoles(myRoles ?? null), [myRoles]);
  const sections = useMemo(() => [...mine, ...others], [mine, others]);
  const [selected, setSelected] = useState<EventStepsHelpRole | null>(null);

  const firstRole = sections[0]?.role ?? null;
  // Po każdym otwarciu zaczynamy od własnej roli (albo pierwszej z listy); odświeżenie danych nie zmienia karty.
  useEffect(() => {
    if (visible) setSelected(firstRole);
  }, [visible, firstRole]);

  const section = sections.find((item) => item.role === selected) ?? sections[0];
  const isMine = (role: EventStepsHelpRole) => mine.some((item) => item.role === role);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.headerTitle}>
            Kroki realizacji — pomoc
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Zamknij pomoc"
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.closeBtn}
          >
            <Feather name="x" size={22} color={colors.text.primary} />
          </TouchableOpacity>
        </View>

        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {sections.map((item) => {
              const active = item.role === section?.role;
              return (
                <TouchableOpacity
                  key={item.role}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSelected(item.role)}
                  style={[styles.tab, active && styles.tabActive]}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.title}</Text>
                  {isMine(item.role) && <Text style={styles.tabMine}>Twoja rola</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {section && (
            <>
              <View style={styles.titleRow}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {isMine(section.role) && (
                  <View style={styles.mineBadge}>
                    <Text style={styles.mineBadgeText}>Twoja rola</Text>
                  </View>
                )}
              </View>
              <Text style={styles.summary}>{section.summary}</Text>

              <Text style={styles.heading}>Twój zakres</Text>
              {section.responsibilities.map((line, index) => (
                <Bullet key={index} text={line} />
              ))}

              <Text style={styles.heading}>Kroki i jak je wykonać</Text>
              {section.steps.map((step, index) => (
                <View key={index} style={styles.stepCard}>
                  <Text style={styles.stepTitle}>
                    {index + 1}. {step.title}
                  </Text>
                  <Text style={styles.stepHow}>{step.how}</Text>
                </View>
              ))}

              <Text style={styles.heading}>Jak dobrze zamknąć swój zakres</Text>
              {section.closeScope.map((line, index) => (
                <Bullet key={index} text={line} icon="check" />
              ))}

              <Text style={styles.heading}>Nie należy do Ciebie</Text>
              <View style={styles.notYours}>
                <Feather name="slash" size={14} color={colors.text.secondary} style={{ marginTop: 2 }} />
                <Text style={styles.notYoursText}>{section.notYours}</Text>
              </View>
            </>
          )}

          <Text style={styles.heading}>Zasady</Text>
          {EVENT_STEPS_RULES.map((line, index) => (
            <Bullet key={index} text={line} />
          ))}

          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.doneBtn}>
            <Text style={styles.doneBtnText}>Zamknij</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Bullet({ text, icon }: { text: string; icon?: 'check' }) {
  return (
    <View style={styles.bullet}>
      {icon ? (
        <Feather name="check" size={14} color={colors.primary.gold} style={{ marginTop: 3 }} />
      ) : (
        <View style={styles.dot} />
      )}
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'ios' ? spacing.lg : spacing.xl,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background.secondary,
  },
  headerTitle: {
    flex: 1,
    color: colors.text.primary,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
  },
  closeBtn: { padding: spacing.xs },
  tabs: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: 'rgba(211, 187, 115, 0.18)' },
  tabText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  tabTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  tabMine: { color: colors.primary.gold, fontSize: 10, marginTop: 2 },
  body: { flex: 1 },
  bodyContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  sectionTitle: {
    color: colors.text.primary,
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
  },
  mineBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: 'rgba(211, 187, 115, 0.18)',
  },
  mineBadgeText: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  summary: { color: colors.text.secondary, marginTop: spacing.sm, lineHeight: 20 },
  heading: {
    color: colors.primary.gold,
    fontWeight: typography.fontWeights.semibold,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  bullet: { flexDirection: 'row', gap: spacing.sm, marginBottom: 6 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary.gold, marginTop: 8 },
  bulletText: { flex: 1, color: colors.text.primary, lineHeight: 20 },
  stepCard: {
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.secondary,
    marginBottom: spacing.sm,
  },
  stepTitle: { color: colors.text.primary, fontWeight: typography.fontWeights.semibold },
  stepHow: { color: colors.text.secondary, marginTop: 4, lineHeight: 20 },
  notYours: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.secondary,
  },
  notYoursText: { flex: 1, color: colors.text.secondary, lineHeight: 20 },
  doneBtn: {
    marginTop: spacing.lg,
    padding: 14,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
  },
  doneBtnText: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
});
