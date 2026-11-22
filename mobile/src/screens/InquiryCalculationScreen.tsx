import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography, glow, ink, shade } from '../theme';
import { useContentWidth } from '../hooks/useTabletLayout';
import ReorderableList from '../components/ReorderableList';
import { openPdf } from '../lib/driveApi';
import {
  CALC_CATEGORIES, calcMoney, calcPdfLink, calcPlain, calcPower, calcWeight, generateCalcPdf, importCalcItems, lineGross, lineNet, linePayload,
  loadCalcEditor, removeCalcItem, removeCalculation, round2, saveCalculation,
  type CalcCategory, type CalcItemPayload, type CalcLine,
} from '../lib/inquiryCalculations';
import { navigateToContactMessage, navigateToEmailMessage, openInCrmWeb } from '../navigation/navigationRef';
import { NoticeScope, Sheet, SmallButton, afterModal, kit, useNotice } from '../components/Inquiries/InquiryKit';
import { ActionMenu } from '../components/Inquiries/WorkspaceSheets';
import { CalculationItemSheet } from '../components/Inquiries/CalculationItemSheet';
import { CalculationEmailSheet, CalculationImportSheet } from '../components/Inquiries/CalculationSheets';

/*
 * Edytor kalkulacji zapytania na tablecie — jak `CalculationEditor` z `inquiryContext` w CRM i edytor na Macu (kontekst zapytania
 * z boku): nazwa, sumy kategorii, pozycje w sekcjach Pozycje / Ludzie / Transport / Pozostałe (kolejność przeciąganiem za uchwyt ≡,
 * dotknięcie — edycja), notatki, pobór mocy i waga, netto / VAT / brutto; import z ofert zapytania, „Generuj PDF” (serwer CRM),
 * podgląd PDF, wysyłka e-mailem, usunięcie. Bez uprawnień do zapytania — tylko podgląd. API: `lib/inquiryCalculations.ts`.
 */

/** Kontekst zapytania obok edytora (`InquirySourceContextPanel`). */
export type CalcContext = {
  title: string;
  sourceLabel: string;
  client: { name: string; email: string; phone: string };
  items: Array<{ label: string; value: string }>;
  message: string;
  sourceHref: string | null;
};
export type InquiryCalculationParams = { inquiryId: string; calculationId: string; eventId: string | null; readOnly: boolean; context: CalcContext };

type ItemRequest = { category: CalcCategory; editing: CalcLine | null; key: number };
const SOURCE = /^\/crm\/messages\/([\da-f-]{36})\?type=(received|contact)$/i;

