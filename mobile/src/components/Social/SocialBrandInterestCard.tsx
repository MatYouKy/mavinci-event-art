import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import {
  SOCIAL_BRAND_CHANNELS, SOCIAL_BRAND_COLORS, SOCIAL_BRAND_INSTAGRAM_POSTS_HINT, SOCIAL_BRAND_LABELS, SOCIAL_BRAND_SHORT_LABELS,
  SOCIAL_BRAND_STATUS_LABELS, SOCIAL_BRAND_TERMS_LIMITS, formatSocialNumber, socialBrandDayLabel, socialBrandTermsFromText,
  socialChangeLabel, type SocialBrandChannel, type SocialBrandInterest,
} from '../../lib/socialShared';

/*
 * Social media → Statystyki → „Zainteresowanie marką” w aplikacji (jak w CRM i na Macu): wyszukiwania nazwy marki w Google,
 * wejścia na stronę Facebook i na profil Instagram — suma okresu wobec poprzedniego, dzień po dniu (osobny słupkowy wykres
 * kanału), frazy z Google i stan kanałów. Wyłącznie liczby — Google i Meta nie podają, kto szukał ani kto odwiedził profil.
 * „Odśwież” — każdy z dostępem do statystyk, „Frazy marki” — zarządzający marketingiem albo akceptujący social media marki
 * (zapis w oknie z własnym wskaźnikiem i komunikatem — iOS nie pokaże drugiego okna nad otwartym).
 */

type Props = {
  brand: SocialBrandInterest;
  days: number;
  onRefresh: () => void;
  /** Zapis fraz i nowe statystyki (błąd — wyjątek z komunikatem). */
  saveTerms: (terms: string[]) => Promise<void>;
  errorText: (cause: unknown, fallback: string) => string;
};

function Change({ current, previous }: { current: number | null | undefined; previous: number | null | undefined }) {
  const label = socialChangeLabel(current, previous);
  if (!label) return null;
  const color = label === '0%' ? colors.text.tertiary : label.startsWith('−') ? colors.status.error : colors.status.success;
  return <Text style={[styles.change, { color }]}>{label}</Text>;
}

