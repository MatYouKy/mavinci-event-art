import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { showcaseOfferAssumptionsAI } from '../lib/showcaseApi';
import { useContentWidth } from '../hooks/useTabletLayout';
import { colors, spacing, borderRadius, typography, glow, ink, shade } from '../theme';
import {
  EVENT_ASSUMPTION_AI_INSTRUCTIONS_MAX_LENGTH, EVENT_ASSUMPTION_OPTIONS, EVENT_ASSUMPTION_VALUE_MAX_LENGTH, EVENT_GOAL_MAX_LENGTH,
  getEventAssumptionOption, normalizeEventAssumptionItems, syncGuestCountAssumptions,
  type EventAssumptionItem, type EventAssumptionKey,
} from '../lib/eventAssumptions';
import { showcaseOfferAssumptionsFromDraft, type ShowcaseOfferAssumption, type ShowcaseOfferDraft } from '../lib/showcaseShared';

/*
 * „Założenia i cel” w ofercie ze spotkania (tablet i telefon) — te same trzy karty co w ofercie w CRM i na Macu (kategoria, własny
 * tytuł, treść, liczbowy znacznik w PDF) i cel eventu. „Zaproponuj z AI”: wskazówki sprzedawcy („Co chcesz osiągnąć?”) — serwer
 * (`op=offerAssumptionsAI`, ten sam co w CRM i na Macu) dokłada ustalenia zapytania, pozycje, termin, miejsce i notatkę ze spotkania
 * i woła `assist-inquiry` (`draft_offer_assumptions`, jak w kreatorze oferty; uprawnienie do edycji ofert sprawdza funkcja).
 * Karta liczby gości wypełnia się z pola „Liczba osób”. Bez wpisanych założeń oferta weźmie założenia i cel z zapytania.
 */

type Props = {
  /** Szkic oferty: karty, cel, liczba osób, zapytanie, pozycje, termin, miejsce i notatka (kontekst dla AI). */
  draft: ShowcaseOfferDraft;
  accent: string;
  surface: string;
  onChange: (assumptions: ShowcaseOfferAssumption[], goal: string) => void;
  notify: (text: string, error?: boolean) => void;
};

/**
 * Karty do edycji: zapisane w szkicu (bez przycinania spacji w trakcie pisania — porządkuje je serwer) albo domyślne
 * (liczba gości, godziny, przebieg i potrzeby klienta); karta liczby gości zawsze z pola „Liczba osób”.
 */
const toItems = (assumptions: ShowcaseOfferAssumption[], guestCount: number | null): EventAssumptionItem[] =>
  syncGuestCountAssumptions(
    assumptions.length === 3
      ? assumptions.map((item) => ({ key: item.key as EventAssumptionKey, label: item.label, value: item.value, badge_value: item.badge }))
      : normalizeEventAssumptionItems([]),
    guestCount,
  );

const fromItems = (items: EventAssumptionItem[]): ShowcaseOfferAssumption[] =>
  items.map((item) => ({ key: item.key, label: item.label, value: item.value, badge: item.badge_value || '' }));

