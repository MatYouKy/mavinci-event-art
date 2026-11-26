import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, borderRadius } from '../theme';
import { appTheme, syncAppTheme } from '../theme/appTheme';
import { CRM_THEMES, CRM_THEME_PALETTES, type CrmTheme } from '../theme/crmThemePalette';
import { supabase } from '../lib/supabase';
import { APP_VERSION } from '../lib/appVersion';
import MailboxPreferencesSection from '../components/MailboxPreferencesSection';
import FilesAppSection from '../components/FilesAppSection';
import TestModeSection from '../components/TestModeSection';
import { useTestMode } from '../lib/testMode';
import { roleLabel } from '../lib/roleLabels';

export default function SettingsScreen() {
  const { employee, signOut } = useAuth();
  const { testMode } = useTestMode();
  const [themeBusy, setThemeBusy] = useState<CrmTheme | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTheme = appTheme();

  const notify = (text: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 5000 : 3000);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Motyw jak w CRM (Ustawienia → Wygląd) i na Macu: zapis w profilu, potem aplikacja uruchamia się ponownie w nowych kolorach.
  const chooseTheme = async (next: CrmTheme) => {
    if (!employee?.id || next === currentTheme || themeBusy) return;
    // Tryb testowy: motyw dotyczy tego telefonu (administratora) — zmiana po wyjściu z trybu.
    if (testMode) { notify('Tryb testowy: motyw zmienisz po wyjściu z trybu.', true); return; }
    setThemeBusy(next);
    const { error } = await supabase.from('employees').update({ crm_theme: next }).eq('id', employee.id);
    if (error) {
      setThemeBusy(null);
      Alert.alert('Motyw', error.code === '42703' || error.code === 'PGRST204'
        ? 'Motywy wymagają aktualizacji bazy danych (migracja crm_theme).'
        : 'Nie udało się zapisać motywu. Spróbuj ponownie.');
      return;
    }
    await syncAppTheme(next);
    // Aplikacja nie uruchomiła się ponownie (np. tryb deweloperski) — motyw jest zapisany w profilu.
    setThemeBusy(null);
    Alert.alert('Motyw', 'Motyw zapisany — włączy się po ponownym uruchomieniu aplikacji.');
  };

  const handleSignOut = () => {
    Alert.alert(
      'Wylogowanie',
      'Czy na pewno chcesz się wylogować?',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyloguj',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch (error) {
              Alert.alert('Błąd', 'Nie udało się wylogować');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.container}>
        {/* User Info */}
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Feather name="user" color={colors.primary.gold} size={32} />
          </View>
          <Text style={styles.userName}>
            {employee?.nickname || `${employee?.name} ${employee?.surname}`}
          </Text>
          <Text style={styles.userEmail}>{employee?.email}</Text>
          {employee?.role && (
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{roleLabel(employee.role)}</Text>
            </View>
          )}
        </View>

        {/* Tryb testowy „widok jako” — administrator (i w trakcie trybu: wyjście) */}
        <TestModeSection onNotify={notify} />

        {/* Settings Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ustawienia</Text>

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuIcon}>
              <Feather name="user" color={colors.text.secondary} size={20} />
            </View>
            <Text style={styles.menuText}>Profil</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuIcon}>
              <Feather name="bell" color={colors.text.secondary} size={20} />
            </View>
            <Text style={styles.menuText}>Powiadomienia</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuIcon}>
              <Feather name="lock" color={colors.text.secondary} size={20} />
            </View>
            <Text style={styles.menuText}>Bezpieczeństwo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuIcon}>
              <Feather name="info" color={colors.text.secondary} size={20} />
            </View>
            <Text style={styles.menuText}>O aplikacji</Text>
          </TouchableOpacity>
        </View>

        {/* Wygląd — ten sam motyw w CRM, na Macu i w telefonie */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wygląd</Text>
          <View style={styles.themeGrid}>
            {CRM_THEMES.map((option) => {
              const palette = CRM_THEME_PALETTES[option.id];
              const active = currentTheme === option.id;
              return (
                <TouchableOpacity key={option.id} onPress={() => void chooseTheme(option.id)} disabled={Boolean(themeBusy)}
                  style={[styles.themeOption, active && styles.themeOptionActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <View style={[styles.themePreview, { backgroundColor: palette.page }]}>
                    <View style={[styles.themeCard, { backgroundColor: palette.surface }]}>
                      <View style={[styles.themeLine, { backgroundColor: palette.text, width: '70%' }]} />
                      <View style={[styles.themeLine, { backgroundColor: `${palette.text}55` }]} />
                      <View style={[styles.themeButton, { backgroundColor: palette.accent }]} />
                    </View>
                  </View>
                  <View style={styles.themeLabelRow}>
                    <View style={styles.themeLabels}>
                      <Text style={[styles.menuText, active && { color: colors.primary.gold }]}>{option.label}</Text>
                      <Text style={styles.themeDescription} numberOfLines={2}>{option.description}</Text>
                    </View>
                    {active ? <Feather name="check-circle" size={18} color={colors.primary.gold} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.themeHint}>Ustawienie dotyczy tylko Ciebie i obowiązuje także w CRM w przeglądarce i w aplikacji na Macu.</Text>
        </View>

        <MailboxPreferencesSection />

        {/* Tryb testowy: „Mavinci” w Plikach należy do sesji administratora; wyjście z trybu — sekcja „Tryb testowy” i pasek. */}
        {testMode ? null : <FilesAppSection onNotify={notify} />}

        {/* Sign Out */}
        {testMode ? null : (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={handleSignOut}
            >
              <Feather name="log-out" color={colors.status.error} size={20} />
              <Text style={styles.signOutText}>Wyloguj się</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Version */}
        <View style={styles.footer}>
          <Text style={styles.version}>Mavinci CRM Mobile v{APP_VERSION}</Text>
        </View>

        <Modal visible={Boolean(themeBusy)} transparent animationType="fade">
          <View style={styles.busy}>
            <View style={styles.busyBox}>
              <ActivityIndicator size="large" color={colors.primary.gold} />
              <Text style={styles.menuText}>Zmieniam motyw…</Text>
            </View>
          </View>
        </Modal>
      </ScrollView>
      {toast ? (
        <View pointerEvents="none" style={[styles.toast, toast.error && styles.toastError]}>
          <Feather name={toast.error ? 'alert-circle' : 'check-circle'} size={18} color={toast.error ? colors.status.error : colors.primary.gold} />
          <Text style={[styles.menuText, { flex: 1 }]}>{toast.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  userSection: {
    alignItems: 'center',
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.secondary,
    borderWidth: 2,
    borderColor: colors.primary.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  userName: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  userEmail: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
  },
  roleBadge: {
    backgroundColor: colors.primary.gold + '20',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  roleText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    color: colors.primary.gold,
    textTransform: 'uppercase',
  },
  section: {
    padding: spacing.md,
  },
  sectionTitle: {
    fontFamily: 'MBFAtom',
    fontSize: typography.fontSizes.sm,
    fontWeight: '400',
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  menuText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.medium,
    color: colors.text.primary,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.secondary,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.status.error + '40',
    gap: spacing.sm,
  },
  signOutText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.status.error,
  },
  footer: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  version: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  themeOption: {
    flexBasis: '47%', flexGrow: 1, padding: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: colors.border.default, backgroundColor: colors.background.secondary, gap: spacing.sm,
  },
  themeOptionActive: { borderColor: colors.primary.gold },
  themePreview: { height: 64, borderRadius: borderRadius.sm, padding: spacing.sm, justifyContent: 'center' },
  themeCard: { borderRadius: borderRadius.sm, padding: 6, gap: 4 },
  themeLine: { height: 5, borderRadius: 3 },
  themeButton: { height: 8, width: '35%', borderRadius: 3, marginTop: 2 },
  themeLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  themeLabels: { flex: 1 },
  themeDescription: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  themeHint: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary, marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  busy: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  busyBox: { alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated },
  toast: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: colors.primary.gold + '50',
  },
  toastError: { borderColor: colors.status.error + '70' },
});
