import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, ink, shade } from '../theme';
import { showcaseOfferConfigure } from '../lib/showcaseApi';
import { LedSectionGrid, StageDeckGrid } from './ConfiguratorGrids';
import type {
  ShowcaseConfigEdit, ShowcaseConfigNode, ShowcaseConfigPreset, ShowcaseConfigView, ShowcaseOfferConfiguration,
} from '../lib/showcaseShared';

/*
 * Konfigurator sceny i ekranu LED w „Ofercie ze spotkania” (tablet i telefon) — te same reguły co kreator ofert w CRM i na
 * Macu (`/bridge/native/v1/showcase?op=offerConfigure` → `modularConfigurator.ts`): rozmiar i wysokość podestu z doborem
 * wariantów, sekcje ekranu LED (kafelki 0,5 × 0,5 m), warianty i dodatki z drzewa sprzętu, cena zestawu. Każda zmiana idzie na
 * serwer (po kolei), który zwraca konfigurację i widok. Klient widzi ekran razem ze sprzedawcą — bez stawek części.
 * Na szerokim ekranie (tablet w poziomie) — ustawienia po lewej, podsumowanie zestawu po prawej.
 * Rozmiar podestu i układ sekcji LED wybiera się na siatce pod dotyk (`ConfiguratorGrids.tsx` — jak siatki w CRM i na Macu):
 * dotknięcie albo przeciągnięcie palcem; liczby obok zostają do dokładnego wpisania.
 */

export type ShowcaseConfiguratorTarget = {
  productId: string;
  productName: string;
  /** Zapisana konfiguracja (edycja pozycji) albo `null` — nowa z karty produktu. */
  snapshot: Record<string, unknown> | null;
  /** Liczba zestawów w ofercie (porównanie modułów LED). */
  quantity: number;
  /** Edytowana pozycja koszyka (`null` — nowa pozycja). */
  lineKey: string | null;
  /** Karta pokazu, z której otwarto konfigurator. */
  item: { id: string; title: string } | null;
};

const SKIRTS: Record<string, string> = { none: 'Bez skirtingu', front_sides: 'Przód i boki', all: 'Dookoła' };

const parseNumber = (value: string): number | '' => {
  const clean = value.replace(/\s/g, '').replace(',', '.');
  if (!clean) return '';
  const number = Number(clean);
  return Number.isFinite(number) ? number : '';
};
const shown = (value: number | null) => (value == null ? '' : String(value).replace('.', ','));