function stateLine(brand: SocialBrandInterest, channel: SocialBrandChannel) {
  const state = brand.channels[channel];
  const synced = state.syncedAt
    ? ` · pobrano ${new Date(state.syncedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : '';
  return `${SOCIAL_BRAND_SHORT_LABELS[channel]}: ${SOCIAL_BRAND_STATUS_LABELS[state.status]}${synced}`;
}

export default function SocialBrandInterestCard({ brand, days, onRefresh, saveTerms, errorText }: Props) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const visible = useMemo(
    () => SOCIAL_BRAND_CHANNELS.filter((channel) => brand.days.some((day) => day[channel] != null)),
    [brand.days],
  );
  const problems = SOCIAL_BRAND_CHANNELS.filter((channel) => brand.channels[channel].status !== 'ok' && brand.channels[channel].message);
  const first = brand.days[0];
  const last = brand.days[brand.days.length - 1];

  const note = (channel: SocialBrandChannel) => {
    if (channel === 'google' && brand.totals.googleClicks != null) return `Kliknięcia: ${formatSocialNumber(brand.totals.googleClicks)}`;
    if (channel === 'instagram' && brand.instagramSource === 'posts') return 'Z postów opublikowanych z CRM';
    return brand.totals[channel] == null ? SOCIAL_BRAND_STATUS_LABELS[brand.channels[channel].status] : '';
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Feather name="search" size={16} color={colors.primary.gold} />
        <Text style={styles.cardTitle}>Zainteresowanie marką</Text>
      </View>
      <Text style={styles.muted}>Ostatnie {days} dni wobec {days} dni wcześniej. Tylko liczby — Google i Meta nie podają, kto szukał ani kto odwiedził profil.</Text>

      <View style={styles.tiles}>
        {SOCIAL_BRAND_CHANNELS.map((channel) => (
          <View key={channel} style={styles.tile}>
            <View style={styles.tileHead}>
              <View style={[styles.dot, { backgroundColor: SOCIAL_BRAND_COLORS[channel] }]} />
              <Text style={styles.tileLabel} numberOfLines={2}>{SOCIAL_BRAND_LABELS[channel]}</Text>
            </View>
            <Text style={styles.tileValue}>{formatSocialNumber(brand.totals[channel])}</Text>
            <Change current={brand.totals[channel]} previous={brand.previous[channel]} />
            {note(channel) ? <Text style={styles.tileNote} numberOfLines={2}>{note(channel)}</Text> : null}
          </View>
        ))}
      </View>
      {brand.instagramSource === 'posts' && <Text style={styles.muted}>Instagram: {SOCIAL_BRAND_INSTAGRAM_POSTS_HINT}</Text>}

      {problems.length > 0 && (
        <View style={styles.problems}>
          {problems.map((channel) => (
            <Text key={channel} style={[styles.warning, brand.channels[channel].status === 'error' && { color: colors.status.error }]}>
              {SOCIAL_BRAND_SHORT_LABELS[channel]} — {SOCIAL_BRAND_STATUS_LABELS[brand.channels[channel].status]}: {brand.channels[channel].message}
            </Text>
          ))}
        </View>
      )}

      {visible.length === 0 ? (
        <Text style={styles.muted}>Brak danych w tym okresie — pojawią się po pobraniu z Google i Meta.</Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {visible.map((channel) => {
            const values = brand.days.map((day) => day[channel]);
            const top = Math.max(1, ...values.map((value) => value ?? 0));
            return (
              <View key={channel} style={{ gap: 4 }}>
                <View style={styles.chartHead}>
                  <Text style={styles.body}>{SOCIAL_BRAND_SHORT_LABELS[channel]}</Text>
                  <Text style={styles.muted}>najwięcej: {formatSocialNumber(Math.max(0, ...values.map((value) => value ?? 0)))}</Text>
                </View>
                <View style={styles.chart} accessibilityLabel={`${SOCIAL_BRAND_LABELS[channel]} dzień po dniu`}>
                  {values.map((value, index) => (
                    <View key={index} style={[styles.bar, {
                      backgroundColor: SOCIAL_BRAND_COLORS[channel],
                      height: value == null ? 1 : Math.max(2, (value / top) * 56),
                      opacity: value == null ? 0.12 : value > 0 ? 0.9 : 0.25,
                    }]} />
                  ))}
                </View>
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.muted}>{first ? socialBrandDayLabel(first.date) : ''}</Text>
            <Text style={styles.muted}>{last ? socialBrandDayLabel(last.date) : ''}</Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionLabel}>JAK NAS SZUKAJĄ W GOOGLE</Text>
      {brand.queries.length ? brand.queries.map((item, index) => (
        <View key={item.query} style={styles.query}>
          <Text style={[styles.body, { color: colors.primary.gold, width: 22 }]}>{index + 1}.</Text>
          <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>{item.query}</Text>
          <Text style={styles.body}>{formatSocialNumber(item.searches)}</Text>
          <Text style={[styles.muted, { width: 64, textAlign: 'right' }]}>{formatSocialNumber(item.clicks)} klik.</Text>
        </View>
      )) : (
        <Text style={styles.muted}>
          {brand.channels.google.status === 'not_connected' ? brand.channels.google.message : 'Brak fraz z nazwą marki w tym okresie.'}
        </Text>
      )}

      <Text style={styles.sectionLabel}>LICZONE FRAZY</Text>
      <Text style={[styles.body, { color: colors.primary.gold }]}>{brand.terms.length ? brand.terms.join(' · ') : 'Brak fraz.'}</Text>
      <Text style={styles.muted}>
        {brand.defaultTerms ? 'Frazy domyślne — z nazwy i adresu strony marki. ' : ''}
        Google liczy każdą frazę zawierającą jedną z nich (np. „{brand.terms[0] || 'nazwa'} opinie”).
        {brand.canEditTerms ? '' : ' Frazy zmienia osoba zarządzająca marketingiem albo akceptująca social media.'}
      </Text>
      {SOCIAL_BRAND_CHANNELS.map((channel) => <Text key={channel} style={styles.muted}>{stateLine(brand, channel)}</Text>)}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {(brand.canRefresh || brand.canEditTerms) && (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {brand.canRefresh && (
            <TouchableOpacity style={styles.secondary} onPress={onRefresh}>
              <Feather name="refresh-cw" size={14} color={colors.primary.gold} /><Text style={styles.secondaryText}>Odśwież</Text>
            </TouchableOpacity>
          )}
          {brand.canEditTerms && (
            <TouchableOpacity style={styles.secondary} onPress={() => setEditing(true)}>
              <Feather name="tag" size={14} color={colors.primary.gold} /><Text style={styles.secondaryText}>Frazy marki</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {editing && (
        <TermsModal brand={brand} errorText={errorText} onClose={() => setEditing(false)}
          onSave={saveTerms} onSaved={(message) => { setEditing(false); setNotice(message); }} />
      )}
    </View>
  );
}

function TermsModal({ brand, errorText, onClose, onSave, onSaved }: {
  brand: SocialBrandInterest;
  errorText: (cause: unknown, fallback: string) => string;
  onClose: () => void;
  onSave: (terms: string[]) => Promise<void>;
  onSaved: (message: string) => void;
}) {
  const [value, setValue] = useState(brand.defaultTerms ? '' : brand.terms.join('\n'));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const parsed = socialBrandTermsFromText(value);

  const save = async (terms: string[]) => {
    setSaving(true);
    setFailure('');
    try {
      await onSave(terms);
      onSaved(terms.length ? 'Zapisano frazy marki — wyniki Google pobrane od nowa.' : 'Przywrócono frazy domyślne — wyniki Google pobrane od nowa.');
    } catch (cause) {
      setFailure(errorText(cause, 'Nie udało się zapisać fraz marki.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.cardTitle}>Frazy marki</Text>
          <Text style={styles.muted}>
            Wyszukiwania w Google liczymy dla fraz zawierających jedną z poniższych — każda w osobnym wierszu, od {SOCIAL_BRAND_TERMS_LIMITS.min} do {SOCIAL_BRAND_TERMS_LIMITS.max} znaków,
            najwyżej {SOCIAL_BRAND_TERMS_LIMITS.count}. Spacja i łącznik między słowami są opcjonalne („event rulers” obejmuje też „eventrulers”).
          </Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={brand.defaultTerms ? brand.terms.join('\n') : 'np. mavinci'}
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            accessibilityLabel="Frazy marki"
          />
          {brand.defaultTerms && <Text style={styles.muted}>Teraz liczone są frazy domyślne: {brand.terms.join(', ') || 'brak'}.</Text>}
          {parsed.error ? <Text style={[styles.warning, { color: colors.status.error }]}>{parsed.error}</Text> : null}
          {failure ? <Text style={[styles.warning, { color: colors.status.error }]}>{failure}</Text> : null}
          <Text style={styles.muted}>Po zapisaniu wyniki Google z 90 dni pobiorą się od nowa dla nowych fraz.</Text>
          {saving && (
            <View style={styles.saving}><ActivityIndicator color={colors.primary.gold} /><Text style={styles.body}>Zapisuję frazy i pobieram wyniki z Google…</Text></View>
          )}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity style={styles.secondary} onPress={onClose} disabled={saving}><Text style={styles.secondaryText}>Anuluj</Text></TouchableOpacity>
            <TouchableOpacity
              style={[styles.primary, (Boolean(parsed.error) || parsed.terms.length === 0 || saving) && { opacity: 0.4 }]}
              disabled={Boolean(parsed.error) || parsed.terms.length === 0 || saving}
              onPress={() => void save(parsed.terms)}>
              <Text style={styles.primaryText}>Zapisz frazy</Text>
            </TouchableOpacity>
          </View>
          {!brand.defaultTerms && (
            <TouchableOpacity onPress={() => void save([])} disabled={saving} style={{ alignSelf: 'center', padding: spacing.xs }}>
              <Text style={styles.link}>Przywróć frazy domyślne</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.medium },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  warning: { color: colors.status.warning, fontSize: typography.fontSizes.xs },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  change: { fontSize: 11 },
  notice: { color: colors.status.success, fontSize: typography.fontSizes.xs },
  saving: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionLabel: { color: colors.text.tertiary, fontSize: 11, fontWeight: typography.fontWeights.semibold, marginTop: spacing.xs },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tile: { width: '32%', flexGrow: 1, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary, gap: 2 },
  tileHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
  tileLabel: { flex: 1, color: colors.text.tertiary, fontSize: 11 },
  tileValue: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  tileNote: { color: colors.text.tertiary, fontSize: 10 },
  problems: { gap: 4, padding: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.status.warning },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chart: { height: 56, flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  bar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  query: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  primary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary.gold, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.lg },
  sheet: { gap: spacing.sm, backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg },
  input: {
    minHeight: 110, textAlignVertical: 'top', color: colors.text.primary, fontSize: typography.fontSizes.sm, padding: spacing.sm,
    borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.background.tertiary,
  },
});
