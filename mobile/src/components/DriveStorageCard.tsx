import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../theme';
import { driveStorageLevel, formatDriveBytes, formatDriveShare, type DriveStorageUsage } from '../lib/driveShared';
import { driveErrorMessage, fetchDriveStorage } from '../lib/driveApi';

/*
 * Dysk → „Miejsce na Dysku” w aplikacji — tylko administrator (`root.storage`), jak w CRM i na Macu: zajętość plików względem
 * zakupionego pakietu, po dotknięciu — podział na rodzaje plików i baza danych. Pakiet zmienia się w CRM albo na Macu.
 */

const LEVEL_COLORS = { ok: colors.primary.gold, warning: colors.status.warning, critical: colors.status.error } as const;

function Bar({ used, quota, height = 6 }: { used: number; quota: number; height?: number }) {
  const share = quota > 0 ? Math.min(1, Math.max(0, used / quota)) : 0;
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}
      accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
      <View style={{ height, borderRadius: height / 2, width: `${used > 0 ? Math.max(1.5, share * 100) : 0}%`, backgroundColor: LEVEL_COLORS[driveStorageLevel(used, quota)] }} />
    </View>
  );
}

function Usage({ title, used, quota }: { title: string; used: number; quota: number }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.between}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.value}>{formatDriveBytes(used)} z {formatDriveBytes(quota)}</Text>
      </View>
      <Bar used={used} quota={quota} height={8} />
      <Text style={styles.muted}>Zajęte {formatDriveShare(used, quota)} · zostało {formatDriveBytes(Math.max(0, quota - used))}</Text>
    </View>
  );
}

export default function DriveStorageCard() {
  const [usage, setUsage] = useState<DriveStorageUsage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsage(await fetchDriveStorage());
      setError('');
    } catch (cause) {
      setError(driveErrorMessage(cause, 'Nie udało się odczytać zajętości miejsca.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = () => {
    if (!open) void load();
    setOpen((value) => !value);
  };

  return (
    <TouchableOpacity style={styles.card} onPress={toggle} accessibilityRole="button"
      accessibilityLabel="Miejsce na Dysku" accessibilityHint={open ? 'Zwija szczegóły' : 'Pokazuje szczegóły zajętości'}>
      <View style={styles.between}>
        <View style={styles.titleRow}>
          <Feather name="hard-drive" size={16} color={colors.primary.gold} />
          <Text style={styles.title}>Miejsce na Dysku</Text>
        </View>
        {loading ? <ActivityIndicator size="small" color={colors.primary.gold} /> : <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text.tertiary} />}
      </View>
      {usage ? (
        <>
          <Bar used={usage.files.used} quota={usage.files.quota} />
          <Text style={styles.muted}>
            {formatDriveBytes(usage.files.used)} z {formatDriveBytes(usage.files.quota)} · zostało {formatDriveBytes(Math.max(0, usage.files.quota - usage.files.used))}
          </Text>
          {open ? (
            <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
              <Text style={styles.muted}>Pakiet: {usage.plan.name}</Text>
              <Usage title="Pliki" used={usage.files.used} quota={usage.files.quota} />
              {usage.groups.map((group, index) => (
                <View key={group.key} style={styles.groupRow}>
                  <View style={[styles.swatch, { opacity: Math.max(0.2, 1 - index * 0.11) }]} />
                  <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>{group.label}</Text>
                  <Text style={styles.body}>{formatDriveBytes(group.bytes)}</Text>
                  <Text style={[styles.muted, { width: 44, textAlign: 'right' }]}>{formatDriveShare(group.bytes, Math.max(1, usage.files.used))}</Text>
                </View>
              ))}
              <Usage title="Baza danych" used={usage.database.used} quota={usage.database.quota} />
              <Text style={styles.muted}>Widzi tylko administrator. Pakiet zmienia się w CRM albo na Macu (Dysk → Miejsce na Dysku).</Text>
            </View>
          ) : null}
        </>
      ) : error ? <Text style={styles.muted}>{error}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary,
    borderWidth: 1, borderColor: colors.border.default,
  },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: {
    color: colors.text.primary, fontFamily: typography.fontFamilies.heading, fontSize: typography.fontSizes.sm, fontWeight: '400',
    textTransform: 'uppercase', letterSpacing: 0.35,
  },
  label: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  value: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.xs },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  track: { width: '100%', overflow: 'hidden', backgroundColor: colors.border.default },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.primary.gold },
});
