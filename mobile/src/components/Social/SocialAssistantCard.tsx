import React, { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import {
  SOCIAL_AI_GOALS, SOCIAL_AI_LENGTHS, SOCIAL_AI_REWRITES, SOCIAL_AI_TONES, SOCIAL_HASHTAGS_RECOMMENDED, SOCIAL_LIMITS, normalizeHashtags,
  toggleHashtag, type SocialAiGoal, type SocialAiHashtagGroup, type SocialAiLength, type SocialAiMode, type SocialAiRewrite,
  type SocialAiTone, type SocialChannel,
} from '../../lib/socialShared';
import { socialErrorMessage, socialPost, type SocialAiSuggestion, type SocialPostDetail } from '../../lib/socialApi';

/*
 * Asystent AI w karcie posta (jak w CRM i na Macu): „Napisz” — 3 wersje opisu z hashtagami, tytułem i podpisem grafiki
 * (temat, cel, ton, długość, opcjonalnie zdjęcie), „Popraw opis” — szybkie poprawki bieżącego opisu albo własne polecenie,
 * „Hashtagi” — podpowiedzi w grupach do zaznaczania. Bierze niezapisane wartości z karty; wynik nie zmienia posta, dopóki
 * nie wybierzesz propozycji. Wyłączonego asystenta włącza osoba akceptująca (zgoda zapisana z nazwiskiem i datą).
 */

export type SocialAssistantDraft = {
  caption: string;
  hashtags: string;
  headline: string;
  subline: string;
  eventId: string | null;
  assetId: string | null;
  channels: SocialChannel[];
};

type AssistReply = {
  mode: SocialAiMode;
  suggestions: SocialAiSuggestion[];
  hashtagGroups: SocialAiHashtagGroup[];
  usedPhoto: boolean;
  photoNote: string | null;
};

type Tab = 'write' | 'rewrite' | 'hashtags';

const TABS: Array<[Tab, string, keyof typeof Feather.glyphMap]> = [['write', 'Napisz', 'edit-3'], ['rewrite', 'Popraw opis', 'refresh-cw'], ['hashtags', 'Hashtagi', 'hash']];

function Chips<K extends string>({ options, value, onChange, allowEmpty = true }: {
  options: Record<K, string>; value: K | null; onChange: (value: K | null) => void; allowEmpty?: boolean;
}) {
  return (
    <View style={styles.chips}>
      {(Object.keys(options) as K[]).map((key) => (
        <TouchableOpacity key={key} style={[styles.chip, value === key && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: value === key }}
          onPress={() => onChange(value === key && allowEmpty ? null : key)}>
          <Text style={[styles.chipText, value === key && styles.chipTextActive]}>{options[key]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function SocialAssistantCard({ detail, draft, onBusy, onUse, onHashtags, onEnabled }: {
  detail: SocialPostDetail;
  draft: SocialAssistantDraft;
  /** Modal ładowania karty posta (null — koniec). */
  onBusy: (label: string | null) => void;
  /** Wybrana propozycja: opis i hashtagi, a przy `withGraphic` — także tytuł i podpis grafiki (gdy są). */
  onUse: (suggestion: SocialAiSuggestion, withGraphic: boolean) => void;
  onHashtags: (hashtags: string[]) => void;
  onEnabled: () => void;
}) {
  const [tab, setTab] = useState<Tab>('write');
  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState<SocialAiGoal | null>(detail.event ? 'realization' : null);
  const [tone, setTone] = useState<SocialAiTone | null>('elegant');
  const [length, setLength] = useState<SocialAiLength | null>('medium');
  const [usePhoto, setUsePhoto] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [reply, setReply] = useState<AssistReply | null>(null);

  const call = async <T,>(label: string, action: () => Promise<T>, failure: string): Promise<T | null> => {
    onBusy(label);
    try {
      return await action();
    } catch (cause) {
      Alert.alert('Asystent AI', socialErrorMessage(cause, failure));
      return null;
    } finally {
      onBusy(null);
    }
  };

  if (!detail.settings.aiCaptionsEnabled) {
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <Feather name="zap" size={16} color={colors.primary.gold} />
          <Text style={[styles.muted, { flex: 1 }]}>
            Asystent AI pisze opisy, poprawia je i dobiera hashtagi. {detail.access.approve ? 'Jest wyłączony dla tej marki.' : 'Włącza go osoba akceptująca posty (CRM → Social media → Szablony i AI).'}
          </Text>
        </View>
        {detail.access.approve && (
          <TouchableOpacity style={styles.button} onPress={() => Alert.alert('Włączyć asystenta AI?',
            'Do OpenAI trafią: temat i opis wpisane w karcie, rodzaj wydarzenia, miejsce, miesiąc i opis realizacji; nazwa wydarzenia i klient — tylko przy zgodzie klienta na publikację; zdjęcie — tylko gdy włączysz „Uwzględnij zdjęcie” i ma ono zgodę klienta. Zgoda zostanie zapisana z Twoim nazwiskiem i datą; wyłączysz ją w CRM („Szablony i AI”).', [
              { text: 'Anuluj', style: 'cancel' },
              {
                text: 'Włącz asystenta',
                onPress: async () => {
                  const result = await call('Włączam asystenta AI', () => socialPost<{ settings: { aiCaptionsEnabled: boolean } }>('settings', {
                    companyId: detail.post.companyId, aiCaptionsEnabled: true,
                  }), 'Nie udało się włączyć asystenta AI.');
                  if (!result?.settings.aiCaptionsEnabled) return;
                  onEnabled();
                  Alert.alert('Asystent AI', 'Asystent AI włączony.');
                },
              },
            ])}>
            <Feather name="zap" size={16} color={colors.primary.gold} /><Text style={styles.buttonText}>Włącz asystenta AI</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const current = normalizeHashtags(draft.hashtags);
  const hasCaption = Boolean(draft.caption.trim());
  const base = {
    id: detail.post.id, caption: draft.caption, hashtags: current, headline: draft.headline, subline: draft.subline,
    eventId: draft.eventId, assetId: draft.assetId, channels: draft.channels, usePhoto: usePhoto && Boolean(draft.assetId),
  };

  const ask = async (label: string, body: Record<string, unknown>) => {
    const result = await call(label, () => socialPost<AssistReply>('assist', { ...base, ...body }), 'Asystent AI nie odpowiedział. Spróbuj ponownie.');
    if (!result) return;
    setReply(result);
    if (result.photoNote) {
      setUsePhoto(false);
      Alert.alert('Asystent AI', result.photoNote);
    }
  };

  const hashtagHint = current.length < SOCIAL_HASHTAGS_RECOMMENDED.min
    ? `Dodaj kilka trafnych (zalecane ${SOCIAL_HASHTAGS_RECOMMENDED.min}–${SOCIAL_HASHTAGS_RECOMMENDED.max}).`
    : current.length > SOCIAL_HASHTAGS_RECOMMENDED.max ? `Najlepiej działa ${SOCIAL_HASHTAGS_RECOMMENDED.min}–${SOCIAL_HASHTAGS_RECOMMENDED.max} trafnych hashtagów.` : 'Liczba hashtagów w sam raz.';

  const photoToggle = (
    <View style={[styles.row, !draft.assetId && { opacity: 0.4 }]}>
      <Switch value={usePhoto && Boolean(draft.assetId)} disabled={!draft.assetId} onValueChange={setUsePhoto}
        trackColor={{ false: colors.background.secondary, true: `${colors.primary.gold}55` }} thumbColor={usePhoto && draft.assetId ? colors.primary.gold : colors.text.tertiary} />
      <Text style={[styles.muted, { flex: 1 }]}>{draft.assetId ? 'Uwzględnij zdjęcie (miniatura; tylko zdjęcie ze zgodą klienta)' : 'Uwzględnij zdjęcie — post nie ma zdjęcia'}</Text>
    </View>
  );

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Feather name="zap" size={16} color={colors.primary.gold} />
        <Text style={styles.title}>Asystent AI</Text>
      </View>
      <View style={styles.tabs}>
        {TABS.map(([key, label, icon]) => (
          <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
            onPress={() => { setTab(key); setReply(null); }}>
            <Feather name={icon} size={14} color={tab === key ? colors.primary.gold : colors.text.secondary} />
            <Text style={[styles.tabText, tab === key && { color: colors.primary.gold }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'write' && (
        <View style={{ gap: spacing.xs }}>
          <TextInput style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]} multiline value={topic} onChangeText={setTopic} maxLength={500}
            placeholder="O czym jest post? Np. jubileusz 30 lat marki, scena z ekranem LED (opcjonalnie)" placeholderTextColor={colors.text.tertiary} />
          <Text style={styles.label}>Cel</Text>
          <Chips options={SOCIAL_AI_GOALS} value={goal} onChange={setGoal} />
          <Text style={styles.label}>Ton</Text>
          <Chips options={SOCIAL_AI_TONES} value={tone} onChange={setTone} />
          <Text style={styles.label}>Długość</Text>
          <Chips options={SOCIAL_AI_LENGTHS} value={length} onChange={setLength} allowEmpty={false} />
          {photoToggle}
          <TouchableOpacity style={styles.button} onPress={() => void ask('Asystent AI pisze 3 wersje', { mode: 'write', topic, goal, tone, length })}>
            <Feather name="zap" size={16} color={colors.primary.gold} /><Text style={styles.buttonText}>Napisz 3 wersje</Text>
          </TouchableOpacity>
        </View>
      )}

      {tab === 'rewrite' && (
        <View style={{ gap: spacing.xs }}>
          {!hasCaption && <Text style={[styles.muted, { color: colors.status.warning }]}>Najpierw wpisz opis (albo skorzystaj z „Napisz”) — asystent go poprawi.</Text>}
          <View style={[styles.chips, !hasCaption && { opacity: 0.4 }]}>
            {(Object.keys(SOCIAL_AI_REWRITES) as SocialAiRewrite[]).map((key) => (
              <TouchableOpacity key={key} style={styles.chip} disabled={!hasCaption}
                onPress={() => void ask(`${SOCIAL_AI_REWRITES[key]} — asystent AI`, { mode: 'rewrite', rewrite: key })}>
                <Text style={styles.chipText}>{SOCIAL_AI_REWRITES[key]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} value={instruction} onChangeText={setInstruction} maxLength={300}
            placeholder="Własne polecenie, np. „podkreśl, że cała technika była nasza”" placeholderTextColor={colors.text.tertiary} />
          <TouchableOpacity style={[styles.button, (!hasCaption || !instruction.trim()) && { opacity: 0.4 }]} disabled={!hasCaption || !instruction.trim()}
            onPress={() => void ask('Asystent AI poprawia opis', { mode: 'rewrite', instruction })}>
            <Feather name="refresh-cw" size={16} color={colors.primary.gold} /><Text style={styles.buttonText}>Popraw według polecenia</Text>
          </TouchableOpacity>
        </View>
      )}

      {tab === 'hashtags' && (
        <View style={{ gap: spacing.xs }}>
          {photoToggle}
          <TouchableOpacity style={styles.button} onPress={() => void ask('Asystent AI dobiera hashtagi', { mode: 'hashtags', topic })}>
            <Feather name="hash" size={16} color={colors.primary.gold} /><Text style={styles.buttonText}>{reply?.mode === 'hashtags' ? 'Inne propozycje' : 'Dobierz hashtagi'}</Text>
          </TouchableOpacity>
          <Text style={[styles.muted, current.length > SOCIAL_LIMITS.hashtags && { color: colors.status.error }]}>
            W poście: {current.length}/{SOCIAL_LIMITS.hashtags}. {hashtagHint} Dotknij hashtagu, żeby go dodać albo usunąć.
          </Text>
          {reply?.mode === 'hashtags' && reply.hashtagGroups.map((group) => (
            <View key={group.key} style={{ gap: 4 }}>
              <Text style={styles.label}>{group.label}</Text>
              <View style={styles.chips}>
                {group.tags.map((tag) => {
                  const selected = current.some((item) => item.toLocaleLowerCase('pl') === tag.toLocaleLowerCase('pl'));
                  return (
                    <TouchableOpacity key={tag} style={[styles.chip, selected && styles.chipActive]} accessibilityState={{ selected }}
                      onPress={() => onHashtags(toggleHashtag(current, tag))}>
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{selected ? '✓ ' : ''}{tag}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}

      {reply && reply.mode !== 'hashtags' && reply.suggestions.map((suggestion, index) => (
        <View key={index} style={styles.suggestion}>
          {(suggestion.headline || suggestion.subline) ? (
            <Text style={[styles.body, { color: colors.primary.gold }]}>Na grafice: {suggestion.headline}{suggestion.subline ? ` · ${suggestion.subline}` : ''}</Text>
          ) : null}
          <Text style={styles.body}>{suggestion.caption}</Text>
          {suggestion.hashtags.length > 0 && <Text style={styles.muted}>{suggestion.hashtags.join(' ')}</Text>}
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <TouchableOpacity style={styles.smallButton} onPress={() => onUse(suggestion, false)}><Text style={styles.linkText}>Użyj opisu i hashtagów</Text></TouchableOpacity>
            {(suggestion.headline || suggestion.subline) ? (
              <TouchableOpacity style={styles.smallButton} onPress={() => onUse(suggestion, true)}><Text style={styles.linkText}>Użyj z tytułem na grafice</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
      ))}

      <Text style={styles.footnote}>
        Do AI trafia temat i opis z karty, rodzaj wydarzenia, miejsce, miesiąc i opis realizacji; nazwa wydarzenia i klient — tylko przy zgodzie
        klienta; zdjęcie — tylko gdy je uwzględnisz i ma zgodę klienta na publikację. Propozycje nie zmieniają posta, dopóki ich nie użyjesz.
        {reply?.usedPhoto ? ' Ta odpowiedź uwzględnia zdjęcie.' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.lg, padding: spacing.sm, gap: spacing.sm, backgroundColor: colors.background.secondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  label: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, marginTop: 4 },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  footnote: { color: colors.text.tertiary, fontSize: 11, lineHeight: 15 },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: colors.background.tertiary, borderRadius: borderRadius.md, padding: 3 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: borderRadius.sm },
  tabActive: { backgroundColor: colors.background.elevated },
  tabText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: `${colors.primary.gold}33` },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  chipTextActive: { color: colors.primary.gold },
  button: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  buttonText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  suggestion: { borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary, padding: spacing.sm, gap: 4 },
  smallButton: { paddingVertical: 4, paddingRight: spacing.sm },
  linkText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
});
