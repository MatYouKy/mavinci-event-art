import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../../lib/supabase';
import { colors, spacing, borderRadius, typography, withAlpha } from '../../theme';
import { Chip, Label, NoticeScope, Sheet, SmallButton, kit, useNotice } from '../Inquiries/InquiryKit';
import {
  TENDER_FILTER_LIST_FIELDS, addTenderFilterValues, tenderFilterChanged, tenderFilterInput, validateTenderFilterInput,
  type TenderConfigState, type TenderFilterConfig, type TenderFilterListField,
} from '../../lib/tenderFilterConfig';

/*
 * Przetargi → Konfiguracja filtrów — jak `/crm/tenders/config` w CRM i „Konfiguracja” na Macu (`TenderFilterConfigView`):
 * konfiguracje (aktywna oznaczona), nazwa, minimalna ocena trafności, maks. dni do terminu, „Powiadom od oceny”,
 * „Konfiguracja aktywna” i listy: słowa kluczowe, słowa wykluczające, kody CPV, lokalizacje (kilka pozycji naraz — nowe linie,
 * przecinki, średniki, kropki; „Wklej listę” ze schowka; powtórzenia pomijane). Zapis, nowa konfiguracja, usunięcie
 * i „Przelicz przetargi” — serwer (`/bridge/native/v1/tenders`, token sesji, `x-mavinci-client: phone`, RLS): zmiany —
 * administrator, pozostali pracownicy z dostępem do przetargów — podgląd.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/tenders`;

type ConfigReply = TenderConfigState & { selectedId?: string | null; message?: string | null };
type RecalculationReply = { checked: number; updated: number; message: string };

async function requestHeaders(json: boolean): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'x-mavinci-client': 'phone',
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function call<T>(init: { method: 'GET' } | { method: 'POST'; body: Record<string, unknown> }): Promise<T> {
  let response: Response;
  try {
    response = init.method === 'GET'
      ? await fetch(`${ENDPOINT}?op=config`, { headers: await requestHeaders(false) })
      : await fetch(ENDPOINT, { method: 'POST', headers: await requestHeaders(true), body: JSON.stringify(init.body) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body;
}

const LIST_TINT: Record<TenderFilterListField, string> = {
  positive_keywords: colors.status.success,
  negative_keywords: colors.status.error,
  cpv_codes: colors.primary.gold,
  locations: '#60a5fa',
};
const EMPTY_INPUTS: Record<TenderFilterListField, string> = { positive_keywords: '', negative_keywords: '', cpv_codes: '', locations: '' };
const numberText = (value: number) => (Number.isFinite(value) ? String(value) : '');
const numberValue = (text: string) => { const digits = text.replace(/[^0-9]/g, ''); return digits ? Number(digits) : NaN; };

export default function TenderFilterConfigSheet({ visible, onClose, onRecalculated }: {
  visible: boolean;
  onClose: () => void;
  /** Po przeliczeniu ocen — lista przetargów odświeża oceny. */
  onRecalculated?: () => void;
}) {
  const notice = useNotice();
  const [state, setState] = useState<TenderConfigState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TenderFilterConfig | null>(null);
  const [inputs, setInputs] = useState<Record<TenderFilterListField, string>>(EMPTY_INPUTS);
  const [duplicates, setDuplicates] = useState<Partial<Record<TenderFilterListField, boolean>>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'discard'; then: () => void } | { kind: 'delete' }>(null);
  const timers = useRef<Partial<Record<TenderFilterListField, ReturnType<typeof setTimeout>>>>({});

  const saved = state?.configs.find((config) => config.id === selectedId) ?? null;
  const canEdit = state?.canEdit === true;
  const dirty = !!saved && !!draft && draft.id === saved.id && tenderFilterChanged(saved, draft);

  const apply = useCallback((reply: ConfigReply, prefer: string | null) => {
    const chosen = reply.configs.find((config) => config.id === (reply.selectedId ?? prefer)) ?? reply.configs[0] ?? null;
    setState({ configs: reply.configs, canEdit: reply.canEdit, canRecalculate: reply.canRecalculate });
    setSelectedId(chosen?.id ?? null);
    setDraft(chosen ? { ...chosen } : null);
    setInputs(EMPTY_INPUTS);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    setConfirm(null);
    void (async () => {
      try {
        const reply = await call<ConfigReply>({ method: 'GET' });
        if (!cancelled) { apply(reply, null); setLoadError(null); }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Nie udało się wczytać konfiguracji filtrów.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, apply]);

  useEffect(() => {
    const pending = timers.current;
    return () => { Object.values(pending).forEach((timer) => { if (timer) clearTimeout(timer); }); };
  }, []);

  const guard = (then: () => void) => { if (dirty) setConfirm({ kind: 'discard', then }); else then(); };
  const close = () => guard(onClose);

  const post = async (label: string, body: Record<string, unknown>, prefer: string | null) => {
    setInfo(null);
    const reply = await notice.run(label, () => call<ConfigReply>({ method: 'POST', body }));
    if (!reply) return;
    apply(reply, prefer);
    setInfo(reply.message || 'Zapisano.');
  };

  const save = () => {
    if (!draft || !saved || !canEdit) return;
    const input = tenderFilterInput(draft as unknown as Record<string, unknown>);
    const problem = validateTenderFilterInput(input);
    if (problem) { notice.notify(problem, true); return; }
    void post('Zapisywanie konfiguracji…', { op: 'configSave', id: draft.id, config: input, updatedAt: saved.updated_at }, draft.id);
  };

  const recalculate = async () => {
    if (!state?.canRecalculate) return;
    if (dirty) { notice.notify('Najpierw zapisz zmiany — przeliczenie używa zapisanej aktywnej konfiguracji.', true); return; }
    setInfo(null);
    const reply = await notice.run('Przeliczanie przetargów…', () => call<RecalculationReply>({ method: 'POST', body: { op: 'recalculate' } }));
    if (!reply) return;
    setInfo(reply.message);
    onRecalculated?.();
  };

  const flash = (field: TenderFilterListField) => {
    setDuplicates((current) => ({ ...current, [field]: true }));
    const previous = timers.current[field];
    if (previous) clearTimeout(previous);
    timers.current[field] = setTimeout(() => setDuplicates((current) => ({ ...current, [field]: false })), 1800);
  };

  const addValues = (field: TenderFilterListField, text: string) => {
    if (!draft || !canEdit || !text.trim()) return;
    const result = addTenderFilterValues(draft[field], text);
    if (result.duplicates) flash(field);
    if (result.added) setDraft({ ...draft, [field]: result.list });
  };

  const submit = (field: TenderFilterListField) => {
    addValues(field, inputs[field]);
    setInputs((current) => ({ ...current, [field]: '' }));
  };

  const pasteList = async (field: TenderFilterListField) => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (!text.trim()) { notice.notify('Schowek jest pusty — skopiuj listę i spróbuj ponownie.', true); return; }
    addValues(field, text);
  };

  const remove = (field: TenderFilterListField, index: number) => {
    if (!draft || !canEdit) return;
    setDraft({ ...draft, [field]: draft[field].filter((_, i) => i !== index) });
  };

  const footer = confirm ? (
    <>
      <TouchableOpacity onPress={() => setConfirm(null)} style={kit.secondary}><Text style={kit.secondaryText}>Wróć</Text></TouchableOpacity>
      <TouchableOpacity
        style={kit.danger}
        accessibilityRole="button"
        onPress={() => {
          const current = confirm;
          setConfirm(null);
          if (current.kind === 'discard') current.then();
          else if (saved) void post('Usuwanie konfiguracji…', { op: 'configDelete', id: saved.id }, null);
        }}>
        <Text style={kit.dangerText}>{confirm.kind === 'discard' ? 'Odrzuć zmiany' : 'Usuń konfigurację'}</Text>
      </TouchableOpacity>
    </>
  ) : (
    <>
      <TouchableOpacity onPress={close} style={kit.secondary}><Text style={kit.secondaryText}>Zamknij</Text></TouchableOpacity>
      {canEdit ? (
        <TouchableOpacity onPress={save} disabled={!dirty || !!notice.busy} style={[kit.primary, (!dirty || !!notice.busy) && kit.disabled]} accessibilityRole="button">
          <Text style={kit.primaryText}>Zapisz konfigurację</Text>
        </TouchableOpacity>
      ) : null}
    </>
  );

  return (
    <NoticeScope value={notice.scope}>
      <Sheet visible={visible} title="Konfiguracja filtrów" subtitle="Kryteria dopasowania przetargów do profilu firmy" onClose={close} footer={footer} width={720}>
        {loading && !state ? <ActivityIndicator color={colors.primary.gold} style={styles.loader} /> : null}
        {loadError && !state ? <Text style={styles.error}>{loadError}</Text> : null}
        {confirm ? (
          <View style={styles.confirm}>
            <Feather name="alert-triangle" size={18} color={colors.status.warning} />
            <Text style={[kit.text, kit.flex]}>
              {confirm.kind === 'discard'
                ? 'Masz niezapisane zmiany w konfiguracji. Odrzucić je?'
                : `Usunąć konfigurację „${saved?.name ?? ''}”? Tej operacji nie można cofnąć.`}
            </Text>
          </View>
        ) : null}
        {info ? (
          <View style={styles.info} accessibilityLiveRegion="polite">
            <Feather name="check-circle" size={16} color={colors.status.success} />
            <Text style={[kit.text, kit.flex]}>{info}</Text>
          </View>
        ) : null}
        {state && !canEdit ? (
          <View style={styles.readonly}>
            <Feather name="lock" size={14} color={colors.primary.gold} />
            <Text style={[kit.muted, kit.flex]}>Podgląd konfiguracji — zmiany zapisuje administrator CRM.</Text>
          </View>
        ) : null}
        {state && state.configs.length === 0 ? (
          <Text style={kit.muted}>Brak konfiguracji filtrów.{canEdit ? ' Dodaj pierwszą przyciskiem „Nowa”.' : ''}</Text>
        ) : null}

        {state && state.configs.length > 0 ? (
          <>
            <Label>Konfiguracje</Label>
            <View style={kit.wrap}>
              {state.configs.map((config) => (
                <Chip
                  key={config.id}
                  label={`${config.name}${config.is_active ? ' · aktywna' : ''}${config.id === selectedId && dirty ? ' •' : ''}`}
                  active={config.id === selectedId}
                  onPress={() => {
                    if (config.id === selectedId) return;
                    guard(() => { setSelectedId(config.id); setDraft({ ...config }); setInputs(EMPTY_INPUTS); setInfo(null); });
                  }}
                />
              ))}
            </View>
          </>
        ) : null}
        {state && (canEdit || state.canRecalculate) ? (
          <View style={kit.wrap}>
            {canEdit ? (
              <SmallButton label="Nowa" icon="plus" disabled={!!notice.busy}
                onPress={() => guard(() => { void post('Dodawanie konfiguracji…', { op: 'configCreate' }, null); })} />
            ) : null}
            {canEdit && saved ? (
              <SmallButton label="Usuń" icon="trash-2" danger disabled={saved.is_active || !!notice.busy}
                onPress={() => setConfirm({ kind: 'delete' })} />
            ) : null}
            {state.canRecalculate ? (
              <SmallButton label="Przelicz przetargi" icon="refresh-cw" disabled={!!notice.busy} onPress={() => void recalculate()} />
            ) : null}
          </View>
        ) : null}
        {canEdit && saved?.is_active ? <Text style={kit.muted}>Aktywnej konfiguracji nie można usunąć — najpierw zapisz inną jako aktywną.</Text> : null}

        {draft ? (
          <>
            <Label>Nazwa konfiguracji</Label>
            <TextInput style={kit.input} value={draft.name} editable={canEdit} maxLength={120}
              onChangeText={(name: string) => setDraft({ ...draft, name })} placeholderTextColor={colors.text.tertiary} />
            <View style={styles.numbers}>
              <View style={styles.number}>
                <Label>Minimalna ocena trafności</Label>
                <TextInput style={kit.input} value={numberText(draft.min_relevance_score)} editable={canEdit} keyboardType="number-pad" maxLength={3}
                  onChangeText={(text: string) => setDraft({ ...draft, min_relevance_score: numberValue(text) })} />
              </View>
              <View style={styles.number}>
                <Label>Max dni do terminu</Label>
                <TextInput style={kit.input} value={numberText(draft.max_days_to_deadline)} editable={canEdit} keyboardType="number-pad" maxLength={3}
                  onChangeText={(text: string) => setDraft({ ...draft, max_days_to_deadline: numberValue(text) })} />
              </View>
              <View style={styles.number}>
                <Label>Powiadom od oceny</Label>
                <TextInput style={kit.input} value={numberText(draft.notification_score_threshold)} editable={canEdit} keyboardType="number-pad" maxLength={3}
                  onChangeText={(text: string) => setDraft({ ...draft, notification_score_threshold: numberValue(text) })} />
              </View>
            </View>
            <Text style={kit.muted}>Dla nowych przetargów z taką oceną CRM utworzy powiadomienie i banner push.</Text>
            <View style={styles.switchRow}>
              <Text style={[kit.text, kit.flex]}>Konfiguracja aktywna</Text>
              <Switch value={draft.is_active} disabled={!canEdit} onValueChange={(value: boolean) => setDraft({ ...draft, is_active: value })}
                trackColor={{ true: colors.primary.gold, false: colors.border.default }} accessibilityLabel="Konfiguracja aktywna" />
            </View>
            <Text style={kit.muted}>Pobieranie przetargów i przeliczenie ocen używają jednej konfiguracji — zapis aktywnej wyłącza pozostałe.</Text>

            {TENDER_FILTER_LIST_FIELDS.map((field) => {
              const tint = LIST_TINT[field.key];
              const values = draft[field.key];
              return (
                <View key={field.key} style={styles.list}>
                  <View style={kit.between}>
                    <Text style={[styles.listTitle, { color: tint }]}>{field.label}</Text>
                    <Text style={kit.muted}>{values.length}</Text>
                  </View>
                  {canEdit ? (
                    <>
                      <View style={styles.addRow}>
                        <TextInput
                          style={[kit.input, kit.flex, duplicates[field.key] && styles.inputDuplicate]}
                          value={inputs[field.key]}
                          onChangeText={(text: string) => {
                            // Wklejenie kilku linii naraz — pozycje trafiają od razu na listę.
                            if (/[\r\n]/.test(text)) { addValues(field.key, text); setInputs((current) => ({ ...current, [field.key]: '' })); return; }
                            setInputs((current) => ({ ...current, [field.key]: text }));
                          }}
                          onSubmitEditing={() => submit(field.key)}
                          placeholder={field.placeholder}
                          placeholderTextColor={colors.text.tertiary}
                          returnKeyType="done"
                          autoCorrect={false}
                          accessibilityLabel={field.label}
                        />
                        <SmallButton label="Dodaj" icon="plus" disabled={!inputs[field.key].trim()} onPress={() => submit(field.key)} />
                      </View>
                      <SmallButton label="Wklej listę" icon="clipboard" onPress={() => void pasteList(field.key)} />
                      {duplicates[field.key] ? <Text style={styles.duplicate}>Pominięto pozycje, które już są na liście.</Text> : null}
                    </>
                  ) : null}
                  <View style={kit.wrap}>
                    {values.length === 0 ? <Text style={kit.muted}>Brak pozycji.</Text> : null}
                    {values.map((value, index) => (
                      <View key={`${value}-${index}`} style={[styles.chip, { borderColor: withAlpha(tint, 0.35), backgroundColor: withAlpha(tint, 0.12) }]}>
                        <Text style={[styles.chipText, { color: tint }]} numberOfLines={1}>{value}</Text>
                        {canEdit ? (
                          <TouchableOpacity onPress={() => remove(field.key, index)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Usuń „${value}”`}>
                            <Feather name="x" size={13} color={tint} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        ) : null}
      </Sheet>
    </NoticeScope>
  );
}

const styles = StyleSheet.create({
  loader: { marginVertical: spacing.lg },
  error: { color: colors.status.error, fontSize: typography.fontSizes.sm },
  confirm: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: colors.status.warning, backgroundColor: withAlpha(colors.status.warning, 0.1),
  },
  info: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: withAlpha(colors.status.success, 0.4), backgroundColor: withAlpha(colors.status.success, 0.08),
  },
  readonly: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.md,
    backgroundColor: withAlpha(colors.primary.gold, 0.08),
  },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  number: { flexGrow: 1, flexBasis: 150 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  list: { gap: spacing.xs, marginTop: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.border.default },
  listTitle: { fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inputDuplicate: { borderColor: colors.status.error },
  duplicate: { color: colors.status.error, fontSize: typography.fontSizes.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 5, borderRadius: borderRadius.full, borderWidth: 1 },
  chipText: { fontSize: typography.fontSizes.xs, flexShrink: 1 },
});
