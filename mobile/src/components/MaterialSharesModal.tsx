import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../theme';
import {
  MATERIAL_SHARE_ACCESS_LABELS, MATERIAL_SHARE_DAYS, MATERIAL_SHARE_STATUS_LABELS, materialShareDateLabel, materialShareDaysLabel, materialShareMessage,
  materialShareSummary,
} from '../lib/materialsShared';
import {
  deleteMaterialShare, materialShares, materialsErrorMessage, updateMaterialShare, type MaterialShare, type MaterialShareChange,
} from '../lib/materialsApi';
import MaterialShareModal, { type MaterialShareModalMode } from './MaterialShareModal';

/*
 * „Linki” w Materiałach na telefonie (jak CRM `MaterialSharesPanel` i Mac `MaterialSharesSheet`): linki do pobrania marki —
 * aktywne i nieaktywne, zawartość, dostęp, ważność, otwarcia i pobrania. Dotknięcie — czynności: udostępnij, kopiuj, otwórz,
 * przedłuż, zmień, nowe hasło, wyłącz, usuń.
 */

const KIND_NAMES = { folder: 'Folder', album: 'Album', file: 'Plik' } as const;

export default function MaterialSharesModal({ visible, companyId, companyName, onClose }: {
  visible: boolean; companyId: string; companyName: string; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [shares, setShares] = useState<MaterialShare[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<MaterialShare | null>(null);
  const [extend, setExtend] = useState<MaterialShare | null>(null);
  const [dialog, setDialog] = useState<MaterialShareModalMode | null>(null);
  /** Komunikaty w oknie listy (komunikaty ekranu Materiałów są pod oknem). */
  const [flash, setFlash] = useState<{ text: string; error: boolean } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (text: string, isError = false) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ text, error: isError });
    flashTimer.current = setTimeout(() => setFlash(null), isError ? 5000 : 2500);
  };
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      const data = await materialShares(companyId);
      setShares(data.shares);
      setError('');
    } catch (cause) {
      setError(materialsErrorMessage(cause, 'Nie udało się pobrać linków.'));
    }
  }, [companyId]);

  useEffect(() => { if (visible) void load(); }, [visible, load]);

  const replace = (share: MaterialShare) => setShares((current) => current?.map((item) => (item.id === share.id ? share : item)) || current);

  const change = async (label: string, input: MaterialShareChange, success: string) => {
    setBusy(label);
    try {
      const result = await updateMaterialShare(input);
      replace(result.share);
      say(success);
      return result;
    } catch (cause) {
      say(materialsErrorMessage(cause, 'Nie udało się zapisać zmian linku.'), true);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const copy = async (value: string, done: string) => {
    await Clipboard.setStringAsync(value);
    say(done);
  };

  const message = (share: MaterialShare) => materialShareMessage({ ...share, password: null, companyName });

  const remove = (share: MaterialShare) => {
    Alert.alert('Usunąć link?', `Adres „${share.title}” przestanie działać od razu. Pliki zostaną w Materiałach.`, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń link', style: 'destructive', onPress: () => void (async () => {
          setBusy('Usuwam link');
          try {
            await deleteMaterialShare(share.id);
            setShares((current) => current?.filter((item) => item.id !== share.id) || current);
            say('Usunięto link — pliki zostały w Materiałach.');
          } catch (cause) {
            say(materialsErrorMessage(cause, 'Nie udało się usunąć linku.'), true);
          } finally {
            setBusy(null);
          }
        })(),
      },
    ]);
  };

  const newPassword = (share: MaterialShare) => {
    Alert.alert('Ustawić nowe hasło?', 'Wygenerujemy nowe hasło i pokażemy je raz. Dotychczasowe hasło przestanie działać.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Nowe hasło', onPress: () => void (async () => {
          const result = await change('Ustawiam nowe hasło', { id: share.id, newPassword: true }, 'Ustawiono nowe hasło.');
          if (result?.password) setDialog({ mode: 'result', created: result });
        })(),
      },
    ]);
  };

  const active = (shares || []).filter((share) => share.status === 'active');
  const inactive = (shares || []).filter((share) => share.status !== 'active');

  const row = (share: MaterialShare) => (
    <TouchableOpacity key={share.id} style={styles.card} onPress={() => setMenu(share)}>
      <View style={styles.rowBetween}>
        <Text style={[styles.body, { flex: 1, fontWeight: typography.fontWeights.semibold }]} numberOfLines={1}>{share.title}</Text>
        <Text style={[styles.badge, share.status === 'active' ? styles.badgeActive : null]}>{MATERIAL_SHARE_STATUS_LABELS[share.status]}</Text>
      </View>
      <Text style={styles.muted} numberOfLines={2}>
        {share.items.map((item) => `${KIND_NAMES[item.kind]} „${item.name}”${item.missing ? ' (usunięty)' : ''}`).join(', ')} · {materialShareSummary(share.fileCount, share.totalBytes)}
      </Text>
      <Text style={styles.muted}>
        {MATERIAL_SHARE_ACCESS_LABELS[share.access]}{share.access === 'password' ? `: ${share.emails.join(', ')}` : ''} · {share.status === 'revoked'
          ? `wyłączony ${materialShareDateLabel(share.revokedAt)}` : `${share.status === 'expired' ? 'wygasł' : 'ważny do'} ${materialShareDateLabel(share.expiresAt)}`}
      </Text>
      <Text style={styles.muted}>Otwarcia: {share.viewCount} · pobrania: {share.downloadCount}{share.openedBy.length ? ` · otworzyli: ${share.openedBy.join(', ')}` : ''}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Linki do pobrania</Text>
            <Text style={styles.muted}>{companyName} · udostępnij folder, album albo plik — przytrzymaj go i wybierz „Udostępnij link”.</Text>
          </View>
          <TouchableOpacity onPress={() => void load()} style={styles.icon} accessibilityLabel="Odśwież"><Feather name="refresh-cw" size={20} color={colors.primary.gold} /></TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.icon} accessibilityLabel="Zamknij"><Feather name="x" size={24} color={colors.text.primary} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
          {error && !shares ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={styles.error}>{error}</Text>
              <TouchableOpacity style={styles.secondary} onPress={() => void load()}><Text style={styles.secondaryText}>Spróbuj ponownie</Text></TouchableOpacity>
            </View>
          ) : !shares ? (
            <ActivityIndicator color={colors.primary.gold} style={{ marginTop: spacing.lg }} />
          ) : !shares.length ? (
            <Text style={styles.muted}>Ta marka nie ma jeszcze linków do pobrania.</Text>
          ) : (
            <>
              <Text style={styles.section}>Aktywne ({active.length})</Text>
              {active.length ? active.map(row) : <Text style={styles.muted}>Brak aktywnych linków.</Text>}
              {inactive.length > 0 && <Text style={styles.section}>Nieaktywne — wygasłe i wyłączone ({inactive.length})</Text>}
              {inactive.map(row)}
            </>
          )}
        </ScrollView>
        {flash && (
          <View pointerEvents="none" style={[styles.flash, { bottom: insets.bottom + spacing.lg }, flash.error && { borderColor: colors.status.error }]}>
            <Feather name={flash.error ? 'alert-circle' : 'check-circle'} size={18} color={flash.error ? colors.status.error : colors.primary.gold} />
            <Text style={[styles.body, { flex: 1 }]}>{flash.text}</Text>
          </View>
        )}

        {/* Czynności linku */}
        <Modal visible={menu !== null} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setMenu(null)}>
            <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
              <Text style={styles.title} numberOfLines={2}>{menu?.title}</Text>
              {menu && (
                <>
                  <SheetButton icon="share" label="Udostępnij wiadomość z linkiem…" onPress={() => { const share = menu; setMenu(null); void Share.share({ message: message(share), title: share.title }); }} />
                  <SheetButton icon="copy" label="Kopiuj link" onPress={() => { const share = menu; setMenu(null); void copy(share.url, 'Skopiowano link.'); }} />
                  <SheetButton icon="external-link" label="Otwórz stronę linku" onPress={() => { const share = menu; setMenu(null); void Linking.openURL(share.url); }} />
                  <SheetButton icon="clock" label={menu.status === 'active' ? 'Przedłuż…' : 'Włącz ponownie…'} onPress={() => { const share = menu; setMenu(null); setExtend(share); }} />
                  <SheetButton icon="edit-2" label="Zmień tytuł, wiadomość, dostęp" onPress={() => { const share = menu; setMenu(null); setDialog({ mode: 'edit', share }); }} />
                  {menu.access === 'password' && (
                    <SheetButton icon="key" label="Nowe hasło…" onPress={() => { const share = menu; setMenu(null); newPassword(share); }} />
                  )}
                  {menu.status === 'active' && (
                    <SheetButton icon="power" label="Wyłącz link" onPress={() => {
                      const share = menu;
                      setMenu(null);
                      void change('Wyłączam link', { id: share.id, revoked: true }, 'Link wyłączony — adres przestał działać.');
                    }} />
                  )}
                  <SheetButton icon="trash-2" label="Usuń link" danger onPress={() => { const share = menu; setMenu(null); remove(share); }} />
                </>
              )}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Przedłużenie: ważny od teraz przez… */}
        <Modal visible={extend !== null} transparent animationType="fade" onRequestClose={() => setExtend(null)}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setExtend(null)}>
            <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
              <Text style={styles.title}>Ważny od teraz przez</Text>
              {MATERIAL_SHARE_DAYS.map((days) => (
                <SheetButton key={days} icon="clock" label={materialShareDaysLabel(days)} onPress={() => {
                  const share = extend;
                  setExtend(null);
                  if (!share) return;
                  void change('Zapisuję ważność linku', { id: share.id, days, ...(share.revokedAt ? { revoked: false } : {}) },
                    share.status === 'active' ? `Link ważny jeszcze ${materialShareDaysLabel(days)}.` : `Link znów działa — ${materialShareDaysLabel(days)}.`);
                }} />
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        <MaterialShareModal request={dialog} companyId={companyId} companyName={companyName} notify={say}
          onClose={() => setDialog(null)} onSaved={replace} />

        <Modal visible={busy !== null} transparent animationType="fade">
          <View style={styles.busyBackdrop}>
            <View style={styles.busy}>
              <ActivityIndicator color={colors.primary.gold} size="large" />
              <Text style={styles.body}>{busy}…</Text>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

function SheetButton({ icon, label, onPress, danger }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity style={styles.sheetButton} onPress={onPress}>
      <Feather name={icon} size={18} color={danger ? colors.status.error : colors.primary.gold} />
      <Text style={[styles.body, danger && { color: colors.status.error }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  section: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, marginTop: spacing.sm },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  error: { color: colors.status.error, fontSize: typography.fontSizes.sm },
  icon: { padding: spacing.sm },
  card: { gap: 4, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { color: colors.text.tertiary, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(229,228,226,0.08)' },
  badgeActive: { color: '#6ee7b7', backgroundColor: 'rgba(16,185,129,0.15)' },
  secondary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background.elevated, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
  sheetButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  flash: {
    position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: colors.border.hover,
  },
  busyBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  busy: { width: '100%', maxWidth: 320, alignItems: 'center', gap: spacing.sm, backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg },
});
