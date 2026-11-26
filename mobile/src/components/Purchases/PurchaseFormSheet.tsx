import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { DayField, Label, Segmented, SelectField, SelectList, Sheet, SheetActions, SmallButton, kit, useNotice } from '../Inquiries/InquiryKit';
import {
  PURCHASE_COST_STATUS_LABELS, PURCHASE_KINDS, PURCHASE_MAX_PAGES, PURCHASE_METHODS, purchaseDay, purchaseDraftErrors, purchaseDraftFrom,
  purchaseDraftWithReading, purchaseEmptyDraft, purchaseEventCategoryFor, purchaseMoney, purchaseNumber, purchasePayload, purchaseToday,
  type PurchaseCategories, type PurchaseCompanyRef, type PurchaseDocument, type PurchaseDraft, type PurchaseEventCosts,
  type PurchaseEventOption, type PurchaseKind, type PurchaseMethod, type PurchaseUpload,
} from '../../lib/purchaseShared';
import {
  discardPurchaseFile, loadPurchaseEventCosts, savePurchase, searchPurchaseEvents, uploadPurchaseFiles, type PurchaseAsset,
} from '../../lib/purchasesApi';
import { pickPurchaseAssets, pui, type PurchasePickSource } from './purchasesUi';
import { borderRadius, colors, spacing } from '../../theme';

/*
 * Okno „Dodaj zakup” / „Popraw zakup” w telefonie — jak w CRM i na Macu: zdjęcie paragonu aparatem (kolejne strony jednego
 * dokumentu — „Dodaj stronę”), zdjęcia z galerii albo PDF z „Plików”; serwer zapisuje plik i odczytuje go AI, pola uzupełniają się
 * same (przy poprawce — „Wstaw odczytane dane”). Dane do sprawdzenia, sposób zapłaty (domyślnie firmowa karta), kategoria
 * kosztów i opcjonalnie event — koszt eventu (całość albo część dokumentu) z listą wszystkich kosztów tego eventu.
 */

type Notice = ReturnType<typeof useNotice>;