export default function InquiryCalculationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { inquiryId, calculationId, eventId, readOnly, context } = route.params as InquiryCalculationParams;
  const wide = useContentWidth() >= 1000;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [savedName, setSavedName] = useState('');
  const [savedNotes, setSavedNotes] = useState('');
  const [items, setItems] = useState<CalcLine[]>([]);
  const [orderChanged, setOrderChanged] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [request, setRequest] = useState<ItemRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lineMenu, setLineMenu] = useState<CalcLine | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState<{ action: unknown } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [contextOpen, setContextOpen] = useState(wide);
  const { notify, run, overlay, scope } = useNotice();
  const requestKey = useRef(0);
  const allowLeave = useRef(false);

  const working = saving || generating;
  const locked = working || readOnly;
  const pdfVisible = pdfReady && !orderChanged;
  const dirty = !readOnly && (orderChanged || name !== savedName || notes !== savedNotes);

  /** Po zmianie pozycji zachowuje niezapisaną kolejność (nowe pozycje na końcu sekcji). */
  const merged = useCallback((fresh: CalcLine[], current: CalcLine[], keepOrder: boolean) => {
    if (!keepOrder) return fresh;
    const order = new Map(current.map((line, index) => [line.id, index]));
    return fresh.map((line, index) => ({ line, rank: order.get(line.id) ?? 1_000_000 + index })).sort((a, b) => a.rank - b.rank).map((entry) => entry.line);
  }, []);

  const load = useCallback(async (initial: boolean) => {
    try {
      const data = await loadCalcEditor(inquiryId, calculationId);
      if (initial) {
        setName(data.name); setNotes(data.notes); setSavedName(data.name); setSavedNotes(data.notes); setPdfReady(Boolean(data.pdf)); setItems(data.items);
      } else {
        setItems((current) => merged(data.items, current, orderChanged));
      }
      setLoaded(true);
      setLoadError('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Nie udało się wczytać kalkulacji';
      if (initial) setLoadError(message); else notify(message, true);
    }
  }, [inquiryId, calculationId, merged, orderChanged, notify]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(true); }, [inquiryId, calculationId]);

  // Niezapisane zmiany (nazwa, notatki, kolejność) — pytanie przed wyjściem z edytora (także gestem i przyciskiem systemowym).
  useEffect(() => navigation.addListener('beforeRemove', (event: { preventDefault: () => void; data: { action: unknown } }) => {
    if (!dirty || allowLeave.current) return;
    event.preventDefault();
    setLeaving({ action: event.data.action });
  }), [navigation, dirty]);
  const leave = (action?: unknown) => {
    allowLeave.current = true;
    if (action) navigation.dispatch(action);
    else if (navigation.canGoBack()) navigation.goBack();
  };

  const lines = (category: CalcCategory) => items.filter((line) => line.category === category);
  /** Kolejność w obrębie sekcji; zapis przyciskiem „Zapisz”. */
  const reorder = (category: CalcCategory, from: number, to: number) => {
    if (working) return;
    const group = lines(category);
    const [moved] = group.splice(from, 1);
    if (!moved) return;
    group.splice(to, 0, moved);
    let index = 0;
    const next = items.map((line) => (line.category === category ? group[index++] : line));
    if (next.map((line) => line.id).join() === items.map((line) => line.id).join()) return;
    setItems(next);
    setOrderChanged(true);
  };

  const save = async (): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      const reply = await run('Zapisywanie…', () => saveCalculation(inquiryId, calculationId, {
        name, notes, orderChanged, items: items.map(linePayload),
      }), 'Zapisano kalkulację');
      if (!reply) return false;
      setOrderChanged(false); setPdfReady(false); setSavedName(name); setSavedNotes(notes);
      return true;
    } finally {
      setSaving(false);
    }
  };
  const removeLine = async (line: CalcLine) => {
    const reply = await run('Usuwanie pozycji…', () => removeCalcItem(inquiryId, calculationId, line.id));
    if (reply) { setItems((current) => current.filter((entry) => entry.id !== line.id)); setPdfReady(false); }
  };
  const importItems = async (picked: CalcItemPayload[]) => {
    const reply = await run('Importowanie pozycji…', () => importCalcItems(inquiryId, calculationId, picked));
    if (!reply) return false;
    if (reply.count > 0) notify(`Zaimportowano ${reply.count} pozycji`);
    setPdfReady(false);
    await load(false);
    return true;
  };
  /** „Generuj PDF”: zapis, potem dokument z zapisanej rewizji — na serwerze CRM, plik przy zapytaniu. */
  const generate = async () => {
    if (!items.length) { notify('Kalkulacja nie zawiera pozycji'); return; }
    setGenerating(true);
    try {
      if (!(await save())) return;
      const reply = await run('Generuję PDF kalkulacji na serwerze…', () => generateCalcPdf(inquiryId, calculationId),
        eventId ? 'PDF kalkulacji zapisany w plikach eventu' : 'PDF kalkulacji zapisany przy zapytaniu');
      if (reply) setPdfReady(true);
    } finally {
      setGenerating(false);
    }
  };
  const showPdf = async () => {
    try {
      const file = await calcPdfLink(inquiryId, calculationId, true);
      openPdf(navigation, file.url, name || file.name);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Nie udało się odczytać PDF kalkulacji.';
      if (message.includes('zmieniła się')) setPdfReady(false);
      notify(message, true);
    }
  };
  const remove = async () => {
    const reply = await run('Usuwanie…', () => removeCalculation(inquiryId, calculationId), 'Kalkulacja została usunięta');
    if (reply) { setDeleting(false); leave(); }
  };
  const openSource = () => {
    if (!context.sourceHref) return;
    const match = SOURCE.exec(context.sourceHref);
    if (match) (match[2].toLowerCase() === 'received' ? navigateToEmailMessage : navigateToContactMessage)(match[1]);
    else openInCrmWeb(context.sourceHref);
  };
  const openItem = (category: CalcCategory, editing: CalcLine | null) => {
    if (locked) return;
    requestKey.current += 1;
    setRequest({ category, editing, key: requestKey.current });
  };

  if (!loaded) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => leave()} style={styles.back}><Feather name="chevron-left" size={20} color={colors.primary.gold} /><Text style={kit.secondaryText}>Karta zapytania</Text></TouchableOpacity>
        <View style={styles.center}>
          {loadError ? (
            <>
              <Feather name="alert-triangle" size={32} color={colors.status.warning} />
              <Text style={kit.text}>Nie udało się wczytać kalkulacji</Text>
              <Text style={kit.muted}>{loadError}</Text>
              <TouchableOpacity onPress={() => void load(true)} style={kit.secondary}><Text style={kit.secondaryText}>Spróbuj ponownie</Text></TouchableOpacity>
            </>
          ) : <><ActivityIndicator size="large" color={colors.primary.gold} /><Text style={kit.muted}>Wczytywanie…</Text></>}
        </View>
      </View>
    );
  }

  const grandNet = round2(items.reduce((sum, line) => sum + lineNet(line), 0));
  const grandGross = round2(items.reduce((sum, line) => sum + lineGross(line), 0));
  const totalPower = items.reduce((sum, line) => sum + (line.power ?? 0) * line.quantity, 0);
  const totalWeight = items.reduce((sum, line) => sum + (line.weight ?? 0) * line.quantity, 0);

  const contextPanel = (
    <View style={styles.context}>
      <TouchableOpacity onPress={() => setContextOpen((value) => !value)} style={kit.between} accessibilityRole="button" accessibilityState={{ expanded: contextOpen }}>
        <View style={kit.flex}>
          <Text style={[kit.text, styles.strong]}>Kontekst zapytania</Text>
          <Text style={kit.muted} numberOfLines={1}>{context.title}</Text>
        </View>
        <Feather name={contextOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.tertiary} />
      </TouchableOpacity>
      {contextOpen ? (
        <View style={kit.gapSm}>
          {context.sourceLabel ? <Text style={[kit.muted, { color: colors.primary.gold }]}>Źródło: {context.sourceLabel}</Text> : null}
          {context.client.name ? <View style={styles.inline}><Feather name="user" size={14} color={colors.text.tertiary} /><Text style={kit.text}>{context.client.name}</Text></View> : null}
          {context.client.email ? (
            <TouchableOpacity onPress={() => void Linking.openURL(`mailto:${context.client.email}`).catch(() => undefined)} style={styles.inline}>
              <Feather name="mail" size={14} color={colors.primary.gold} /><Text style={kit.link}>{context.client.email}</Text>
            </TouchableOpacity>
          ) : null}
          {context.client.phone ? (
            <TouchableOpacity onPress={() => void Linking.openURL(`tel:${context.client.phone.replace(/[^\d+]/g, '')}`).catch(() => undefined)} style={styles.inline}>
              <Feather name="phone" size={14} color={colors.primary.gold} /><Text style={kit.link}>{context.client.phone}</Text>
            </TouchableOpacity>
          ) : null}
          {context.items.length ? (
            <View style={styles.contextBox}>
              {context.items.map((item) => <Text key={item.label} style={kit.muted}><Text style={kit.text}>{item.label}: </Text>{item.value}</Text>)}
            </View>
          ) : null}
          <Text style={kit.fieldLabel}>Treść wiadomości</Text>
          <View style={styles.contextBox}><Text style={kit.muted} selectable>{context.message || 'Brak zapisanej treści źródłowej.'}</Text></View>
          {context.sourceHref ? (
            <TouchableOpacity onPress={openSource}><Text style={kit.link}>{context.sourceHref.startsWith('/crm/tenders') ? 'Otwórz przetarg' : 'Otwórz wiadomość źródłową'}</Text></TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const row = (line: CalcLine, handle: React.ReactNode) => {
    const warehouse = line.source === 'warehouse' && Boolean(line.sourceRef);
    const exceeded = warehouse && line.stock != null && line.quantity > line.stock;
    const transport = line.category === 'transport';
    return (
      <View style={styles.line}>
        {!readOnly ? handle : null}
        <TouchableOpacity onPress={() => openItem(line.category, line)} disabled={locked} style={styles.lineMain} accessibilityRole="button" accessibilityLabel={`Edytuj pozycję ${line.name}`}>
          {warehouse ? (
            <View>
              {line.thumbnail ? <Image source={{ uri: line.thumbnail }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]}><Feather name="package" size={16} color={colors.text.tertiary} /></View>}
              {exceeded ? <Feather name="alert-triangle" size={14} color={colors.status.warning} style={styles.thumbAlert} /> : null}
            </View>
          ) : null}
          <View style={kit.flex}>
            <Text style={[kit.text, styles.strong]} numberOfLines={2}>{line.name || '—'}</Text>
            {line.description ? <Text style={kit.muted} numberOfLines={2}>{line.description}</Text> : null}
            {line.source === 'vehicle' && line.sourceLabel ? <Text style={kit.muted}>Wewnętrznie: {line.sourceLabel}</Text> : null}
            <Text style={kit.muted}>
              {calcPlain(line.quantity)} {line.unit} × {transport ? `${calcPlain(line.days)} km` : `${calcPlain(line.days)} dni`} × {calcMoney(line.unitPrice)} zł · VAT {calcPlain(line.vat)}%
              {exceeded ? ` · przekroczono stan (${calcPlain(line.stock ?? 0)})` : ''}
            </Text>
          </View>
          <View style={styles.amounts}>
            <Text style={kit.text}>{calcMoney(lineNet(line))}</Text>
            <Text style={[kit.muted, { color: colors.primary.gold }]}>{calcMoney(lineGross(line))}</Text>
          </View>
        </TouchableOpacity>
        {!readOnly ? (
          <TouchableOpacity onPress={() => setLineMenu(line)} disabled={locked} style={kit.iconButton} accessibilityLabel={`Czynności pozycji ${line.name}`}>
            <Feather name="more-horizontal" size={18} color={colors.text.secondary} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const editor = (
    <View style={kit.gapSm}>
      <View style={styles.cards}>
        {CALC_CATEGORIES.map((category) => {
          const group = lines(category.id);
          return (
            <View key={category.id} style={[styles.card, wide && styles.cardWide]}>
              <View style={styles.inline}><Feather name={category.icon} size={15} color={colors.text.tertiary} /><Text style={kit.muted}>{category.label}</Text></View>
              <Text style={styles.cardValue}>{calcMoney(group.reduce((sum, line) => sum + lineNet(line), 0))} netto</Text>
              <Text style={[kit.muted, { color: colors.primary.gold }]}>{calcMoney(group.reduce((sum, line) => sum + lineGross(line), 0))} brutto</Text>
              <Text style={kit.muted}>{group.length} pozycji</Text>
            </View>
          );
        })}
      </View>
      <Text style={kit.muted}>{readOnly ? 'Kalkulacja tylko do podglądu.' : 'Przeciągnij pozycję za uchwyt ≡, aby zmienić kolejność w sekcji. Dotknij „Zapisz”, aby ją zachować.'}</Text>
      {orderChanged ? <Text style={[kit.muted, { color: colors.primary.gold }]}>Kolejność została zmieniona. Po zapisaniu wygeneruj ponownie PDF przed wysyłką.</Text> : null}
      {CALC_CATEGORIES.map((category) => {
        const group = lines(category.id);
        return (
          <View key={category.id} style={styles.section}>
            <View style={kit.between}>
              <View style={styles.inline}>
                <Feather name={category.icon} size={17} color={colors.primary.gold} />
                <Text style={styles.sectionTitle}>{category.label}</Text>
                <Text style={kit.muted}>({group.length})</Text>
              </View>
              {!readOnly ? <SmallButton label="Dodaj" icon="plus" disabled={working} onPress={() => openItem(category.id, null)} /> : null}
            </View>
            {!group.length ? <Text style={[kit.muted, styles.empty]}>Brak pozycji</Text> : (
              <ReorderableList items={group} keyOf={(line) => line.id} disabled={locked} gap={spacing.xs} onDragChange={setDragging}
                onMove={(from, to) => reorder(category.id, from, to)} renderItem={(line, _index, handle) => row(line, handle)} />
            )}
          </View>
        );
      })}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notatki</Text>
        <TextInput value={notes} onChangeText={(value) => { setNotes(value); setPdfReady(false); }} editable={!locked} multiline style={[kit.input, kit.multiline]}
          placeholder="Dodatkowe uwagi do kalkulacji…" placeholderTextColor={ink(0.35)} />
      </View>
      <View style={styles.totals}>
        {totalPower > 0 ? (
          <View style={styles.metric}>
            <Feather name="zap" size={16} color={colors.status.warning} />
            <View>
              <Text style={kit.fieldLabel}>Pobór mocy</Text>
              <Text style={[kit.text, { color: colors.status.warning }]}>{calcPower(totalPower)}</Text>
              <Text style={kit.muted}>1f / 230V: {calcPlain(round2(totalPower / 230), 1)} A · 3f / 400V: {calcPlain(round2(totalPower / (400 * 1.732)), 1)} A</Text>
            </View>
          </View>
        ) : null}
        {totalWeight > 0 ? (
          <View style={styles.metric}>
            <Feather name="anchor" size={16} color={colors.status.info} />
            <View><Text style={kit.fieldLabel}>Waga</Text><Text style={[kit.text, { color: colors.status.info }]}>{calcWeight(totalWeight)}</Text></View>
          </View>
        ) : null}
        <View style={kit.flex} />
        <View style={styles.total}><Text style={kit.fieldLabel}>Netto</Text><Text style={styles.totalValue}>{calcMoney(grandNet)} PLN</Text></View>
        <View style={styles.total}><Text style={kit.fieldLabel}>VAT</Text><Text style={[styles.totalValue, { color: colors.text.secondary }]}>{calcMoney(round2(grandGross - grandNet))} PLN</Text></View>
        <View style={styles.total}><Text style={[kit.fieldLabel, { color: colors.primary.gold }]}>Brutto</Text><Text style={[styles.totalValue, styles.gross]}>{calcMoney(grandGross)} PLN</Text></View>
      </View>
    </View>
  );

  return (
    <NoticeScope value={scope}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => leave()} style={styles.back} accessibilityLabel="Wróć do karty zapytania">
            <Feather name="chevron-left" size={20} color={colors.primary.gold} /><Text style={kit.secondaryText}>Karta zapytania</Text>
          </TouchableOpacity>
          <View style={styles.headerRow}>
            <TextInput value={name} onChangeText={(value) => { setName(value); setPdfReady(false); }} editable={!locked} style={[kit.input, styles.name]}
              placeholder="Nazwa kalkulacji" placeholderTextColor={ink(0.35)} />
            {readOnly ? <Text style={kit.muted}>Tylko podgląd</Text> : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
            {!readOnly ? (
              <TouchableOpacity onPress={() => void save()} disabled={working} style={[kit.primary, working && kit.disabled]}>
                {saving ? <ActivityIndicator color={colors.background.primary} /> : <Feather name="check" size={17} color={colors.background.primary} />}
                <Text style={kit.primaryText}>{saving ? 'Zapisywanie…' : 'Zapisz'}</Text>
              </TouchableOpacity>
            ) : null}
            {!readOnly ? (
              <TouchableOpacity onPress={() => void generate()} disabled={working} style={[kit.secondary, working && kit.disabled]}>
                <Feather name="file-text" size={17} color={colors.primary.gold} /><Text style={kit.secondaryText}>{generating ? 'Generuję…' : 'Generuj PDF'}</Text>
              </TouchableOpacity>
            ) : null}
            {pdfVisible ? (
              <TouchableOpacity onPress={() => void showPdf()} disabled={working} style={[kit.secondary, working && kit.disabled]}>
                <Feather name="eye" size={17} color={colors.primary.gold} /><Text style={kit.secondaryText}>Podgląd PDF</Text>
              </TouchableOpacity>
            ) : null}
            {!readOnly ? (
              <TouchableOpacity onPress={() => setImportOpen(true)} disabled={working} style={[kit.secondary, working && kit.disabled]}>
                <Feather name="download" size={17} color={colors.primary.gold} /><Text style={kit.secondaryText}>Importuj z oferty</Text>
              </TouchableOpacity>
            ) : null}
            {!readOnly ? (
              <TouchableOpacity onPress={() => setMenuOpen(true)} disabled={working} style={[kit.secondary, working && kit.disabled]}>
                <Feather name="more-horizontal" size={17} color={colors.primary.gold} /><Text style={kit.secondaryText}>Więcej</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>
        <View style={styles.body}>
          {wide ? <ScrollView style={styles.side} contentContainerStyle={styles.sideContent}>{contextPanel}</ScrollView> : null}
          <ScrollView style={kit.flex} contentContainerStyle={styles.content} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled">
            {!wide ? contextPanel : null}
            {editor}
          </ScrollView>
        </View>

        {request ? (
          <CalculationItemSheet key={request.key} inquiryId={inquiryId} calculationId={calculationId} category={request.category} editing={request.editing} existing={items}
            onClose={() => setRequest(null)}
            onSaved={(message) => { setRequest(null); setPdfReady(false); if (message) notify(message); void load(false); }} />
        ) : null}
        {importOpen ? (
          <CalculationImportSheet inquiryId={inquiryId} existingRefs={items.map((line) => line.sourceRef).filter((ref): ref is string => Boolean(ref))}
            onClose={() => setImportOpen(false)} onImport={importItems} />
        ) : null}
        {emailOpen ? (
          <CalculationEmailSheet inquiryId={inquiryId} calculationId={calculationId} name={name} hasEvent={Boolean(eventId)} onClose={() => setEmailOpen(false)}
            onSent={(message) => { setEmailOpen(false); notify(message); }} />
        ) : null}
        <ActionMenu visible={menuOpen} title="Kalkulacja" subtitle={name} onClose={() => setMenuOpen(false)}
          items={[
            { key: 'email', label: 'Wyślij email', icon: 'mail', detail: pdfVisible ? 'Aktualny PDF w załączniku' : 'Najpierw wygeneruj PDF kalkulacji' },
            ...(pdfVisible ? [{ key: 'pdf', label: 'Podgląd i udostępnianie PDF', icon: 'file' as const }] : []),
            { key: 'delete', label: 'Usuń kalkulację', icon: 'trash-2', danger: true },
          ]}
          onPick={(key) => {
            if (key === 'email') { if (pdfVisible) setEmailOpen(true); else notify('Najpierw wygeneruj PDF kalkulacji'); }
            else if (key === 'pdf') void showPdf();
            else if (key === 'delete') setDeleting(true);
          }} />
        <ActionMenu visible={Boolean(lineMenu)} title="Pozycja" subtitle={lineMenu?.name} onClose={() => setLineMenu(null)}
          items={[{ key: 'edit', label: 'Edytuj', icon: 'edit-2' }, { key: 'remove', label: 'Usuń', icon: 'trash-2', danger: true }]}
          onPick={(key) => {
            const line = lineMenu;
            if (!line) return;
            if (key === 'edit') openItem(line.category, line);
            else void removeLine(line);
          }} />
        <Sheet visible={deleting} title="Usunąć kalkulację?" subtitle={name} onClose={() => setDeleting(false)} width={480}
          footer={(
            <>
              <TouchableOpacity onPress={() => { setDeleting(false); notify('Anulowano usuwanie kalkulacji'); }} style={kit.secondary}><Text style={kit.secondaryText}>Anuluj</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => void remove()} style={kit.danger}><Text style={kit.dangerText}>Usuń</Text></TouchableOpacity>
            </>
          )}>
          <Text style={kit.text}>Tej operacji nie można cofnąć.</Text>
        </Sheet>
        <Sheet visible={Boolean(leaving)} title="Niezapisane zmiany" subtitle="Nazwa, notatki albo kolejność pozycji nie zostały zapisane." onClose={() => setLeaving(null)} width={520}
          footer={(
            <>
              <TouchableOpacity onPress={() => setLeaving(null)} style={kit.secondary}><Text style={kit.secondaryText}>Zostań</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { const action = leaving?.action; setLeaving(null); afterModal(() => leave(action)); }} style={kit.secondary}>
                <Text style={[kit.secondaryText, { color: colors.status.error }]}>Odrzuć zmiany</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={async () => { const action = leaving?.action; setLeaving(null); if (await save()) afterModal(() => leave(action)); }} style={kit.primary}>
                <Text style={kit.primaryText}>Zapisz i wróć</Text>
              </TouchableOpacity>
            </>
          )}>
          <Text style={kit.text}>Zapisać zmiany przed wyjściem z edytora?</Text>
        </Sheet>
        {overlay}
      </View>
    </NoticeScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  header: { gap: spacing.xs, paddingTop: spacing.xs, paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: glow(0.08) },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  name: { flex: 1, maxWidth: 560, fontSize: typography.fontSizes.lg },
  actions: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  body: { flex: 1, flexDirection: 'row' },
  side: { width: 340, flexGrow: 0, borderRightWidth: 1, borderRightColor: glow(0.08) },
  sideContent: { padding: spacing.md },
  content: { padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.sm },
  context: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.15), backgroundColor: glow(0.04) },
  contextBox: { gap: 4, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: glow(0.04) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  strong: { fontWeight: typography.fontWeights.semibold },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { width: '48%', flexGrow: 1, gap: 2, padding: spacing.sm + 2, borderRadius: borderRadius.lg, backgroundColor: shade(0.2) },
  cardWide: { width: '23%' },
  cardValue: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  section: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: glow(0.03) },
  sectionTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold },
  empty: { textAlign: 'center', paddingVertical: spacing.sm },
  line: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: glow(0.06),
  },
  lineMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52 },
  thumb: { width: 40, height: 40, borderRadius: borderRadius.md, backgroundColor: glow(0.06) },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbAlert: { position: 'absolute', right: -4, bottom: -4 },
  amounts: { alignItems: 'flex-end', minWidth: 110 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: glow(0.08) },
  metric: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  total: { alignItems: 'flex-end' },
  totalValue: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  gross: { color: colors.primary.gold, fontSize: typography.fontSizes.xxl },
});
