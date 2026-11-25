import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, ink } from '../../theme';
import { formatInquiryFull, plannedAt } from '../../lib/inquiryFunnel';
import {
  CALC_CATEGORIES, calcEmailPreview, calcMoney, calcPlain, loadCalcEmailSetup, loadCalcImportSources, sendCalcEmail,
  type CalcCategory, type CalcEmailSetup, type CalcImportSources, type CalcItemPayload,
} from '../../lib/inquiryCalculations';
import { DateTimeField, Label, Segmented, SelectField, Sheet, SmallButton, kit } from './InquiryKit';
import RecipientInput from '../RecipientInput';

/*
 * Okna edytora kalkulacji na tablecie: „Importuj z oferty” (`ImportFromOfferModal`: produkty ofert zapytania, zawartość —
 * sprzęt i ludzie z produktów, pojazdy wydarzenia zapytania; kategoria produktu do zmiany, już zaimportowane oznaczone)
 * i „Wyślij kalkulację przez email” (`SendCalculationEmailModal`: aktualny PDF w załączniku, pliki wydarzenia, podgląd ze
 * stopką skrzynki, wysyłka teraz albo zaplanowana).
 */

type ImportMode = 'products' | 'contents' | 'transport';
const draft = (category: CalcCategory, name: string, description: string, unit: string, quantity: number, unitPrice: number, ref: string, vat: number): CalcItemPayload => ({
  category, name, description, unit, quantity, unitPrice, days: 1, source: 'offer', sourceRef: ref, vat, power: null, weight: null, transportEstimate: null,
});

