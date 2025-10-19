import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Calendar } from 'lucide-react-native';
import { colors, spacing, typography } from '../theme';

export default function CalendarScreen() {
  return (
    <View style={styles.container}>
      <Calendar color={colors.primary.gold} size={64} />
      <Text style={styles.title}>Kalendarz</Text>
      <Text style={styles.subtitle}>Widok kalendarza będzie tutaj</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  title: {
    fontSize: typography.fontSizes.xxl,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
  },
});
