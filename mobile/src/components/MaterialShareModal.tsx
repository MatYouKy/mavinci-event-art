import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../theme';
import {
  MATERIAL_SHARE_ACCESS_LABELS, MATERIAL_SHARE_DAYS, MATERIAL_SHARE_DEFAULT_DAYS, MATERIAL_SHARE_LIMITS, materialCountLabel, materialShareDateLabel,
  materialShareDaysLabel, materialShareEmails, materialShareExpiry, materialShareMessage, type MaterialShareAccess,
} from '../lib/materialsShared';
import {
  createMaterialShare, materialsErrorMessage, updateMaterialShare, type MaterialShare, type MaterialShareCreated, type MaterialShareTarget,
} from '../lib/materialsApi';

/*
 * „Udostępnij link” w Materiałach na telefonie (jak CRM `MaterialShareDialog` i Mac `MaterialShareSheet`): link do pobrania
 * folderu (z podfolderami, „na żywo”), albumu albo pliku przez osobę spoza firmy — tytuł i wiadomość na stronie, ważność,
 * dostęp dla każdego albo po e-mailu i haśle (puste pole — hasło generuje serwer). Po zapisie: link, hasło (tylko teraz),
 * gotowa wiadomość — „Udostępnij…” (SMS, WhatsApp, poczta) albo kopia. Tryb `edit` — tytuł, wiadomość i dostęp istniejącego linku.
 */

export type MaterialShareModalMode =
  | { mode: 'create'; items: MaterialShareTarget[]; title: string }
  | { mode: 'edit'; share: MaterialShare }
  | { mode: 'result'; created: MaterialShareCreated };

const KIND_NAMES = { folder: 'Folder', album: 'Album', file: 'Plik' } as const;

function targetsSummary(items: MaterialShareTarget[]) {
  if (items.length === 1) {
    const [item] = items;
    if (item.kind === 'folder') return `Folder „${item.name}” z podfolderami — pliki dodane później też będą do pobrania.`;
    if (item.kind === 'album') return `Album „${item.name}” — zdjęcia dodane później do albumu też będą do pobrania.`;
    return `Plik „${item.name}”.`;
  }
  const files = items.filter((item) => item.kind === 'file').length;
  const folders = items.filter((item) => item.kind === 'folder').length;
  return [files ? materialCountLabel(files, 'file') : null, folders ? materialCountLabel(folders, 'folder') : null].filter(Boolean).join(' · ');
}