export function CalculationImportSheet({ inquiryId, existingRefs, onClose, onImport }: {
  inquiryId: string; existingRefs: string[]; onClose: () => void; onImport: (items: CalcItemPayload[]) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<ImportMode>('products');
  const [sources, setSources] = useState<CalcImportSources | null>(null);
  const [loadError, setLoadError] = useState('');
  const [categories, setCategories] = useState<Record<string, CalcCategory>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let active = true;
    loadCalcImportSources(inquiryId).then((reply) => { if (active) setSources(reply); })
      .catch((cause) => { if (active) setLoadError(cause instanceof Error ? cause.message : 'Nie udało się pobrać ofert zapytania.'); });
    return () => { active = false; };
  }, [inquiryId]);

  const refsOf = (value: ImportMode) => !sources ? [] : value === 'products' ? sources.products.map((row) => row.ref)
    : value === 'contents' ? [...sources.equipment.map((row) => row.ref), ...sources.staff.map((row) => row.ref)] : sources.vehicles.map((row) => row.ref);
  const visibleRefs = refsOf(mode);
  const selectedHere = picked.filter((ref) => visibleRefs.includes(ref));
  const toggle = (ref: string) => setPicked((current) => (current.includes(ref) ? current.filter((entry) => entry !== ref) : [...current, ref]));
  /** „Zaznacz wszystkie” — drugi raz odznacza, gdy zaznaczone są już wszystkie dostępne (jak w CRM). */
  const toggleAll = () => {
    const available = visibleRefs.filter((ref) => !existingRefs.includes(ref));
    setPicked((current) => {
      const rest = current.filter((ref) => !visibleRefs.includes(ref));
      return selectedHere.length === available.length ? rest : [...rest, ...available];
    });
  };
  const run = async () => {
    if (!sources || importing) return;
    const items: CalcItemPayload[] = [];
    if (mode === 'products') {
      for (const row of sources.products) if (selectedHere.includes(row.ref)) {
        items.push(draft(categories[row.ref] || row.category, row.name, row.description, row.unit || 'szt.', row.quantity, row.unitPrice, row.ref, row.vat));
      }
    } else if (mode === 'contents') {
      for (const row of sources.equipment) if (selectedHere.includes(row.ref)) {
        items.push(draft('equipment', row.name, row.productName ? `Z produktu: ${row.productName}` : '', row.isKit ? 'zest.' : 'szt.', row.quantity, row.rentalPrice, row.ref, 23));
      }
      for (const row of sources.staff) if (selectedHere.includes(row.ref)) {
        const total = row.hourlyRate * row.estimatedHours;
        items.push(draft('staff', row.role, row.productName ? `Z produktu: ${row.productName}` : '', 'os.', row.quantity, total > 0 ? total : row.hourlyRate, row.ref, 23));
      }
    } else {
      for (const row of sources.vehicles) if (selectedHere.includes(row.ref)) {
        items.push(draft('transport', row.vehicleName, `${row.role}${row.driverName ? ` — kierowca: ${row.driverName}` : ''}`, 'kurs', 1, (row.fuelCost || 0) + (row.tollCost || 0), row.ref, 23));
      }
    }
    if (!items.length) return;
    setImporting(true);
    try { if (await onImport(items)) onClose(); } finally { setImporting(false); }
  };

  const check = (ref: string, title: string, detail: string, extra?: React.ReactNode) => {
    const done = existingRefs.includes(ref);
    const on = picked.includes(ref);
    return (
      <View key={ref} style={[styles.row, on && styles.rowActive]}>
        <TouchableOpacity onPress={() => toggle(ref)} style={styles.rowMain} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
          <Feather name={on ? 'check-square' : 'square'} size={20} color={on ? colors.primary.gold : colors.text.tertiary} />
          <View style={kit.flex}>
            <Text style={kit.text} numberOfLines={2}>{title}</Text>
            <Text style={kit.muted} numberOfLines={2}>{detail}</Text>
            {done ? <Text style={[kit.muted, { color: colors.primary.gold }]}>Już zaimportowano</Text> : null}
          </View>
        </TouchableOpacity>
        {extra}
      </View>
    );
  };

  return (
    <Sheet visible title="Importuj z oferty" subtitle="Pozycje z ofert zapytania trafią na koniec kalkulacji." onClose={() => { if (!importing) onClose(); }} width={860}
      footer={(
        <>
          <Text style={[kit.muted, kit.flex]}>Zaznaczono: {selectedHere.length}</Text>
          <TouchableOpacity onPress={onClose} disabled={importing} style={kit.secondary}><Text style={kit.secondaryText}>Anuluj</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => void run()} disabled={importing || !selectedHere.length} style={[kit.primary, (importing || !selectedHere.length) && kit.disabled]}>
            {importing ? <ActivityIndicator color={colors.background.primary} /> : <Feather name="download" size={16} color={colors.background.primary} />}
            <Text style={kit.primaryText}>Importuj ({selectedHere.length})</Text>
          </TouchableOpacity>
        </>
      )}>
      <View style={kit.between}>
        <Segmented value={mode} onChange={setMode} options={[{ id: 'products', label: 'Produkty' }, { id: 'contents', label: 'Zawartość (sprzęt + ludzie)' }, { id: 'transport', label: 'Transport' }]} />
        <SmallButton label="Zaznacz wszystkie" icon="check-square" disabled={!sources} onPress={toggleAll} />
      </View>
      {!sources ? (loadError ? <Text style={kit.warningText}>{loadError}</Text> : <ActivityIndicator color={colors.primary.gold} />) : mode === 'products' ? (
        sources.products.length ? sources.products.map((row) => check(row.ref, row.name,
          [row.offerName, `${calcPlain(row.quantity)} ${row.unit} × ${calcMoney(row.unitPrice)} zł`, row.categoryName].filter(Boolean).join(' · '),
          <View style={styles.category}>
            <SelectField value={categories[row.ref] || row.category} onChange={(value) => setCategories((current) => ({ ...current, [row.ref]: value as CalcCategory }))}
              options={CALC_CATEGORIES.map((item) => ({ id: item.id, label: item.label }))} />
          </View>,
        )) : <Text style={kit.muted}>Brak pozycji w ofertach dla tego zapytania.</Text>
      ) : mode === 'contents' ? (
        sources.equipment.length || sources.staff.length ? (
          <>
            {sources.equipment.length ? <Text style={styles.group}>Sprzęt</Text> : null}
            {sources.equipment.map((row) => check(row.ref, row.name,
              [row.offerName, row.productName, `${calcPlain(row.quantity)} ${row.isKit ? 'zest.' : 'szt.'}`, row.rentalPrice ? `${calcMoney(row.rentalPrice)} zł / dzień` : '', row.isRental ? 'rental' : ''].filter(Boolean).join(' · ')))}
            {sources.staff.length ? <Text style={styles.group}>Ludzie</Text> : null}
            {sources.staff.map((row) => check(row.ref, row.role,
              [row.offerName, row.productName, `${calcPlain(row.quantity)} os.`, `${calcMoney(row.hourlyRate)} zł/h × ${calcPlain(row.estimatedHours)} h`].filter(Boolean).join(' · ')))}
          </>
        ) : <Text style={kit.muted}>Brak sprzętu ani pracowników w produktach oferty.</Text>
      ) : (
        sources.vehicles.length ? sources.vehicles.map((row) => check(row.ref, row.vehicleName,
          [row.role, row.driverName ? `kierowca: ${row.driverName}` : '', row.estimatedDistance ? `${calcPlain(row.estimatedDistance)} km` : '',
            row.fuelCost || row.tollCost ? `${calcMoney((row.fuelCost || 0) + (row.tollCost || 0))} zł` : ''].filter(Boolean).join(' · ')))
          : <Text style={kit.muted}>Brak pojazdów przypisanych do eventu zapytania.</Text>
      )}
    </Sheet>
  );
}