export default function PurchaseFormSheet({ visible, document, companies, categories, notice, onClose, onSaved }: {
  visible: boolean;
  document: PurchaseDocument | null;
  companies: PurchaseCompanyRef[];
  categories: PurchaseCategories;
  notice: Notice;
  onClose: () => void;
  onSaved: (document: PurchaseDocument, created: boolean) => void;
}) {
  const [draft, setDraft] = useState<PurchaseDraft>(() => purchaseEmptyDraft(''));
  const [pages, setPages] = useState<PurchaseAsset[]>([]);
  const [upload, setUpload] = useState<PurchaseUpload | null>(null);
  const [picking, setPicking] = useState(false);
  const [eventQuery, setEventQuery] = useState('');
  const [eventOptions, setEventOptions] = useState<PurchaseEventOption[] | null>(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventName, setEventName] = useState('');
  const [costs, setCosts] = useState<PurchaseEventCosts | null>(null);
  const uploadRef = useRef<PurchaseUpload | null>(null);
  const savedRef = useRef(false);
  uploadRef.current = upload;

  const set = <K extends keyof PurchaseDraft>(key: K, value: PurchaseDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  // Otwarcie okna: dane dokumentu albo pusty formularz (działalność domyślna, dziś, karta firmowa).
  useEffect(() => {
    if (!visible) return;
    savedRef.current = false;
    setDraft(document ? purchaseDraftFrom(document) : purchaseEmptyDraft(companies[0]?.id || ''));
    setPages([]);
    setUpload(null);
    setPicking(false);
    setEventQuery('');
    setEventOptions(null);
    setCosts(null);
    setEventName(document?.event ? `${document.event.name} · ${purchaseDay(document.event.date)}` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, document?.id]);

  // Plik wysłany, a zakup niezapisany — znika z serwera przy zamknięciu okna (także przy opuszczeniu ekranu).
  useEffect(() => {
    if (visible) return undefined;
    const pending = uploadRef.current;
    if (pending && !savedRef.current) void discardPurchaseFile(pending.file.path);
    if (pending) setUpload(null);
    return undefined;
  }, [visible]);
  useEffect(() => () => {
    const pending = uploadRef.current;
    if (pending && !savedRef.current) void discardPurchaseFile(pending.file.path);
  }, []);

  // Eventy do wyboru: najbliższe dziś, z wyszukiwaniem (z krótkim opóźnieniem przy pisaniu).
  useEffect(() => {
    if (!visible || !picking || !draft.company_id) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      setEventLoading(true);
      searchPurchaseEvents(draft.company_id, eventQuery.trim())
        .then((rows) => { if (alive) setEventOptions(rows); })
        .catch((cause) => { if (alive) { setEventOptions([]); notice.notify(cause instanceof Error ? cause.message : 'Nie udało się wczytać eventów.', true); } })
        .finally(() => { if (alive) setEventLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, picking, draft.company_id, eventQuery]);

  useEffect(() => {
    if (!visible || !draft.event_id) { setCosts(null); return undefined; }
    let alive = true;
    loadPurchaseEventCosts(draft.event_id)
      .then((data) => { if (alive) setCosts(data); })
      .catch((cause) => { if (alive) notice.notify(cause instanceof Error ? cause.message : 'Nie udało się wczytać kosztów eventu.', true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, draft.event_id]);

  const errors = useMemo(() => purchaseDraftErrors(draft, purchaseToday()), [draft]);
  const gross = purchaseNumber(draft.gross);
  const hasFile = Boolean(upload) || Boolean(document?.has_file);
  const warnings = upload?.reading?.warnings || [];

  /** Wysłanie stron (wszystkich naraz — serwer składa PDF) i odczyt AI; poprzedni niezapisany plik znika z serwera. */
  const send = async (next: PurchaseAsset[]) => {
    if (!draft.company_id) { notice.notify('Najpierw wybierz działalność.', true); return; }
    const previous = uploadRef.current;
    const result = await notice.run(next.length > 1 ? `Składanie ${next.length} stron i odczytywanie dokumentu…` : 'Zapisywanie zdjęcia i odczytywanie dokumentu…',
      () => uploadPurchaseFiles(draft.company_id, next));
    if (!result) return;
    if (previous) void discardPurchaseFile(previous.file.path);
    setPages(next);
    setUpload(result);
    if (!document) setDraft((current) => purchaseDraftWithReading(current, result.reading));
    if (result.reading) notice.notify(document ? 'Plik dodany. Odczyt AI możesz wstawić do formularza.' : 'Dokument odczytany — sprawdź dane przed zapisem.');
    else notice.notify(result.readingError || 'Plik dodany — uzupełnij dane ręcznie.', true);
  };

  /** Zdjęcie / zdjęcia albo plik; `add` — kolejna strona tego samego dokumentu. */
  const pick = async (source: PurchasePickSource, add: boolean) => {
    const base = add ? pages.filter((page) => page.mimeType === 'image/jpeg' || page.mimeType === 'image/png') : [];
    const room = PURCHASE_MAX_PAGES - base.length;
    if (room <= 0) { notice.notify(`Dokument może mieć najwyżej ${PURCHASE_MAX_PAGES} stron.`, true); return; }
    try {
      const { assets, skipped } = await pickPurchaseAssets(source, room);
      if (skipped) notice.notify(skipped === 1 ? 'Pominięto plik: tylko zdjęcia JPG, PNG, WebP i PDF.' : `Pominięto pliki (${skipped}): tylko zdjęcia JPG, PNG, WebP i PDF.`, true);
      if (!assets.length) return;
      const pdf = assets.find((asset) => asset.mimeType === 'application/pdf');
      // PDF albo zdjęcie WebP to cały dokument (jeden plik); strony składają się tylko ze zdjęć JPG i PNG.
      const single = pdf || (assets.length === 1 && assets[0].mimeType === 'image/webp' ? assets[0] : null);
      if (single) { await send([single]); return; }
      await send([...base, ...assets.filter((asset) => asset.mimeType !== 'image/webp')].slice(0, PURCHASE_MAX_PAGES));
    } catch (cause) {
      notice.notify(cause instanceof Error ? cause.message : 'Nie udało się dodać zdjęcia.', true);
    }
  };

  const chooseSource = (add: boolean) => {
    Alert.alert(add ? 'Kolejna strona' : 'Zdjęcie albo plik dokumentu', add ? 'Strony składają się w jeden PDF.' : 'Każdy paragon dodaj osobno.', [
      { text: 'Zrób zdjęcie', onPress: () => void pick('camera', add) },
      { text: 'Wybierz z galerii', onPress: () => void pick('library', add) },
      ...(add ? [] : [{ text: 'Wybierz plik (PDF)', onPress: () => void pick('files', false) }]),
      { text: 'Anuluj', style: 'cancel' as const },
    ]);
  };

  const pickEvent = (event: PurchaseEventOption) => {
    const financeName = categories.finance.find((category) => category.id === draft.category_id)?.name;
    setDraft((current) => ({
      ...current,
      event_id: event.id,
      event_amount: '',
      event_category_id: current.event_category_id || purchaseEventCategoryFor(financeName, categories.event),
    }));
    setEventName(`${event.name} · ${purchaseDay(event.date)}`);
    setCosts(null);
    setPicking(false);
  };

  const clearEvent = () => {
    setDraft((current) => ({ ...current, event_id: '', event_amount: '', event_category_id: '' }));
    setEventName('');
    setCosts(null);
  };

  const save = async () => {
    if (errors.length) { notice.notify(errors.join(' '), true); return; }
    const saved = await notice.run('Zapisywanie zakupu…', () => savePurchase(document?.id ?? null, purchasePayload(draft, upload?.file.path)),
      document ? 'Zakup poprawiony.' : 'Zakup zapisany.');
    if (!saved) return;
    savedRef.current = true;
    onSaved(saved, !document);
  };

  const companyOptions = useMemo(() => {
    const list = companies.map((company) => ({ id: company.id, label: company.name }));
    if (document && !list.some((item) => item.id === document.company_id)) list.push({ id: document.company_id, label: document.company_name || 'Działalność' });
    return list;
  }, [companies, document]);

  const fileText = upload
    ? `Nowy plik: ${pages.length > 1 ? `PDF z ${pages.length} zdjęć` : pages[0]?.name || 'dokument'}`
    : document?.has_file ? 'Dokument ma zapisany plik.' : 'Zrób zdjęcie paragonu, dodaj zdjęcia stron albo PDF faktury.';
  const canAddPage = pages.length > 0 && pages.length < PURCHASE_MAX_PAGES && pages.every((page) => page.mimeType === 'image/jpeg' || page.mimeType === 'image/png');

  return (
    <Sheet visible={visible} title={document ? 'Popraw zakup' : 'Dodaj zakup'} subtitle="Zdjęcie paragonu albo faktura — dane odczyta AI, sprawdź je przed zapisem."
      onClose={onClose} width={720}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void save()} label={document ? 'Zapisz zmiany' : 'Zapisz zakup'} saving={!!notice.busy} />}>
      <Label>Plik dokumentu</Label>
      <View style={[pui.card, { padding: spacing.sm }]}>
        <Text style={pui.textSm}>{fileText}</Text>
        {pages.length ? (
          <View style={pui.wrap}>
            {pages.map((page, index) => (page.mimeType === 'application/pdf'
              ? <View key={page.uri + index} style={[thumb, { alignItems: 'center', justifyContent: 'center' }]}><Feather name="file-text" size={22} color={colors.primary.gold} /></View>
              : <Image key={page.uri + index} source={{ uri: page.uri }} style={thumb} />))}
          </View>
        ) : null}
        <View style={pui.wrap}>
          <SmallButton label={hasFile ? 'Zamień zdjęcie / plik' : 'Zrób zdjęcie albo dodaj plik'} icon="camera" primary={!hasFile} onPress={() => chooseSource(false)}
            disabled={!!notice.busy} />
          {canAddPage ? <SmallButton label="Dodaj stronę" icon="plus" onPress={() => chooseSource(true)} disabled={!!notice.busy} /> : null}
        </View>
        <Text style={pui.mutedXs}>Kilka zdjęć to strony jednego dokumentu (do {PURCHASE_MAX_PAGES}). Każdy paragon dodaj osobno.</Text>
        {upload?.readingError ? <Text style={pui.warning}>{upload.readingError}</Text> : null}
        {warnings.map((warning) => (
          <View key={warning} style={pui.row}>
            <Feather name="alert-triangle" size={13} color={colors.status.warning} />
            <Text style={[pui.warning, pui.flex]}>{warning}</Text>
          </View>
        ))}
        {document && upload?.reading ? (
          <SmallButton label="Wstaw odczytane dane" icon="zap" onPress={() => setDraft((current) => purchaseDraftWithReading(current, upload.reading))} />
        ) : null}
        {!hasFile ? <Text style={pui.warning}>Bez pliku zakupu nie da się wysłać w rozliczeniu miesiąca.</Text> : null}
      </View>

      {companyOptions.length > 1 ? (
        <>
          <Label>Działalność</Label>
          <SelectField value={draft.company_id} options={companyOptions} onChange={(id) => set('company_id', id)} disabled={!!draft.event_id} />
          {draft.event_id ? <Text style={pui.mutedXs}>Najpierw usuń event — event należy do działalności.</Text> : null}
        </>
      ) : null}
      <Label>Rodzaj dokumentu</Label>
      <Segmented<PurchaseKind> value={draft.kind} options={PURCHASE_KINDS.map((kind) => ({ id: kind.value, label: kind.value === 'other' ? 'Inny' : kind.label }))}
        onChange={(kind) => set('kind', kind)} />
      <Label>Sprzedawca</Label>
      <TextInput value={draft.seller_name} onChangeText={(text) => set('seller_name', text)} placeholder="np. Leroy Merlin" placeholderTextColor={colors.text.tertiary}
        style={kit.input} maxLength={200} />
      <Label>NIP sprzedawcy</Label>
      <TextInput value={draft.seller_nip} onChangeText={(text) => set('seller_nip', text)} placeholder="z nagłówka paragonu" placeholderTextColor={colors.text.tertiary}
        style={kit.input} maxLength={30} keyboardType="numbers-and-punctuation" autoCorrect={false} />
      <Label>{draft.kind === 'invoice' ? 'Numer faktury' : 'Numer paragonu / dokumentu'}</Label>
      <TextInput value={draft.number} onChangeText={(text) => set('number', text)} style={kit.input} maxLength={120} autoCorrect={false} />
      <Label>Data zakupu</Label>
      <DayField value={draft.date} onChange={(day) => set('date', day)} />
      <Label>Co kupiono</Label>
      <TextInput value={draft.label} onChangeText={(text) => set('label', text)} placeholder="np. gadżety na wesele, taśmy, baterie" placeholderTextColor={colors.text.tertiary}
        style={kit.input} maxLength={200} />
      <View style={pui.row}>
        <View style={pui.flex}>
          <Label>Kwota brutto</Label>
          <TextInput value={draft.gross} onChangeText={(text) => set('gross', text)} keyboardType="decimal-pad" style={kit.input} />
        </View>
        <View style={pui.flex}>
          <Label>Netto (jeśli jest)</Label>
          <TextInput value={draft.net} onChangeText={(text) => set('net', text)} keyboardType="decimal-pad" style={kit.input} />
        </View>
        <View style={{ width: 76 }}>
          <Label>Waluta</Label>
          <TextInput value={draft.currency} onChangeText={(text) => set('currency', text.toUpperCase())} style={kit.input} maxLength={3} autoCapitalize="characters"
            autoCorrect={false} />
        </View>
      </View>
      <Label>Zapłacono</Label>
      <SelectField value={draft.payment_method} options={PURCHASE_METHODS.map((method) => ({ id: method.value, label: method.label }))}
        onChange={(id) => set('payment_method', id as PurchaseMethod)} />
      <Label>Kategoria kosztów</Label>
      <SelectField value={draft.category_id} onChange={(id) => set('category_id', id)}
        options={[{ id: '', label: 'Bez kategorii (ustali księgowość)' }, ...categories.finance.map((category) => ({ id: category.id, label: category.name }))]} />
      <Label>Uwagi</Label>
      <TextInput value={draft.notes} onChangeText={(text) => set('notes', text)} multiline style={[kit.input, kit.multiline]} maxLength={2000} />

      <Label>Koszt eventu</Label>
      <View style={[pui.card, { padding: spacing.sm }]}>
        {draft.event_id ? (
          <>
            <View style={pui.between}>
              <View style={[pui.row, pui.flex]}>
                <Feather name="calendar" size={15} color={colors.primary.gold} />
                <Text style={[pui.textSm, pui.flex]} numberOfLines={2}>{eventName || costs?.event.name || 'Event'}</Text>
              </View>
              <TouchableOpacity onPress={clearEvent} accessibilityRole="button" accessibilityLabel="Bez eventu"><Text style={kit.muted}>Bez eventu</Text></TouchableOpacity>
            </View>
            {draft.currency.toUpperCase() !== 'PLN' ? <Text style={pui.warning}>Do eventu można przypisać zakup w PLN.</Text> : null}
            {costs && !costs.settlement_open ? (
              <Text style={pui.warning}>Podsumowanie tego eventu jest już wysłane albo zatwierdzone — koszt dopisze osoba z finansów.</Text>
            ) : null}
            <Label>Kwota dla eventu (brutto)</Label>
            <TextInput value={draft.event_amount} onChangeText={(text) => set('event_amount', text)} keyboardType="decimal-pad" style={kit.input}
              placeholder={gross ? `Puste — cały dokument (${purchaseMoney(gross)})` : 'Puste — cały dokument'} placeholderTextColor={colors.text.tertiary} />
            <Label>Kategoria kosztu eventu</Label>
            <SelectField value={draft.event_category_id} onChange={(id) => set('event_category_id', id)}
              options={[{ id: '', label: 'Bez kategorii' }, ...categories.event.map((category) => ({ id: category.id, label: category.name }))]} />
            <Text style={pui.label}>Koszty tego eventu{costs ? ` · razem ${purchaseMoney(costs.total)}` : ''}</Text>
            {!costs ? <ActivityIndicator color={colors.primary.gold} /> : costs.costs.length === 0 ? (
              <Text style={pui.mutedXs}>Ten event nie ma jeszcze kosztów.</Text>
            ) : costs.costs.map((cost) => (
              <View key={cost.id} style={pui.between}>
                <View style={pui.flex}>
                  <Text style={pui.textXs} numberOfLines={1}>{cost.name}</Text>
                  <Text style={pui.mutedXs} numberOfLines={1}>
                    {[purchaseDay(cost.date), cost.category_name, cost.created_by_name, PURCHASE_COST_STATUS_LABELS[cost.status || ''] || cost.status].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={[pui.money, cost.mine && { color: colors.primary.gold }]}>{purchaseMoney(cost.amount, cost.currency)}</Text>
              </View>
            ))}
          </>
        ) : picking ? (
          <>
            <TextInput value={eventQuery} onChangeText={setEventQuery} placeholder="Szukaj eventu po nazwie…" placeholderTextColor={colors.text.tertiary}
              style={kit.input} autoCorrect={false} />
            {eventLoading && !eventOptions ? <ActivityIndicator color={colors.primary.gold} /> : (
              <SelectList selected={[]} searchable={false}
                emptyText={eventQuery.trim() ? 'Nie znaleziono eventu.' : 'Brak eventów w najbliższym czasie — wyszukaj po nazwie.'}
                options={(eventOptions || []).map((event) => ({ id: event.id, label: event.name, detail: [purchaseDay(event.date), event.location].filter(Boolean).join(' · ') }))}
                onToggle={(id) => { const event = (eventOptions || []).find((row) => row.id === id); if (event) pickEvent(event); }} />
            )}
            <SmallButton label="Anuluj wybór" icon="x" onPress={() => setPicking(false)} />
          </>
        ) : (
          <>
            <Text style={pui.mutedXs}>Zakup dla konkretnego eventu (np. gadżety na wesele) dopisz do jego kosztów — zobaczysz wszystkie koszty tego eventu.</Text>
            <SmallButton label="Przypisz do eventu" icon="calendar" onPress={() => setPicking(true)} disabled={!draft.company_id} />
          </>
        )}
      </View>
    </Sheet>
  );
}

const thumb = { width: 56, height: 72, borderRadius: borderRadius.sm, backgroundColor: colors.background.tertiary } as const;
