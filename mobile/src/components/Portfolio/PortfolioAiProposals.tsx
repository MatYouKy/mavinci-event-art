import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';

/*
 * Asystent AI przy sekcjach karty realizacji (jak w CRM i na Macu): przycisk przy sekcji i panel z propozycjami
 * („Użyj”, „Inne propozycje”, zamknięcie). Propozycje nie zmieniają realizacji, dopóki ich nie użyjesz; zapis — „Zapisz”.
 */

export function AiButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[styles.button, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={`Asystent AI: ${label}`}>
      <Feather name="zap" size={13} color={colors.primary.gold} />
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function AiPanel({ title, onClose, onRetry, children }: { title: string; onClose: () => void; onRetry: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Feather name="zap" size={13} color={colors.primary.gold} />
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={onRetry} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>Inne</Text></TouchableOpacity>
        <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Zamknij propozycje">
          <Feather name="x" size={16} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

export function AiText({ label, text, hint, hintColor, onUse }: { label: string; text: string; hint?: string; hintColor?: string; onUse: () => void }) {
  return (
    <View style={styles.text}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={[styles.hint, hintColor ? { color: hintColor } : null]}>{hint}</Text> : null}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onUse} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>Użyj</Text></TouchableOpacity>
      </View>
      <Text style={styles.body} selectable>{text}</Text>
    </View>
  );
}

export function AiLink({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button">
      <Text style={[styles.link, disabled && { opacity: 0.4 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function AiChip({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={[styles.chip, done && { borderColor: colors.status.success }]}>
      <Text style={[styles.chipText, done && { color: colors.status.success }]}>{label}</Text>
    </View>
  );
}

export const aiStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
});

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: borderRadius.md, borderWidth: 1, borderColor: 'rgba(211,187,115,0.4)', backgroundColor: 'rgba(211,187,115,0.1)',
  },
  buttonText: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  panel: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, borderColor: 'rgba(211,187,115,0.35)', backgroundColor: colors.background.tertiary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, color: colors.primary.gold, fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.semibold },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  text: { gap: 4, padding: spacing.sm, borderRadius: borderRadius.sm, backgroundColor: 'rgba(0,0,0,0.2)' },
  label: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  hint: { color: colors.text.tertiary, fontSize: 11 },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: borderRadius.full, borderWidth: 1, borderColor: 'rgba(211,187,115,0.4)' },
  chipText: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
});