export default function ShowcaseOfferAssumptions({ draft, accent, surface, onChange, notify }: Props) {
  const { assumptions, goal, inquiryId } = draft;
  const guestCount = draft.event.guestCount;
  const width = useContentWidth();
  const columns = width >= 960;
  const items = useMemo(() => toItems(assumptions, guestCount), [assumptions, guestCount]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [withGoal, setWithGoal] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [sources, setSources] = useState('');
  const lock = useRef(false);

  const save = (next: EventAssumptionItem[], nextGoal = goal) => onChange(fromItems(syncGuestCountAssumptions(next, guestCount)), nextGoal);
  const updateItem = (index: number, patch: Partial<EventAssumptionItem>) =>
    save(items.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  const changeKey = (index: number, key: EventAssumptionKey) => {
    const option = getEventAssumptionOption(key);
    const next = items.map((item, position) => (position === index ? {
      key,
      label: key === 'custom' ? '' : option.label,
      value: option.defaultValue || '',
      badge_value: option.defaultBadgeValue || '',
    } : item));
    save(next);
    setPickerFor(null);
  };

  const generate = async () => {
    if (lock.current) return;
    lock.current = true;
    setGenerating(true);
    setAiError('');
    try {
      // Karty w kolejności z ekranu (karta liczby gości z pola „Liczba osób”) — serwer zwraca je w tej samej kolejności.
      const proposal = await showcaseOfferAssumptionsAI({ ...draft, assumptions: fromItems(items) }, instructions.trim(), withGoal);
      const next = showcaseOfferAssumptionsFromDraft(proposal.items);
      if (next.length !== 3) throw new Error('AI nie przygotowało trzech kompletnych założeń. Spróbuj ponownie.');
      onChange(next, withGoal && proposal.goal ? proposal.goal.slice(0, EVENT_GOAL_MAX_LENGTH) : goal);
      setSources(proposal.sources || '');
      setAiOpen(false);
      notify(withGoal ? 'AI uzupełniło założenia i cel eventu — sprawdź je przed utworzeniem oferty.' : 'AI uzupełniło założenia — sprawdź je przed utworzeniem oferty.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setAiError((cause as { offline?: unknown } | null)?.offline === true
        ? 'Brak połączenia — propozycja AI wymaga internetu.'
        : message || 'Nie udało się przygotować założeń przez AI.');
    } finally {
      lock.current = false;
      setGenerating(false);
    }
  };

  const used = new Set(items.map((item) => item.key));
  const picking = pickerFor != null ? items[pickerFor] : null;

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title}>Założenia i cel</Text>
          <Text style={styles.muted}>Trzy najważniejsze informacje o realizacji — te same karty i znaczniki trafią do oferty PDF.</Text>
        </View>
        <TouchableOpacity onPress={() => { setAiError(''); setAiOpen(true); }} disabled={generating} hitSlop={8}
          style={[styles.aiButton, { borderColor: accent }, generating && styles.disabled]} accessibilityRole="button" accessibilityLabel="Zaproponuj założenia z AI">
          {generating ? <ActivityIndicator size="small" color={accent} /> : <Feather name="zap" size={16} color={accent} />}
          <Text style={[styles.buttonText, { color: accent }]}>{generating ? 'AI przygotowuje…' : 'Zaproponuj z AI'}</Text>
        </TouchableOpacity>
      </View>
      {inquiryId ? <Text style={styles.muted}>Puste karty — oferta weźmie założenia i cel z zapytania klienta.</Text> : null}
      {sources ? <Text style={styles.muted} accessibilityRole="text">{sources}</Text> : null}

      <View style={[styles.cards, columns && styles.cardsRow]}>
        {items.map((item, index) => {
          const option = getEventAssumptionOption(item.key);
          const guestLocked = item.key === 'guest_count';
          return (
            <View key={`${index}-${item.key}`} style={[styles.card, columns && styles.cardColumn]}>
              <TouchableOpacity onPress={() => setPickerFor(index)} style={styles.picker} accessibilityRole="button"
                accessibilityLabel={`Karta ${index + 1}: ${item.label || option.label}. Zmień kategorię`}>
                <View style={[styles.number, { backgroundColor: glow(0.15) }]}><Text style={[styles.numberText, { color: accent }]}>{index + 1}</Text></View>
                <Text style={[styles.text, styles.flex]} numberOfLines={1}>{item.key === 'custom' ? 'Własne założenie' : option.label}</Text>
                <Feather name="chevron-down" size={16} color={colors.text.tertiary} />
              </TouchableOpacity>
              {item.key === 'custom' ? (
                <TextInput value={item.label === option.label ? '' : item.label} onChangeText={(value) => updateItem(index, { label: value.slice(0, 80) })}
                  placeholder="Własny tytuł (np. Energia na parkiecie)" placeholderTextColor={ink(0.35)} style={styles.input} maxLength={80} />
              ) : null}
              {guestLocked ? (
                <Text style={[styles.muted, { color: accent }]}>
                  {guestCount ? `${guestCount} osób — z pola „Liczba osób” powyżej.` : 'Uzupełnij „Liczba osób” powyżej — karta wypełni się sama.'}
                </Text>
              ) : (
                <>
                  <TextInput value={item.badge_value || ''} onChangeText={(value) => updateItem(index, { badge_value: value.toLocaleUpperCase('pl-PL').slice(0, 7) })}
                    placeholder={`Znacznik w PDF, np. 180 (puste: 0${index + 1})`} placeholderTextColor={ink(0.35)} style={styles.input}
                    autoCapitalize="characters" maxLength={7} />
                  <TextInput value={item.value} onChangeText={(value) => updateItem(index, { value: value.slice(0, EVENT_ASSUMPTION_VALUE_MAX_LENGTH) })}
                    placeholder={option.placeholder || option.question} placeholderTextColor={ink(0.35)}
                    style={[styles.input, option.multiline && styles.multiline]} multiline={Boolean(option.multiline)} maxLength={EVENT_ASSUMPTION_VALUE_MAX_LENGTH} />
                  <View style={styles.counterRow}>
                    <Text style={[styles.muted, styles.flex]} numberOfLines={2}>{option.question}</Text>
                    <Text style={[styles.counter, item.value.length >= EVENT_ASSUMPTION_VALUE_MAX_LENGTH && { color: colors.status.warning }]}>
                      {item.value.length}/{EVENT_ASSUMPTION_VALUE_MAX_LENGTH}
                    </Text>
                  </View>
                </>
              )}
            </View>
          );
        })}
      </View>

      <Text style={styles.label}>Cel eventu</Text>
      <TextInput value={goal} onChangeText={(value) => save(items, value.slice(0, EVENT_GOAL_MAX_LENGTH))}
        placeholder="Co klient chce osiągnąć? (np. integracja zespołu i podziękowanie za rok pracy)" placeholderTextColor={ink(0.35)}
        style={[styles.input, styles.multiline]} multiline maxLength={EVENT_GOAL_MAX_LENGTH} />

      {/* Wybór kategorii karty */}
      <Modal visible={picking != null} transparent animationType="fade" onRequestClose={() => setPickerFor(null)} supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setPickerFor(null)} accessibilityLabel="Zamknij wybór kategorii" />
          <View style={[styles.sheet, { backgroundColor: surface }]}>
            <Text style={styles.title}>Kategoria karty {pickerFor != null ? pickerFor + 1 : ''}</Text>
            <ScrollView style={styles.optionList} contentContainerStyle={styles.gapXs}>
              {EVENT_ASSUMPTION_OPTIONS.map((option) => {
                const active = picking?.key === option.key;
                const blocked = option.key !== 'custom' && !active && used.has(option.key);
                return (
                  <TouchableOpacity key={option.key} disabled={blocked} onPress={() => pickerFor != null && changeKey(pickerFor, option.key)}
                    style={[styles.option, active && { borderColor: accent, backgroundColor: glow(0.08) }, blocked && styles.disabled]}
                    accessibilityRole="radio" accessibilityState={{ selected: active, disabled: blocked }}>
                    <View style={styles.flex}>
                      <Text style={[styles.text, active && { color: accent }]}>{option.key === 'custom' ? 'Własne założenie' : option.label}</Text>
                      <Text style={styles.muted} numberOfLines={1}>{blocked ? 'Już na innej karcie' : option.question}</Text>
                    </View>
                    {active ? <Feather name="check" size={18} color={accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Propozycja AI */}
      <Modal visible={aiOpen} transparent animationType="fade" onRequestClose={() => !generating && setAiOpen(false)} supportedOrientations={['portrait', 'landscape']}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => !generating && setAiOpen(false)} accessibilityLabel="Zamknij" />
          <View style={[styles.sheet, styles.aiSheet, { backgroundColor: surface }]}>
            <ScrollView contentContainerStyle={styles.gapSm} keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>Zaproponuj założenia z AI</Text>
              <Text style={styles.muted}>
                AI uzupełni trzy wybrane karty w tej samej kolejności — z {inquiryId ? 'ustaleń, analiz i korespondencji zapytania, ' : 'nazwy, terminu i miejsca eventu, '}pozycji oferty, notatki ze spotkania i Twoich wskazówek.
                Brakujące fakty oznaczy do doprecyzowania; propozycję sprawdzasz przed utworzeniem oferty.
              </Text>
              {items.map((item, index) => (
                <Text key={`${index}-${item.key}`} style={[styles.text, { color: accent }]}>{index + 1}. {item.label || getEventAssumptionOption(item.key).label}</Text>
              ))}
              <View style={styles.switchRow}>
                <Text style={[styles.text, styles.flex]}>Uzupełnij również cel eventu</Text>
                <Switch value={withGoal} onValueChange={setWithGoal} disabled={generating}
                  trackColor={{ false: shade(0.4), true: accent }} thumbColor={colors.white} accessibilityLabel="Uzupełnij również cel eventu" />
              </View>
              <Text style={styles.label}>Co chcesz osiągnąć? (opcjonalnie)</Text>
              <TextInput value={instructions} onChangeText={(value) => setInstructions(value.slice(0, EVENT_ASSUMPTION_AI_INSTRUCTIONS_MAX_LENGTH))}
                placeholder="Np. konferencja: podkreśl, że systemy liniowe dają każdemu na sali doskonały dźwięk. Ton profesjonalny, bez sloganów."
                placeholderTextColor={ink(0.35)} style={[styles.input, styles.multiline]} multiline editable={!generating}
                maxLength={EVENT_ASSUMPTION_AI_INSTRUCTIONS_MAX_LENGTH} autoFocus />
              <View style={styles.counterRow}>
                <Text style={[styles.muted, styles.flex]}>Puste pole — propozycja według bazowej instrukcji.</Text>
                <Text style={styles.counter}>{instructions.length}/{EVENT_ASSUMPTION_AI_INSTRUCTIONS_MAX_LENGTH}</Text>
              </View>
              <Text style={styles.muted}>Propozycja zastąpi treść trzech kart{withGoal ? ' i cel eventu' : ''}.</Text>
              {aiError ? <Text style={styles.error} accessibilityRole="alert">{aiError}</Text> : null}
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => setAiOpen(false)} disabled={generating} style={[styles.secondary, generating && styles.disabled]}>
                  <Text style={styles.text}>Anuluj</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void generate()} disabled={generating} style={[styles.primary, { backgroundColor: accent }, generating && styles.disabled]}>
                  {generating ? <ActivityIndicator color={surface} size="small" /> : <Feather name="zap" size={16} color={surface} />}
                  <Text style={[styles.buttonText, { color: surface }]}>{generating ? 'AI przygotowuje…' : 'Przygotuj propozycję'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gapSm: { gap: spacing.sm },
  gapXs: { gap: spacing.xs },
  section: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.xl, backgroundColor: shade(0.22), borderWidth: 1, borderColor: glow(0.08) },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  label: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase', marginTop: spacing.xs },
  error: { color: colors.status.error, fontSize: typography.fontSizes.sm },
  buttonText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  disabled: { opacity: 0.4 },
  aiButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1 },
  cards: { gap: spacing.sm },
  cardsRow: { flexDirection: 'row', alignItems: 'flex-start' },
  card: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.08) },
  cardColumn: { flex: 1 },
  picker: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  number: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  numberText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  input: {
    minHeight: 46, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text.primary,
    fontSize: typography.fontSizes.md, backgroundColor: shade(0.3), borderWidth: 1, borderColor: glow(0.1),
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  counterRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  counter: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  sheet: { width: '100%', maxWidth: 480, maxHeight: '86%', gap: spacing.sm, padding: spacing.lg, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: glow(0.1) },
  aiSheet: { maxWidth: 560 },
  optionList: { flexGrow: 0 },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.1) },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  secondary: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.15) },
  primary: { flex: 2, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: borderRadius.lg },
});