/** „Wyślij kalkulację przez email” — aktualny PDF w załączniku (serwer pobiera go sam), opcjonalnie pliki wydarzenia zapytania. */
export function CalculationEmailSheet({ inquiryId, calculationId, name, hasEvent, onClose, onSent }: {
  inquiryId: string; calculationId: string; name: string; hasEvent: boolean; onClose: () => void; onSent: (message: string) => void;
}) {
  const [setup, setSetup] = useState<CalcEmailSetup | null>(null);
  const [loadError, setLoadError] = useState('');
  const [accountId, setAccountId] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [includeFiles, setIncludeFiles] = useState(false);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState(new Date(plannedAt(1, 8)));
  const [preview, setPreview] = useState<string | null>(null);
  const [working, setWorking] = useState<null | 'preview' | 'send'>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let active = true;
    loadCalcEmailSetup(inquiryId, calculationId).then((next) => {
      if (!active) return;
      setSetup(next); setAccountId(next.accounts[0]?.id || ''); setTo(next.to); setSubject(next.subject); setText(next.text);
    }).catch((cause) => { if (active) setLoadError(cause instanceof Error ? cause.message : 'Nie udało się otworzyć wysyłki.'); });
    return () => { active = false; };
  }, [inquiryId, calculationId]);

  const showPreview = async () => {
    setWorking('preview'); setProblem('');
    try { setPreview((await calcEmailPreview(inquiryId, calculationId, accountId, subject, text)).html || ''); }
    catch (cause) { setProblem(cause instanceof Error ? cause.message : 'Nie udało się przygotować podglądu.'); }
    finally { setWorking(null); }
  };
  const send = async () => {
    if (!setup) return;
    if (!to.trim()) { setProblem('Wprowadź adres email odbiorcy'); return; }
    if (!subject.trim()) { setProblem('Wprowadź temat wiadomości'); return; }
    if (!text.trim()) { setProblem('Wprowadź treść wiadomości'); return; }
    if (!setup.accounts.some((account) => account.id === accountId)) { setProblem('Wybierz konto pocztowe nadawcy'); return; }
    if (!setup.pdfReady) { setProblem('PDF kalkulacji nie został jeszcze wygenerowany. Najpierw dotknij „Generuj PDF”.'); return; }
    if (mode === 'later' && scheduledAt.getTime() < Date.now() + 30_000) { setProblem('Termin wysyłki musi przypadać w przyszłości'); return; }
    setWorking('send'); setProblem('');
    try {
      const reply = await sendCalcEmail(inquiryId, {
        calculationId, accountId, to: to.trim(), cc: cc.trim(), bcc: bcc.trim(), subject: subject.trim(), text,
        fileIds: includeFiles && hasEvent ? fileIds : [], scheduledAt: mode === 'later' ? scheduledAt.toISOString() : null,
      });
      onSent(reply.scheduled ? `Kalkulacja zostanie wysłana ${formatInquiryFull(reply.scheduledAt)}` : 'Kalkulacja wysłana przez email');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie wysłano kalkulacji.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <Sheet visible title={preview !== null ? 'Podgląd wiadomości' : 'Wyślij kalkulację przez email'} onClose={() => { if (working !== 'send') onClose(); }} width={820}
      footer={preview !== null ? (
        <TouchableOpacity onPress={() => setPreview(null)} style={kit.secondary}><Feather name="edit-3" size={16} color={colors.primary.gold} /><Text style={kit.secondaryText}>Wróć do edycji</Text></TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity onPress={() => void showPreview()} disabled={Boolean(working) || !accountId} style={[kit.secondary, (Boolean(working) || !accountId) && kit.disabled]}>
            <Feather name="eye" size={16} color={colors.primary.gold} /><Text style={kit.secondaryText}>Podgląd</Text>
          </TouchableOpacity>
          <View style={kit.flex} />
          <TouchableOpacity onPress={onClose} disabled={working === 'send'} style={kit.secondary}><Text style={kit.secondaryText}>Anuluj</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => void send()} disabled={Boolean(working) || !setup || !accountId || !setup?.pdfReady}
            style={[kit.primary, (Boolean(working) || !setup || !accountId || !setup?.pdfReady) && kit.disabled]}>
            {working === 'send' ? <ActivityIndicator color={colors.background.primary} /> : <Feather name="send" size={16} color={colors.background.primary} />}
            <Text style={kit.primaryText}>{mode === 'later' ? 'Zaplanuj' : 'Wyślij email'}</Text>
          </TouchableOpacity>
        </>
      )}>
      {!setup ? (loadError ? <Text style={kit.warningText}>{loadError}</Text> : <ActivityIndicator color={colors.primary.gold} />) : preview !== null ? (
        <View style={styles.preview}><WebView originWhitelist={['*']} source={{ html: preview }} style={kit.flex} /></View>
      ) : (
        <>
          <Label>Od</Label>
          {setup.accounts.length ? (
            <SelectField value={accountId} onChange={setAccountId} placeholder="Wybierz skrzynkę" options={setup.accounts.map((account) => ({ id: account.id, label: account.label }))} />
          ) : <Text style={kit.warningText}>Nie masz skonfigurowanych kont pocztowych.</Text>}
          <Label>Do</Label>
          <RecipientInput value={to} onChangeText={setTo} style={kit.input} placeholder="Imię, nazwisko, firma albo adres e-mail" placeholderTextColor={ink(0.35)} accessibilityLabel="Do" />
          {setup.contact ? <Text style={kit.muted}>Osoba kontaktowa: {setup.contact}</Text> : null}
          <Label>DW</Label>
          <RecipientInput value={cc} onChangeText={setCc} style={kit.input} placeholder="Opcjonalnie" placeholderTextColor={ink(0.35)} accessibilityLabel="DW" />
          <Label>UDW</Label>
          <RecipientInput value={bcc} onChangeText={setBcc} style={kit.input} placeholder="Opcjonalnie" placeholderTextColor={ink(0.35)} accessibilityLabel="UDW" />
          <Label>Temat</Label>
          <TextInput value={subject} onChangeText={setSubject} style={kit.input} placeholder="Temat wiadomości" placeholderTextColor={ink(0.35)} />
          <Label>Wiadomość</Label>
          <TextInput value={text} onChangeText={setText} multiline style={[kit.input, styles.message]} placeholderTextColor={ink(0.35)} />
          <Text style={kit.muted}>Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.</Text>
          <Label>Załączniki</Label>
          <View style={styles.inline}>
            <Feather name={setup.pdfReady ? 'file-text' : 'alert-triangle'} size={16} color={setup.pdfReady ? colors.status.info : colors.status.warning} />
            <Text style={[kit.text, kit.flex, { color: setup.pdfReady ? colors.text.primary : colors.status.warning }]}>
              {setup.pdfReady ? `Aktualny PDF kalkulacji „${name}” zostanie dołączony do wiadomości.` : 'PDF kalkulacji nie został jeszcze wygenerowany. Najpierw dotknij „Generuj PDF”.'}
            </Text>
          </View>
          {hasEvent ? (
            <>
              <TouchableOpacity onPress={() => setIncludeFiles((value) => !value)} style={styles.inline} accessibilityRole="checkbox" accessibilityState={{ checked: includeFiles }}>
                <Feather name={includeFiles ? 'check-square' : 'square'} size={20} color={includeFiles ? colors.primary.gold : colors.text.tertiary} />
                <Text style={kit.text}>Dołącz dodatkowe pliki z eventu</Text>
              </TouchableOpacity>
              {includeFiles ? (
                <>
                  <Text style={kit.muted}>Zobaczysz tylko pliki, do których masz dostęp zgodnie z uprawnieniami. Wybierz pliki, które chcesz dołączyć do wiadomości.</Text>
                  {!setup.files.length ? <Text style={kit.muted}>Brak plików w evencie.</Text> : null}
                  {setup.files.map((file) => {
                    const on = fileIds.includes(file.id);
                    return (
                      <TouchableOpacity key={file.id} onPress={() => setFileIds((current) => (on ? current.filter((id) => id !== file.id) : [...current, file.id]))}
                        style={kit.selectRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                        <Feather name={on ? 'check-square' : 'square'} size={18} color={on ? colors.primary.gold : colors.text.tertiary} />
                        <Text style={[kit.text, kit.flex]} numberOfLines={1}>{file.name}</Text>
                        {file.size ? <Text style={kit.muted}>{file.size >= 1048576 ? `${calcPlain(file.size / 1048576, 1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} kB`}</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : null}
            </>
          ) : null}
          <Label>Wysyłka</Label>
          <Segmented value={mode} onChange={setMode} options={[{ id: 'now', label: 'Wyślij teraz' }, { id: 'later', label: 'Zaplanuj wysyłkę' }]} />
          {mode === 'later' ? <DateTimeField value={scheduledAt} onChange={setScheduledAt} minimum={new Date()} /> : null}
        </>
      )}
      {working ? <View style={kit.row}><ActivityIndicator color={colors.primary.gold} /><Text style={kit.muted}>{working === 'send' ? (mode === 'later' ? 'Planowanie wysyłki…' : 'Wysyłanie kalkulacji…') : 'Przygotowywanie podglądu…'}</Text></View> : null}
      {problem ? <Text style={kit.warningText}>{problem}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: glow(0.03), borderWidth: 1, borderColor: glow(0.06) },
  rowActive: { borderColor: colors.primary.gold, backgroundColor: glow(0.06) },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  category: { width: 180 },
  group: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, marginTop: spacing.xs },
  preview: { height: 560, borderRadius: borderRadius.lg, overflow: 'hidden', backgroundColor: colors.white },
  message: { minHeight: 180, paddingTop: spacing.sm, textAlignVertical: 'top' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40 },
});