export default function MaterialShareModal({ request, companyId, companyName, onClose, onSaved, notify }: {
  request: MaterialShareModalMode | null;
  companyId: string;
  companyName: string;
  onClose: () => void;
  onSaved?: (share: MaterialShare) => void;
  notify: (text: string, isError?: boolean) => void;
}) {
  const editing = request?.mode === 'edit' ? request.share : null;
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [days, setDays] = useState<number>(MATERIAL_SHARE_DEFAULT_DAYS);
  const [access, setAccess] = useState<MaterialShareAccess>('public');
  const [emails, setEmails] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MaterialShareCreated | null>(null);
  const [text, setText] = useState('');
  /** Krótki komunikat w oknie (komunikaty ekranu są pod oknem). */
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = (value: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(value);
    flashTimer.current = setTimeout(() => setFlash(''), 2500);
  };
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  useEffect(() => {
    setError('');
    setBusy(false);
    setPassword('');
    setDays(MATERIAL_SHARE_DEFAULT_DAYS);
    if (request?.mode === 'create') {
      setTitle(request.title); setMessage(''); setAccess('public'); setEmails(''); setResult(null); setText('');
    } else if (request?.mode === 'edit') {
      setTitle(request.share.title); setMessage(request.share.message); setAccess(request.share.access); setEmails(request.share.emails.join(', '));
      setResult(null); setText('');
    } else if (request?.mode === 'result') {
      setResult(request.created);
      setText(materialShareMessage({ ...request.created.share, password: request.created.password, companyName }));
    }
  }, [request, companyName]);

  const parsed = useMemo(() => materialShareEmails(emails), [emails]);
  const needsPassword = access === 'password' && (!editing || editing.access !== 'password');

  const save = async () => {
    if (busy || !request || request.mode === 'result') return;
    setError('');
    const typed = password.trim();
    if (access === 'password') {
      if (parsed.invalid.length) { setError(`Niepoprawny adres e-mail: ${parsed.invalid.slice(0, 3).join(', ')}.`); return; }
      if (!parsed.emails.length) { setError('Podaj adres e-mail osoby, która otworzy link.'); return; }
      if (parsed.emails.length > MATERIAL_SHARE_LIMITS.emails) { setError(`Najwyżej ${MATERIAL_SHARE_LIMITS.emails} adresów e-mail.`); return; }
      if (typed && (typed.length < MATERIAL_SHARE_LIMITS.passwordMin || typed.length > MATERIAL_SHARE_LIMITS.passwordMax)) {
        setError(`Hasło: od ${MATERIAL_SHARE_LIMITS.passwordMin} do ${MATERIAL_SHARE_LIMITS.passwordMax} znaków albo puste pole (wygenerujemy hasło).`);
        return;
      }
    }
    setBusy(true);
    try {
      const saved = request.mode === 'create'
        ? await createMaterialShare({
          companyId, items: request.items.map(({ kind, id }) => ({ kind, id })), title: title.trim(), message, days, access,
          emails: access === 'password' ? parsed.emails : [], password: typed,
        })
        : await updateMaterialShare({
          id: request.share.id, title: title.trim(), message, access,
          ...(access === 'password' ? { emails: parsed.emails } : {}),
          ...(needsPassword || typed ? { newPassword: true, password: typed } : {}),
        });
      onSaved?.(saved.share);
      if (request.mode === 'edit' && !saved.password) {
        notify('Zapisano zmiany linku.');
        onClose();
        return;
      }
      setResult(saved);
      setText(materialShareMessage({ ...saved.share, password: saved.password, companyName }));
      showFlash(request.mode === 'create' ? 'Link do pobrania jest gotowy.' : 'Ustawiono nowe hasło.');
    } catch (cause) {
      setError(materialsErrorMessage(cause, 'Nie udało się zapisać linku.'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, done: string) => {
    await Clipboard.setStringAsync(value);
    showFlash(done);
  };

  const share = result?.share;
  return (
    <Modal visible={request !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.title}>{share ? 'Link do pobrania jest gotowy' : editing ? 'Zmień link do pobrania' : 'Udostępnij link do pobrania'}</Text>
          <ScrollView contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            {share ? (
              <>
                <Text style={styles.muted}>Ważny do {materialShareDateLabel(share.expiresAt)}</Text>
                <Text selectable style={styles.link}>{share.url}</Text>
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => void copy(share.url, 'Skopiowano link.')}>
                    <Feather name="copy" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>Kopiuj link</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => void Linking.openURL(share.url)}>
                    <Feather name="external-link" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>Otwórz</Text>
                  </TouchableOpacity>
                </View>
                {share.access === 'password' && (
                  <View style={styles.box}>
                    <Text style={styles.body}>Otworzy: {share.emails.join(', ')}</Text>
                    {result?.password ? (
                      <TouchableOpacity onPress={() => void copy(result.password!, 'Skopiowano hasło.')} style={styles.row}>
                        <Text style={styles.muted}>Hasło:</Text>
                        <Text selectable style={styles.password}>{result.password}</Text>
                        <Feather name="copy" size={16} color={colors.primary.gold} />
                      </TouchableOpacity>
                    ) : null}
                    <Text style={styles.muted}>Hasła nie da się później odczytać — w „Linki” możesz ustawić nowe.</Text>
                  </View>
                )}
                <Text style={styles.label}>Wiadomość dla odbiorcy</Text>
                <TextInput style={[styles.input, { minHeight: 160, textAlignVertical: 'top' }]} multiline value={text} onChangeText={setText} />
              </>
            ) : request && request.mode !== 'result' ? (
              <>
                <Text style={styles.summary}>
                  {request.mode === 'create'
                    ? targetsSummary(request.items)
                    : `${request.share.items.map((item) => `${KIND_NAMES[item.kind]} „${item.name}”`).join(', ')} · ważny do ${materialShareDateLabel(request.share.expiresAt)}`}
                </Text>
                <Text style={styles.label}>Tytuł na stronie</Text>
                <TextInput style={styles.input} value={title} maxLength={MATERIAL_SHARE_LIMITS.title} onChangeText={setTitle}
                  placeholder="Np. Zdjęcia z fotobudki — wesele" placeholderTextColor={colors.text.tertiary} />
                <Text style={styles.label}>Wiadomość na stronie (opcjonalnie)</Text>
                <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} multiline value={message} maxLength={MATERIAL_SHARE_LIMITS.message}
                  onChangeText={setMessage} placeholder="Np. Dziękujemy za wspólną zabawę!" placeholderTextColor={colors.text.tertiary} />
                {!editing && (
                  <>
                    <Text style={styles.label}>Ważny przez</Text>
                    <View style={[styles.row, { flexWrap: 'wrap' }]}>
                      {MATERIAL_SHARE_DAYS.map((value) => (
                        <TouchableOpacity key={value} onPress={() => setDays(value)} style={[styles.chip, days === value && styles.chipActive]}>
                          <Text style={[styles.chipText, days === value && { color: colors.primary.gold }]}>{materialShareDaysLabel(value)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={styles.muted}>Link przestanie działać {materialShareDateLabel(materialShareExpiry(days))}.</Text>
                  </>
                )}
                <Text style={styles.label}>Kto może pobrać</Text>
                {(['public', 'password'] as const).map((value) => (
                  <TouchableOpacity key={value} onPress={() => setAccess(value)} style={[styles.option, access === value && styles.optionActive]}>
                    <Feather name={value === 'public' ? 'users' : 'lock'} size={16} color={colors.primary.gold} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.body}>{MATERIAL_SHARE_ACCESS_LABELS[value]}</Text>
                      <Text style={styles.muted}>{value === 'public' ? 'Najprościej dla gości — wystarczy otworzyć link.' : 'Tylko osoby z listy, po wpisaniu hasła.'}</Text>
                    </View>
                    {access === value && <Feather name="check" size={16} color={colors.primary.gold} />}
                  </TouchableOpacity>
                ))}
                {access === 'password' && (
                  <>
                    <Text style={styles.label}>E-mail odbiorcy (kilka — oddziel przecinkami)</Text>
                    <TextInput style={styles.input} value={emails} onChangeText={setEmails} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                      placeholder="anna@example.com" placeholderTextColor={colors.text.tertiary} />
                    <Text style={styles.label}>{editing && !needsPassword ? 'Nowe hasło (puste — bez zmiany)' : 'Hasło'}</Text>
                    <TextInput style={styles.input} value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false}
                      maxLength={MATERIAL_SHARE_LIMITS.passwordMax} placeholderTextColor={colors.text.tertiary}
                      placeholder={editing && !needsPassword ? 'Zostaw puste, aby zachować hasło' : 'Puste — wygenerujemy hasło'} />
                  </>
                )}
                {!!error && <Text style={styles.error}>{error}</Text>}
              </>
            ) : null}
          </ScrollView>
          {!!flash && <Text style={styles.flash}>{flash}</Text>}
          {share ? (
            <View style={styles.row}>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => void copy(text, 'Skopiowano wiadomość.')}>
                <Feather name="copy" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>Kopiuj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => void Share.share({ message: text, title: share.title })}>
                <Feather name="share" size={16} color={colors.primary.gold} /><Text style={styles.secondaryText}>Udostępnij…</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={onClose}><Text style={styles.primaryText}>Gotowe</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={styles.row}>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={onClose} disabled={busy}><Text style={styles.secondaryText}>Anuluj</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={() => void save()} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.background.primary} /> : <Text style={styles.primaryText}>{editing ? 'Zapisz' : 'Utwórz link'}</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', maxWidth: 560, maxHeight: '90%', backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  summary: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, backgroundColor: colors.background.tertiary, borderRadius: borderRadius.md, padding: spacing.sm },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  label: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: spacing.xs },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  password: { color: colors.primary.gold, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, letterSpacing: 1 },
  error: { color: colors.status.error, fontSize: typography.fontSizes.sm },
  flash: { color: colors.primary.gold, fontSize: typography.fontSizes.sm, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  box: { gap: 6, padding: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.hover },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: 'rgba(211,187,115,0.12)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default },
  optionActive: { borderColor: colors.primary.gold, backgroundColor: 'rgba(211,187,115,0.10)' },
  primary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold, paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
});
