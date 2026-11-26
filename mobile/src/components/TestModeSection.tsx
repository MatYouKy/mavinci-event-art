import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { isAdmin } from '../lib/permissions';
import { TEST_MODE_CRM_URL, useTestMode } from '../lib/testMode';
import {
  TEST_MODE_DEPARTMENTS,
  enterTestMode,
  exitTestMode,
  loadTestModeHistory,
  loadTestModeTargets,
  testModeDepartment,
  testModeEndText,
  type TestModeHistoryRow,
  type TestModeTarget,
} from '../lib/testModeApi';
import EmployeeAvatar from './EmployeeAvatar';
import { borderRadius, colors, spacing, typography } from '../theme';

/*
 * Ustawienia → „Tryb testowy” (tylko administrator, `docs/test-mode.md`): wybór pracownika i wejście w jego widok (dane, menu,
 * uprawnienia), dziennik wejść; w trakcie trybu — kogo oglądamy i „Wyjdź z trybu”. Jak zakładka „Tryb testowy” w CRM
 * i Ustawieniach na Macu. Sprzedawców zewnętrznych (portal) sprawdza się w CRM w przeglądarce.
 */

const folded = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
const displayName = (target: TestModeTarget) => target.name || target.nickname || 'Pracownik';
const permissionsText = (count: number) => {
  if (count === 1) return '1 uprawnienie';
  const few = [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100);
  return few ? `${count} uprawnienia` : `${count} uprawnień`;
};
const details = (target: TestModeTarget) => [
  target.access_level || null,
  typeof target.permissions === 'number' ? permissionsText(target.permissions) : null,
  target.occupation || null,
].filter(Boolean).join(' · ');
const when = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export default function TestModeSection({ onNotify }: { onNotify: (text: string, error?: boolean) => void }) {
  const { employee } = useAuth();
  const { testMode, switching } = useTestMode();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<TestModeTarget[]>([]);
  const [sellers, setSellers] = useState(0);
  const [history, setHistory] = useState<TestModeHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, log] = await Promise.all([loadTestModeTargets(), loadTestModeHistory()]);
      setTargets(list.employees);
      setSellers(list.sellers);
      setHistory(log);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Nie udało się wczytać listy.');
    } finally {
      setLoading(false);
    }
  }, []);

  const groups = useMemo(() => {
    const words = folded(query).split(/\s+/).filter(Boolean);
    const visible = targets.filter((target) => {
      const haystack = folded([target.name, target.nickname, target.occupation, target.access_level].filter(Boolean).join(' '));
      return words.every((word) => haystack.includes(word));
    });
    return TEST_MODE_DEPARTMENTS.map((department) => ({
      ...department,
      people: visible.filter((target) => testModeDepartment(target.department) === department.value)
        .sort((a, b) => displayName(a).localeCompare(displayName(b), 'pl')),
    })).filter((group) => group.people.length > 0);
  }, [targets, query]);

  if (!testMode && !isAdmin(employee)) return null;

  const openPicker = () => {
    setOpen(true);
    void load();
  };

  const enter = async (target: TestModeTarget) => {
    if (busy) return;
    setBusy(target.id);
    try {
      const label = await enterTestMode(target.id);
      // Najpierw okno postępu, potem arkusz (iOS nie zamyka arkusza, nad którym jest jeszcze inne okno).
      setBusy(null);
      setOpen(false);
      onNotify(`Tryb testowy: widok ${label || displayName(target)}. Zmiany nie są zapisywane.`);
    } catch (failure) {
      setBusy(null);
      onNotify(failure instanceof Error ? failure.message : 'Nie udało się włączyć trybu testowego.', true);
    }
  };

  const exit = async () => {
    if (busy) return;
    setBusy('exit');
    try {
      await exitTestMode();
      onNotify('Zakończono tryb testowy — wróciłeś do swojego widoku.');
    } catch {
      onNotify('Nie udało się zakończyć trybu testowego. Spróbuj ponownie.', true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Tryb testowy</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.icon}>
            <Feather name="eye" color={testMode ? '#fcd34d' : colors.text.secondary} size={20} />
          </View>
          <View style={styles.texts}>
            <Text style={styles.title}>{testMode ? `Widok: ${testMode.label || 'pracownik'}` : 'Widok jako pracownik'}</Text>
            <Text style={styles.detail}>
              {testMode
                ? `Zmiany nie są zapisywane. Koniec najpóźniej ${when(new Date(testMode.expiresAt).toISOString())}.`
                : 'Sprawdź, co widzi wybrany pracownik i jakie ma funkcje — czy uprawnienia nie są za duże albo za małe.'}
            </Text>
          </View>
        </View>
        {testMode ? (
          <TouchableOpacity style={styles.primary} onPress={() => void exit()} disabled={Boolean(busy) || switching}>
            <Feather name="log-out" size={16} color={colors.background.primary} />
            <Text style={styles.primaryText}>Wyjdź z trybu</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primary} onPress={openPicker} disabled={Boolean(busy)}>
            <Feather name="users" size={16} color={colors.background.primary} />
            <Text style={styles.primaryText}>Wybierz pracownika</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.hint}>
        Zapis do bazy w trybie testowym jest sprawdzany i od razu wycofywany — ta osoba niczego nie zobaczy, a po wyjściu z trybu
        nic nie zostaje. Pliki, wysyłka wiadomości i operacje serwera są wyłączone. Tryb kończy się sam po 8 godzinach.
      </Text>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Tryb testowy</Text>
            <TouchableOpacity onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Zamknij">
              <Feather name="x" size={22} color={colors.text.primary} />
            </TouchableOpacity>
          </View>
          <View style={styles.search}>
            <Feather name="search" size={16} color={colors.text.tertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Szukaj pracownika"
              placeholderTextColor={colors.text.tertiary}
              style={styles.searchInput}
              autoCorrect={false}
            />
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {loading ? <ActivityIndicator color={colors.primary.gold} style={{ marginVertical: spacing.xl }} /> : null}
            {error ? (
              <View style={styles.card}>
                <Text style={styles.error}>{error}</Text>
                <TouchableOpacity style={styles.secondary} onPress={() => void load()}>
                  <Text style={styles.secondaryText}>Spróbuj ponownie</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {!loading && !error && groups.length === 0 ? (
              <Text style={styles.detail}>
                {targets.length ? 'Nikt nie pasuje do wyszukiwania.' : 'Brak pracowników do obejrzenia (bez administratorów i bez Ciebie).'}
              </Text>
            ) : null}
            {groups.map((group) => (
              <View key={group.value} style={styles.group}>
                <Text style={styles.sectionTitle}>{group.label}</Text>
                {group.people.map((target) => (
                  <View key={target.id} style={styles.person}>
                    <EmployeeAvatar avatarUrl={target.avatar_url} employeeName={displayName(target)} size={36} />
                    <View style={styles.texts}>
                      <Text style={styles.title} numberOfLines={1}>{displayName(target)}</Text>
                      {details(target) ? <Text style={styles.detail} numberOfLines={1}>{details(target)}</Text> : null}
                    </View>
                    <TouchableOpacity style={styles.enter} onPress={() => void enter(target)} disabled={Boolean(busy)}>
                      {busy === target.id ? <ActivityIndicator size="small" color={colors.primary.gold} /> : <Feather name="log-in" size={14} color={colors.primary.gold} />}
                      <Text style={styles.secondaryText}>Wejdź jako</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ))}
            {!loading && !error ? (
              <View style={styles.group}>
                <Text style={styles.sectionTitle}>Sprzedawcy zewnętrzni</Text>
                <View style={styles.card}>
                  <Text style={styles.detail}>
                    {sellers ? `Widok portalu sprzedawcy (${sellers}) sprawdzisz w CRM w przeglądarce.` : 'Widok portalu sprzedawcy sprawdzisz w CRM w przeglądarce.'}
                  </Text>
                  <TouchableOpacity style={styles.secondary} onPress={() => void Linking.openURL(`${TEST_MODE_CRM_URL}/crm/settings?tab=test`).catch(() => undefined)}>
                    <Feather name="external-link" size={14} color={colors.primary.gold} />
                    <Text style={styles.secondaryText}>Otwórz w przeglądarce</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {history.length ? (
              <View style={styles.group}>
                <Text style={styles.sectionTitle}>Dziennik wejść</Text>
                {history.map((row) => (
                  <View key={row.id} style={styles.historyRow}>
                    <Text style={styles.title} numberOfLines={1}>{`${row.admin || 'Administrator'} → ${row.target}`}</Text>
                    <Text style={[styles.detail, row.active && { color: '#fcd34d' }]}>{`${when(row.started_at)} · ${testModeEndText(row)}`}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
        <Modal visible={busy !== null && busy !== 'exit'} transparent animationType="fade">
          <View style={styles.busy}>
            <View style={styles.busyBox}>
              <ActivityIndicator size="large" color={colors.primary.gold} />
              <Text style={styles.title}>Otwieram widok pracownika…</Text>
            </View>
          </View>
        </Modal>
      </Modal>

      <Modal visible={busy === 'exit'} transparent animationType="fade">
        <View style={styles.busy}>
          <View style={styles.busyBox}>
            <ActivityIndicator size="large" color={colors.primary.gold} />
            <Text style={styles.title}>Wychodzę z trybu testowego…</Text>
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
  error: { fontSize: typography.fontSizes.sm, color: colors.status.error },
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
  sheet: { flex: 1, backgroundColor: colors.background.primary },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg, paddingBottom: spacing.md,
  },
  sheetTitle: { fontFamily: 'MBFAtom', fontSize: typography.fontSizes.lg, fontWeight: '400', color: colors.text.primary, textTransform: 'uppercase' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  searchInput: { flex: 1, paddingVertical: spacing.sm + 2, color: colors.text.primary, fontSize: typography.fontSizes.md },
  sheetBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl * 2 },
  group: { marginTop: spacing.lg },
  person: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.sm,
    borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.background.secondary,
  },
  enter: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.primary.gold + '50',
  },
  historyRow: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: 2 },
  busy: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  busyBox: { alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated },
});
