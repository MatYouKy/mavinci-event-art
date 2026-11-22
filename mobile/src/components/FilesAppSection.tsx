import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { filesProviderState, filesProviderSupported, repairFilesProvider, type FilesProviderState } from '../lib/filesProvider';
import { borderRadius, colors, spacing, typography } from '../theme';

/*
 * Ustawienia → „Aplikacja Pliki” (iPhone, iPad): czy „Mavinci” jest w aplikacji Pliki (Przeglądaj → Lokalizacje) i
 * „Dodaj ponownie” (nowa sesja rozszerzenia). Rejestracja jest automatyczna po zalogowaniu (`src/lib/filesProvider.ts`);
 * sekcja tylko w wersji aplikacji z rozszerzeniem.
 */

export default function FilesAppSection({ onNotify }: { onNotify: (text: string, error?: boolean) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<FilesProviderState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setState(await filesProviderState(userId));
  }, [userId]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void refresh(); });
    return () => subscription.remove();
  }, [refresh]);

  if (!filesProviderSupported) return null;

  const repair = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      await repairFilesProvider(data.session);
      await refresh();
      onNotify('Mavinci jest w aplikacji Pliki.');
    } catch (error) {
      await refresh();
      onNotify(error instanceof Error && error.message ? error.message : 'Nie udało się dodać Mavinci do aplikacji Pliki.', true);
    } finally {
      setBusy(false);
    }
  };

  const enabled = Boolean(state?.enabled);
  const available = state?.available !== false;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Aplikacja Pliki</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.icon}>
            <Feather name="folder" color={enabled ? colors.primary.gold : colors.text.secondary} size={20} />
          </View>
          <View style={styles.texts}>
            <Text style={styles.title}>Mavinci w aplikacji Pliki</Text>
            <Text style={styles.detail}>
              {!state ? 'Sprawdzam…'
                : !available ? 'Wymaga iOS 16 lub nowszego.'
                  : enabled ? 'Włączone — Pliki → Przeglądaj → Lokalizacje → Mavinci.'
                    : 'Jeszcze nie dodano.'}
            </Text>
          </View>
          {enabled ? <Feather name="check-circle" size={18} color={colors.primary.gold} /> : null}
        </View>
        {available && state ? (
          <TouchableOpacity style={enabled ? styles.secondary : styles.primary} onPress={() => void repair()} disabled={busy}>
            <Feather name="refresh-cw" size={16} color={enabled ? colors.primary.gold : colors.background.primary} />
            <Text style={enabled ? styles.secondaryText : styles.primaryText}>{enabled ? 'Dodaj ponownie' : 'Dodaj do Plików'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.hint}>
        Eventy, Materiały i Dysk z tymi samymi uprawnieniami co w CRM — pliki otworzysz, udostępnisz i dodasz z dowolnej aplikacji.
        Nie widzisz Mavinci w Plikach? Na karcie Przeglądaj dotknij ⋯ → Edytuj (na iPadzie: Edytuj na pasku bocznym) i włącz Mavinci.
      </Text>

      <Modal visible={busy} transparent animationType="fade">
        <View style={styles.busy}>
          <View style={styles.busyBox}>
            <ActivityIndicator size="large" color={colors.primary.gold} />
            <Text style={styles.title}>Dodaję Mavinci do aplikacji Pliki…</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: spacing.md },
  sectionTitle: {
    fontFamily: 'MBFAtom', fontSize: typography.fontSizes.sm, fontWeight: '400', color: colors.text.tertiary,
    textTransform: 'uppercase', marginBottom: spacing.md, paddingHorizontal: spacing.sm,
  },
  card: {
    backgroundColor: colors.background.secondary, padding: spacing.lg, borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: colors.border.default, gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 40, height: 40, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.medium, color: colors.text.primary },
  detail: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.md, backgroundColor: colors.primary.gold,
  },
  primaryText: { color: colors.background.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.primary.gold + '50',
  },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  hint: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary, marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  busy: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  busyBox: { alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated },
});