export default function ShowcaseConfigurator({ target, accent, surface, onClose, onSave }: {
  target: ShowcaseConfiguratorTarget | null;
  accent: string;
  surface: string;
  onClose: () => void;
  onSave: (configuration: ShowcaseOfferConfiguration, target: ShowcaseConfiguratorTarget) => void;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [config, setConfig] = useState<ShowcaseOfferConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const latest = useRef<ShowcaseOfferConfiguration | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);

  // Nowe otwarcie: nowa konfiguracja z produktu albo zapisana z pozycji (sprzęt i stawki pobiera serwer).
  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    latest.current = null;
    setConfig(null);
    setProblem('');
    if (!target) return;
    setBusy(true);
    showcaseOfferConfigure(target.snapshot ? { snapshot: target.snapshot, quantity: target.quantity } : { productId: target.productId, quantity: target.quantity })
      .then((value) => { if (current === generation.current) { latest.current = value; setConfig(value); } })
      .catch((cause) => { if (current === generation.current) setProblem(cause instanceof Error ? cause.message : 'Nie udało się otworzyć konfiguratora.'); })
      .finally(() => { if (current === generation.current) setBusy(false); });
  }, [target]);

  /** Zmiany po kolei (każda na konfiguracji po poprzedniej) — jak kontrolki konfiguratora w CRM. */
  const send = useCallback((edits: ShowcaseConfigEdit[], refresh = false) => {
    const current = generation.current;
    chain.current = chain.current.then(async () => {
      const base = latest.current;
      if (!base || current !== generation.current) return;
      setBusy(true);
      try {
        const next = await showcaseOfferConfigure({ snapshot: base.snapshot, edits, refresh, quantity: target?.quantity || 1 });
        if (current !== generation.current) return;
        latest.current = next;
        setConfig(next);
        setProblem('');
      } catch (cause) {
        if (current === generation.current) setProblem(cause instanceof Error ? cause.message : 'Nie udało się zapisać zmiany.');
      } finally {
        if (current === generation.current) setBusy(false);
      }
    });
  }, [target]);

  const edit = (op: string, fields: Record<string, unknown> = {}) => send([{ op, ...fields }]);
  const view = config?.view || null;
  const ready = Boolean(view && !view.error && view.calculatorTotal != null && !busy);

  const chip = (label: string, active: boolean, onPress: () => void, key?: string) => (
    <TouchableOpacity key={key || label} onPress={onPress} disabled={busy} style={[styles.chip, active && { borderColor: accent, backgroundColor: glow(0.08) }]}
      accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && { color: accent }]}>{label}</Text>
    </TouchableOpacity>
  );
  const toggle = (label: string, value: boolean, onChange: (value: boolean) => void, key?: string) => (
    <View key={key || label} style={styles.toggleRow}>
      <Text style={[styles.text, styles.flex]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} disabled={busy} trackColor={{ true: accent, false: shade(0.4) }} />
    </View>
  );
  const presets = (list: ShowcaseConfigPreset[], width: number | null, depth: number | null) => (
    <View style={styles.wrap}>
      {list.map((preset) => chip(preset.label, width === preset.width && depth === preset.depth,
        () => edit('size', { width: preset.width, depth: preset.depth }), preset.label))}
    </View>
  );

  /** Drzewo wyboru: warianty (jeden z grupy), dodatki opcjonalne, warianty dobrane do wysokości. */
  const node = (entry: ShowcaseConfigNode, depth: number): React.ReactNode => (
    <View key={entry.path} style={[styles.node, depth > 0 && styles.nodeChild]}>
      <View style={styles.row}>
        <Feather name={depth ? 'corner-down-right' : 'box'} size={14} color={colors.text.tertiary} />
        <Text style={[styles.text, styles.flex]}>{entry.name}</Text>
        {entry.detail ? <Text style={styles.muted}>{entry.detail} szt.</Text> : null}
      </View>
      {entry.groups.map((group) => (
        <View key={group.key} style={styles.group}>
          {group.kind === 'choice' ? (
            <>
              <Text style={styles.label}>{group.label}</Text>
              <View style={styles.wrap}>
                {group.placeholder === 'Bez dodatku' ? chip('Bez dodatku', !group.selected, () => edit('choice', { key: group.key, linkId: '' }), `${group.key}:none`) : null}
                {group.options.map((option) => chip(option.label, group.selected === option.id, () => edit('choice', { key: group.key, linkId: option.id }), option.id))}
              </View>
            </>
          ) : group.kind === 'optional' ? (
            toggle(group.label, group.enabled, (enabled) => edit('enabled', { key: group.key, enabled }), group.key)
          ) : (
            <Text style={group.kind === 'automatic' ? styles.hint : styles.muted}>{group.label}</Text>
          )}
          {group.children.map((child) => node(child, depth + 1))}
        </View>
      ))}
    </View>
  );

  const settings = (value: ShowcaseConfigView) => (
    <View style={styles.gap}>
      {value.loadError ? (
        <View style={[styles.card, styles.warning]}>
          <Text style={styles.text}>{value.loadError}</Text>
          <TouchableOpacity onPress={() => send([], true)} disabled={busy} style={[styles.button, { borderColor: accent }]}>
            <Feather name="refresh-cw" size={16} color={accent} /><Text style={[styles.buttonText, { color: accent }]}>Pobierz sprzęt ponownie</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {value.stage ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rozmiar podestu</Text>
          {presets(value.stage.presets, value.stage.width, value.stage.depth)}
          <StageDeckGrid width={value.stage.width} depth={value.stage.depth} accent={accent} disabled={busy}
            onChoose={(width, depth) => edit('size', { width, depth })} />
          <View style={styles.row}>
            <NumberField label="Szerokość (m)" value={value.stage.width} disabled={busy} onCommit={(number) => edit('width', { value: number })} />
            <NumberField label="Głębokość (m)" value={value.stage.depth} disabled={busy} onCommit={(number) => edit('depth', { value: number })} />
          </View>
          <Text style={styles.muted}>{value.stage.summary}</Text>
          <Text style={styles.sectionTitle}>Wysokość</Text>
          {value.stage.heightMessage ? <Text style={styles.muted}>{value.stage.heightMessage}</Text> : null}
          <View style={styles.wrap}>
            {value.stage.heightOptions.map((option) => chip(option.label, value.stage?.height === option.height, () => edit('height', { value: option.height }), option.label))}
          </View>
          <NumberField label="Wysokość (cm)" value={value.stage.height} disabled={busy} onCommit={(number) => edit('height', { value: number })} />
          {value.stage.showSkirt ? (
            <>
              <Text style={styles.label}>Skirting</Text>
              <View style={styles.wrap}>
                {['front_sides', 'all'].map((skirt) => chip(SKIRTS[skirt], value.stage?.skirt === skirt, () => edit('skirt', { value: skirt }), skirt))}
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {value.legacyStage ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Podest</Text>
          {presets(value.legacyStage.presets, value.legacyStage.width, value.legacyStage.depth)}
          <StageDeckGrid width={value.legacyStage.width} depth={value.legacyStage.depth} accent={accent} disabled={busy}
            onChoose={(width, depth) => edit('size', { width, depth })} />
          <View style={styles.row}>
            <NumberField label="Szerokość (m)" value={value.legacyStage.width} disabled={busy} onCommit={(number) => edit('width', { value: number })} />
            <NumberField label="Głębokość (m)" value={value.legacyStage.depth} disabled={busy} onCommit={(number) => edit('depth', { value: number })} />
          </View>
          <Text style={styles.label}>Wysokość</Text>
          <View style={styles.wrap}>
            {value.legacyStage.heights.map((height) => chip(`${height} cm`, value.legacyStage?.height === height, () => edit('height', { value: height }), String(height)))}
          </View>
          {value.legacyStage.heightMissing ? <Text style={styles.hint}>Wybierz jedną z dostępnych wysokości.</Text> : null}
          <Text style={styles.label}>Skirting</Text>
          <View style={styles.wrap}>
            {['none', 'front_sides', 'all'].map((skirt) => chip(SKIRTS[skirt], value.legacyStage?.skirt === skirt, () => edit('skirt', { value: skirt }), skirt))}
          </View>
          {toggle('Wykładzina', value.legacyStage.carpet, (enabled) => edit('carpet', { enabled }))}
          <View style={styles.row}>
            <Text style={[styles.text, styles.flex]}>Schody</Text>
            <Stepper value={value.legacyStage.stairs ?? 0} min={0} max={20} accent={accent} disabled={busy} onChange={(number) => edit('stairs', { value: number })} />
          </View>
          {value.legacyStage.accessories.map((accessory) => (
            <View key={accessory.id} style={styles.row}>
              <Text style={[styles.text, styles.flex]}>{accessory.name}</Text>
              <Stepper value={accessory.quantity ?? 0} min={0} max={999} accent={accent} disabled={busy} onChange={(number) => edit('accessoryQuantity', { id: accessory.id, value: number })} />
            </View>
          ))}
        </View>
      ) : null}

      {value.led ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Układ ekranu</Text>
          {!value.led.hasSections ? (
            <>
              <Text style={styles.muted}>Ekran składa się z sekcji z kafelków 0,5 × 0,5 m — podaj, ile kafelków w poziomie i w pionie.</Text>
              <TouchableOpacity onPress={() => edit('sectionsCreate')} disabled={busy} style={[styles.button, { borderColor: accent }]}>
                <Feather name="grid" size={16} color={accent} /><Text style={[styles.buttonText, { color: accent }]}>Ustaw sekcje ekranu</Text>
              </TouchableOpacity>
            </>
          ) : null}
          {value.led.sections.map((section) => (
            <View key={section.id} style={styles.card}>
              <View style={styles.row}>
                <SectionName value={section.name} disabled={busy} onCommit={(name) => edit('sectionSet', { id: section.id, name })} />
                {value.led && value.led.sections.length > 1 ? (
                  <TouchableOpacity onPress={() => edit('sectionRemove', { id: section.id })} disabled={busy} hitSlop={8} style={styles.iconButton} accessibilityLabel={`Usuń sekcję ${section.name}`}>
                    <Feather name="trash-2" size={16} color={colors.text.secondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={[styles.row, styles.wrapRow]}>
                <Text style={styles.muted}>W poziomie</Text>
                <Stepper value={section.columns ?? 1} min={1} max={200} accent={accent} disabled={busy} onChange={(number) => edit('sectionSet', { id: section.id, columns: number })} />
                <Text style={styles.muted}>W pionie</Text>
                <Stepper value={section.rows ?? 1} min={1} max={200} accent={accent} disabled={busy} onChange={(number) => edit('sectionSet', { id: section.id, rows: number })} />
              </View>
              <Text style={styles.muted}>{section.summary}</Text>
              <LedSectionGrid columns={section.columns} rows={section.rows} accent={accent} disabled={busy}
                onChoose={(columns, rows) => edit('sectionSet', { id: section.id, columns, rows })} />
            </View>
          ))}
          {value.led.canAdd ? (
            <TouchableOpacity onPress={() => edit('sectionAdd')} disabled={busy} style={[styles.button, { borderColor: accent }]}>
              <Feather name="plus" size={16} color={accent} /><Text style={[styles.buttonText, { color: accent }]}>Dodaj sekcję</Text>
            </TouchableOpacity>
          ) : null}
          {value.led.totals ? <Text style={styles.text}>{value.led.totals}</Text> : null}
          {value.led.notices.map((notice) => (
            <View key={notice.key} style={[styles.card, notice.warning && styles.warning]}>
              <Text style={styles.text}>{notice.group ? `${notice.group}: ` : ''}{notice.message}</Text>
              {notice.recommendation ? (
                <TouchableOpacity onPress={() => edit('choice', { key: notice.key, linkId: notice.recommendation?.id })} disabled={busy} style={[styles.button, { borderColor: accent }]}>
                  <Text style={[styles.buttonText, { color: accent }]}>Wybierz: {notice.recommendation.name}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {value.areaEditable ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Powierzchnia</Text>
          <NumberField label="Powierzchnia ekranu (m²)" value={value.area} disabled={busy} onCommit={(number) => edit('area', { value: number })} />
        </View>
      ) : null}

      {value.roots.map((root) => (
        <View key={root.id} style={styles.section}>
          <Text style={styles.sectionTitle}>{root.title}</Text>
          {root.optional ? toggle(root.optionalLabel, root.enabled, (enabled) => edit('rootEnabled', { id: root.id, enabled }), `${root.id}:on`) : null}
          {root.quantityEditable ? (
            <View style={styles.row}>
              <Text style={[styles.text, styles.flex]}>Ilość</Text>
              <Stepper value={root.quantity ?? 0} min={0} max={9999} accent={accent} disabled={busy} onChange={(number) => edit('rootQuantity', { id: root.id, value: number })} />
            </View>
          ) : null}
          {root.tree ? node(root.tree, 0) : null}
        </View>
      ))}

      {value.components ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Składniki zestawu</Text>
          {value.components.map((component) => (
            <View key={component.id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.text}>{component.name}</Text>
                <Text style={styles.muted}>{component.text}</Text>
              </View>
              {component.editable ? (
                <Stepper value={component.quantity ?? 0} min={0} max={9999} accent={accent} disabled={busy} onChange={(number) => edit('componentQuantity', { id: component.id, value: number })} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  const summary = (value: ShowcaseConfigView) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Zestaw</Text>
      <Text style={styles.heading}>{value.title}</Text>
      {value.scope.map((line, index) => <Text key={index} style={styles.muted}>• {line}</Text>)}
      {value.lines.length ? (
        <View style={styles.gapXs}>
          <Text style={styles.label}>Co zawiera</Text>
          {value.lines.map((line) => (
            <View key={line.key} style={styles.lineRow}>
              <Text style={[styles.text, styles.flex]} numberOfLines={2}>{line.name}</Text>
              <Text style={styles.muted}>{line.quantity}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {value.error ? <Text style={styles.hint}>{value.error}</Text> : null}
      <Text style={[styles.total, { color: accent }]}>{value.totalText}</Text>
      <Text style={styles.muted}>Ilość zestawów i dni ustawisz na liście pozycji oferty. Cena liczy się z aktualnych stawek sprzętu.</Text>
    </View>
  );

  return (
    <Modal visible={Boolean(target)} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']} presentationStyle="fullScreen">
      <SafeAreaView style={[styles.flex, { backgroundColor: surface }]} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.head}>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.iconButton} accessibilityLabel="Zamknij konfigurator"><Feather name="x" size={22} color={accent} /></TouchableOpacity>
            <View style={styles.flex}>
              <Text style={styles.heading} numberOfLines={1}>{view?.heading || target?.productName || 'Konfigurator'}</Text>
              <Text style={styles.muted} numberOfLines={1}>{target?.productName}</Text>
            </View>
            {busy ? <ActivityIndicator color={accent} /> : null}
          </View>
          {problem ? <Text style={[styles.banner, styles.error]}>{problem}</Text> : null}
          {view ? (
            wide ? (
              <View style={[styles.flex, styles.columns]}>
                <ScrollView style={styles.main} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{settings(view)}</ScrollView>
                <ScrollView style={styles.side} contentContainerStyle={styles.content}>{summary(view)}</ScrollView>
              </View>
            ) : (
              <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                {settings(view)}
                {summary(view)}
              </ScrollView>
            )
          ) : (
            <View style={styles.center}>{busy ? <ActivityIndicator color={accent} size="large" /> : <Text style={styles.muted}>{problem || 'Konfigurator niedostępny.'}</Text>}</View>
          )}
          <View style={styles.footer}>
            <TouchableOpacity onPress={onClose} style={styles.secondary}><Text style={[styles.buttonText, { color: accent }]}>Anuluj</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { if (config && target && ready) onSave(config, target); }} disabled={!ready}
              style={[styles.primary, { backgroundColor: accent }, !ready && styles.disabled]} accessibilityRole="button">
              <Feather name={target?.lineKey ? 'check' : 'plus'} size={18} color={surface} />
              <Text style={[styles.primaryText, { color: surface }]}>{target?.lineKey ? 'Zapisz konfigurację' : 'Dodaj do oferty'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/** Liczba z klawiatury (przecinek albo kropka) — zapis po zakończeniu edycji. */
function NumberField({ label, value, disabled, onCommit }: { label: string; value: number | null; disabled: boolean; onCommit: (value: number | '') => void }) {
  const [text, setText] = useState(shown(value));
  useEffect(() => { setText(shown(value)); }, [value]);
  const commit = () => {
    const parsed = parseNumber(text);
    if (parsed === '' ? value == null : parsed === value) return;
    onCommit(parsed);
  };
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={text} onChangeText={setText} onEndEditing={commit} onSubmitEditing={commit} editable={!disabled} keyboardType="decimal-pad"
        returnKeyType="done" placeholder="—" placeholderTextColor={ink(0.35)} style={styles.input} />
    </View>
  );
}

function SectionName({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => { const next = text.trim().slice(0, 100); if (next && next !== value) onCommit(next); else setText(value); };
  return (
    <TextInput value={text} onChangeText={setText} onEndEditing={commit} onSubmitEditing={commit} editable={!disabled} returnKeyType="done"
      style={[styles.input, styles.flex]} accessibilityLabel="Nazwa sekcji" />
  );
}

function Stepper({ value, min, max, accent, disabled, onChange }: { value: number; min: number; max: number; accent: string; disabled: boolean; onChange: (value: number) => void }) {
  const whole = Number.isFinite(value) ? Math.round(value) : min;
  return (
    <View style={styles.stepper}>
      <TouchableOpacity onPress={() => onChange(Math.max(min, whole - 1))} disabled={disabled || whole <= min} style={styles.stepperButton} accessibilityLabel="Mniej">
        <Feather name="minus" size={16} color={disabled || whole <= min ? colors.text.disabled : accent} />
      </TouchableOpacity>
      <Text style={styles.stepperValue}>{whole}</Text>
      <TouchableOpacity onPress={() => onChange(Math.min(max, whole + 1))} disabled={disabled || whole >= max} style={styles.stepperButton} accessibilityLabel="Więcej">
        <Feather name="plus" size={16} color={disabled || whole >= max ? colors.text.disabled : accent} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  columns: { flexDirection: 'row' },
  main: { flex: 3 },
  side: { flex: 2, borderLeftWidth: 1, borderLeftColor: glow(0.08) },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: glow(0.1) },
  banner: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  gap: { gap: spacing.md },
  gapXs: { gap: spacing.xs },
  section: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.xl, backgroundColor: shade(0.22), borderWidth: 1, borderColor: glow(0.08) },
  sectionTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  card: { gap: spacing.xs, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.08) },
  warning: { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.35)' },
  heading: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  label: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase', marginTop: spacing.xs },
  hint: { color: colors.status.warning, fontSize: typography.fontSizes.sm },
  error: { color: colors.status.error, fontSize: typography.fontSizes.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrapRow: { flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, borderWidth: 1, borderColor: glow(0.15), maxWidth: '100%' },
  chipText: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  node: { gap: spacing.xs },
  nodeChild: { marginLeft: spacing.md, paddingLeft: spacing.sm, borderLeftWidth: 1, borderLeftColor: glow(0.12) },
  group: { gap: spacing.xs, marginTop: spacing.xs },
  field: { flex: 1, gap: 4 },
  input: {
    minHeight: 46, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text.primary,
    fontSize: typography.fontSizes.md, backgroundColor: shade(0.3), borderWidth: 1, borderColor: glow(0.1),
  },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  total: { fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.semibold, marginTop: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: borderRadius.full, backgroundColor: shade(0.3) },
  stepperButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 44, textAlign: 'center', color: colors.text.primary, fontSize: typography.fontSizes.sm },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: shade(0.3) },
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1, alignSelf: 'flex-start' },
  buttonText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: glow(0.1) },
  secondary: { minHeight: 52, paddingHorizontal: spacing.lg, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: shade(0.3), borderWidth: 1, borderColor: glow(0.1) },
  primary: { flex: 1, minHeight: 52, borderRadius: borderRadius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  primaryText: { fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  disabled: { opacity: 0.4 },
});
