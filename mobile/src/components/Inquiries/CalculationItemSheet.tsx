import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, ink } from '../../theme';
import {
  FUEL_TYPES, TRAVEL_ORIGIN, addCalcItems, calcFuelQuote, calcMoney, calcParse, calcPlain, calcRoute, calcVehicleConsumption, fuelCost, fuelRatePerKm,
  isLiquidFuel, loadCalcCatalog, loadCalcTravelContext, round2, saveCalcItem,
  type CalcCatalogOption, type CalcCategory, type CalcFuelQuote, type CalcItemPayload, type CalcLine, type CalcRoute, type CalcTravelContext,
} from '../../lib/inquiryCalculations';
import { Chip, Label, Segmented, SelectField, Sheet, SmallButton, kit } from './InquiryKit';

/*
 * „Dodaj / Edytuj pozycję” kalkulacji (`AddCalculationItemModal` w CRM, `CalculationItemSheet` na Macu) z obsługą dotykiem:
 * Pozycje — z magazynu (kilka sprzętów naraz z ilością − / +, stan i „pozostało”, sprzęt już obecny zwiększa ilość pozycji)
 * albo ręcznie; Ludzie — ręcznie albo usługi personelu z katalogu; Transport — ręcznie albo pojazd z bazy (informacja
 * wewnętrzna) z kalkulatorem trasy i kosztu paliwa (Google Maps, ceny AutoCentrum, spalanie z karty auta). Pozostałe — ręcznie.
 */

type Mode = 'warehouse' | 'manual' | 'product' | 'vehicle';
const MODES: Record<CalcCategory, Mode[]> = { equipment: ['warehouse', 'manual'], staff: ['manual', 'product'], transport: ['manual', 'vehicle'], other: [] };
const MODE_LABELS: Record<Mode, string> = { warehouse: 'Z magazynu', manual: 'Ręcznie', product: 'Usługi personelu z katalogu', vehicle: 'Pojazdy z bazy' };
const PAGE = 40;
const lower = (value: string) => value.toLocaleLowerCase('pl-PL');

const optionFromLine = (line: CalcLine): CalcCatalogOption => ({
  id: line.sourceRef || '', label: line.sourceLabel || line.name, name: line.name, title: line.sourceLabel || line.name, subtitle: '', detail: null,
  price: line.unitPrice, unit: line.unit, vat: line.vat, thumbnail: line.thumbnail, stock: line.stock, power: line.power, weight: line.weight,
  description: line.description, minimum: null, people: null, fuelType: null,
});

export function CalculationItemSheet({ inquiryId, calculationId, category, editing, existing, onClose, onSaved }: {
  inquiryId: string; calculationId: string; category: CalcCategory; editing: CalcLine | null; existing: CalcLine[];
  onClose: () => void; onSaved: (message: string | null) => void;
}) {
  const initialMode: Mode = editing
    ? (['warehouse', 'product', 'vehicle'].includes(editing.source) ? editing.source as Mode : 'manual')
    : category === 'equipment' ? 'warehouse' : 'manual';
  const defaultUnit = category === 'staff' ? 'h' : category === 'transport' ? 'auto' : 'szt.';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [catalogs, setCatalogs] = useState<Partial<Record<Mode, CalcCatalogOption[]>>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [selected, setSelected] = useState<CalcCatalogOption | null>(editing && editing.sourceRef && initialMode !== 'manual' ? optionFromLine(editing) : null);
  const [browsing, setBrowsing] = useState(false);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [name, setName] = useState(editing?.name ?? '');
  const [details, setDetails] = useState(editing?.description ?? '');
  const [unit, setUnit] = useState(editing?.unit || defaultUnit);
  const [quantity, setQuantity] = useState(calcPlain(editing?.quantity ?? 1));
  const [days, setDays] = useState(calcPlain(editing?.days ?? 1));
  const [unitPrice, setUnitPrice] = useState(calcPlain(editing?.unitPrice ?? 0, category === 'transport' ? 6 : 2));
  const [vat, setVat] = useState(calcPlain(editing?.vat ?? 23));
  const [power, setPower] = useState(editing?.power != null ? calcPlain(editing.power) : '');
  const [estimate, setEstimate] = useState<Record<string, unknown> | null>(editing?.transportEstimate ?? null);
  const [travelBusy, setTravelBusy] = useState(false);
  const [travelPending, setTravelPending] = useState(false);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const batchMode = !editing && category === 'equipment' && mode === 'warehouse';
  const catalog = catalogs[mode] || [];

  useEffect(() => {
    if (mode === 'manual' || catalogs[mode]) return;
    let active = true;
    setCatalogLoading(true); setCatalogError('');
    loadCalcCatalog(inquiryId, mode === 'warehouse' ? 'equipment' : mode)
      .then((reply) => { if (active) setCatalogs((current) => ({ ...current, [mode]: reply.options })); })
      .catch((cause) => { if (active) setCatalogError(cause instanceof Error ? cause.message : 'Nie udało się pobrać katalogu. Zamknij formularz i spróbuj ponownie.'); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [mode, catalogs, inquiryId]);

  const switchMode = (value: Mode) => {
    if (value === mode) return;
    setMode(value); setSourceChanged(true); setSelected(null); setBrowsing(false); setFormError(''); setName(''); setSearch(''); setLimit(PAGE);
    if (category === 'equipment') {
      if (value === 'warehouse') setDetails(''); else setPower('');
    } else {
      setEstimate(null); setTravelPending(false); setDetails(''); setUnitPrice('0'); setPower('');
    }
  };
  const pick = (option: CalcCatalogOption) => {
    setSelected(option); setBrowsing(false); setEstimate(null); setTravelPending(false); setSourceChanged(true);
    setName(option.name); setDetails(option.description); setUnitPrice(calcPlain(option.price, 6)); setUnit(option.unit); setVat(calcPlain(option.vat)); setPower('');
  };

  // MARK: Magazyn — ilości przy sprzęcie
  const alreadyAdded = (id: string) => existing.filter((line) => line.id !== editing?.id && line.source === 'warehouse' && line.sourceRef === id)
    .reduce((sum, line) => sum + line.quantity, 0);
  const remaining = (option: CalcCatalogOption) => Math.max((option.stock ?? 0) - alreadyAdded(option.id), 0);
  const pickLimit = (option: CalcCatalogOption) => Math.max(Math.floor(remaining(option)), 0);
  const existingLine = (id: string) => existing.find((line) => line.id !== editing?.id && line.category === category && line.source === 'warehouse' && line.sourceRef === id) || null;
  const priceText = (option: CalcCatalogOption) => priceDrafts[option.id] ?? calcPlain(option.price);
  const batchPrice = (option: CalcCatalogOption): number | null => {
    const line = existingLine(option.id);
    if (line) return line.unitPrice;
    const text = priceText(option).trim();
    if (!text) return 0;
    const value = calcParse(text);
    return value !== null && value >= 0 ? value : null;
  };
  const setPick = (option: CalcCatalogOption, value: number) => {
    const clamped = Math.min(Math.max(value, 0), pickLimit(option));
    setPicks((current) => {
      const next = { ...current };
      if (clamped > 0) next[option.id] = clamped; else delete next[option.id];
      if (!Object.keys(next).length) setOnlyPicked(false);
      return next;
    });
    setFormError('');
  };
  const bump = (option: CalcCatalogOption, delta: number) => {
    const next = (picks[option.id] ?? 0) + delta;
    if (next < 0) return;
    if (delta > 0 && next > pickLimit(option)) { setFormError(`Brak kolejnych sztuk: ${option.title || option.label}`); return; }
    setPick(option, next);
  };
  const chosenOptions = catalog.filter((option) => (picks[option.id] ?? 0) > 0);
  const batchCount = chosenOptions.length;
  const batchPieces = chosenOptions.reduce((sum, option) => sum + (picks[option.id] ?? 0), 0);
  const batchMerge = chosenOptions.filter((option) => existingLine(option.id)).length;
  const batchNetPerDay = chosenOptions.reduce((sum, option) => sum + (picks[option.id] ?? 0) * round2(batchPrice(option) ?? 0), 0);
  const batchRows = useMemo(() => {
    const needle = lower(search.trim());
    return catalog.filter((option) => {
      const chosen = (picks[option.id] ?? 0) > 0;
      if (onlyPicked && !chosen) return false;
      if (!chosen && remaining(option) <= 0) return false;
      return !needle || lower([option.label, option.title, option.subtitle, option.detail || ''].join(' ')).includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, search, onlyPicked, picks, existing]);
  const catalogRows = useMemo(() => {
    const needle = lower(search.trim());
    return catalog.filter((option) => !needle || lower([option.label, option.subtitle, option.detail || ''].join(' ')).includes(needle));
  }, [catalog, search]);

  const submitBatch = async () => {
    if (submitting) return;
    if (!chosenOptions.length) { setFormError('Ustaw ilość przy co najmniej jednej pozycji.'); return; }
    const span = calcParse(days);
    const rate = calcParse(vat);
    if (span === null || span <= 0 || rate === null || rate < 0 || rate > 100) { setFormError('Uzupełnij poprawną liczbę dni i VAT.'); return; }
    const wrong = chosenOptions.find((option) => batchPrice(option) === null);
    if (wrong) { setFormError(`Popraw cenę netto: ${wrong.title || wrong.label}`); return; }
    const items: CalcItemPayload[] = chosenOptions.map((option) => ({
      category, name: option.label, description: '', unit: 'szt.', quantity: picks[option.id] ?? 0, unitPrice: round2(batchPrice(option) ?? 0), days: span,
      source: 'warehouse', sourceRef: option.id, vat: rate, power: option.power, weight: option.weight, transportEstimate: null,
    }));
    setSubmitting(true); setFormError('');
    try {
      await addCalcItems(inquiryId, calculationId, items);
      const added = batchCount - batchMerge;
      const parts: string[] = [];
      if (added > 0) parts.push(added === 1 ? 'Dodano pozycję' : `Dodano ${added} poz.`);
      if (batchMerge > 0) parts.push(batchMerge === 1 ? 'zwiększono ilość sprzętu już obecnego w kalkulacji' : `zwiększono ilość ${batchMerge} poz. już obecnych w kalkulacji`);
      const joined = parts.join(' · ');
      onSaved(joined.charAt(0).toUpperCase() + joined.slice(1));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Nie udało się dodać pozycji.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && !travelBusy && !travelPending && !browsing && Boolean(name.trim())
    && !(mode !== 'manual' && !selected);
  const submit = async () => {
    if (submitting || travelBusy || !name.trim()) return;
    if (travelPending) { setFormError('Zastosuj wynik kalkulatora lub wybierz ręczną stawkę transportu.'); return; }
    const amount = calcParse(quantity);
    const span = calcParse(days);
    const price = calcParse(unitPrice);
    const rate = calcParse(vat);
    if (amount === null || span === null || price === null || rate === null || amount <= 0 || span <= 0 || price < 0 || rate < 0 || rate > 100 || !unit.trim()) {
      setFormError('Uzupełnij poprawną ilość, jednostkę, dni / kilometry, cenę i VAT.');
      return;
    }
    if (!canSubmit) return;
    const source = selected ? mode : ((!sourceChanged ? editing?.source : null) || 'manual');
    const sourceRef = selected?.id || (!sourceChanged ? editing?.sourceRef ?? null : null);
    const pickedWeight = mode === 'warehouse' && selected ? selected.weight : null;
    const weight = pickedWeight ?? (sourceChanged ? null : editing?.weight ?? null);
    const item: CalcItemPayload = {
      id: editing?.id ?? null, category, name: name.trim(), description: details.trim(), unit: unit.trim(), quantity: amount, unitPrice: price, days: span,
      source, sourceRef, vat: rate, power: calcParse(power), weight, transportEstimate: category === 'transport' ? estimate : null,
    };
    setSubmitting(true); setFormError('');
    try {
      await saveCalcItem(inquiryId, calculationId, item);
      onSaved(null);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Nie udało się zapisać pozycji.');
    } finally {
      setSubmitting(false);
    }
  };

  const stockExceeded = mode === 'warehouse' && selected && (calcParse(quantity) ?? 0) > (selected.stock ?? 0);
  const vehicleFuelType = mode === 'vehicle' && selected ? selected.fuelType ?? catalogs.vehicle?.find((option) => option.id === selected.id)?.fuelType ?? null : null;
  const amount = calcParse(quantity) ?? 0;
  const price = calcParse(unitPrice) ?? 0;
  const span = calcParse(days) ?? 0;
  const net = amount * price * (span === 0 ? 1 : span);
  const gross = net * (1 + (calcParse(vat) ?? 0) / 100);

  const thumb = (url: string | null) => (url
    ? <Image source={{ uri: url }} style={styles.thumb} />
    : <View style={[styles.thumb, styles.thumbEmpty]}><Feather name="package" size={16} color={colors.text.tertiary} /></View>);

  const batch = (
    <View style={kit.gapSm}>
      <View style={kit.row}>
        <TextInput value={search} onChangeText={(value) => { setSearch(value); setLimit(PAGE); }} style={[kit.input, kit.flex]}
          placeholder="Szukaj sprzętu: nazwa, marka, model, kategoria…" placeholderTextColor={ink(0.35)} autoCorrect={false} />
        <Chip label={`Tylko wybrane (${batchCount})`} active={onlyPicked} disabled={!batchCount && !onlyPicked} onPress={() => setOnlyPicked((value) => !value)} />
      </View>
      {catalogLoading ? <ActivityIndicator color={colors.primary.gold} /> : catalogError ? <Text style={kit.warningText}>{catalogError}</Text> : (
        <View style={kit.gapSm}>
          {!batchRows.length ? <Text style={kit.muted}>Brak wyników.</Text> : null}
          {batchRows.slice(0, limit).map((option) => {
            const count = picks[option.id] ?? 0;
            const line = existingLine(option.id);
            const left = remaining(option) - count;
            const invalid = batchPrice(option) === null;
            return (
              <View key={option.id} style={[styles.pickRow, count > 0 && styles.pickRowActive]}>
                {thumb(option.thumbnail)}
                <View style={kit.flex}>
                  <Text style={[kit.text, styles.strong]} numberOfLines={2}>{option.title || option.label}</Text>
                  <Text style={kit.muted} numberOfLines={1}>{[option.subtitle, option.detail, option.power ? `${calcPlain(option.power)} W` : ''].filter(Boolean).join(' · ')}</Text>
                  <Text style={[kit.muted, { color: left > 0 ? colors.status.success : colors.text.tertiary }]}>
                    Stan: {calcPlain(option.stock ?? 0)} · Pozostało: {calcPlain(Math.max(left, 0))}{count > 0 ? ` · Dodano: ${count}` : ''}
                  </Text>
                </View>
                {line ? (
                  <Text style={[kit.muted, styles.priceCell]}>{calcMoney(line.unitPrice)} zł{'\n'}(w kalkulacji)</Text>
                ) : (
                  <View style={styles.priceCell}>
                    <TextInput value={priceText(option)} onChangeText={(value) => { setPriceDrafts((current) => ({ ...current, [option.id]: value })); setFormError(''); }}
                      keyboardType="decimal-pad" style={[styles.priceInput, invalid && { borderColor: colors.status.error }]} placeholder="0,00" placeholderTextColor={ink(0.35)}
                      accessibilityLabel={`Cena netto: ${option.title || option.label}`} />
                    <Text style={kit.muted}>zł netto</Text>
                  </View>
                )}
                <View style={styles.stepper}>
                  <TouchableOpacity onPress={() => bump(option, -1)} disabled={count <= 0} style={[styles.stepButton, count <= 0 && kit.disabled]} accessibilityLabel="Odejmij 1 szt.">
                    <Feather name="minus" size={18} color={colors.primary.gold} />
                  </TouchableOpacity>
                  <TextInput value={count ? String(count) : ''} onChangeText={(value) => setPick(option, Number(value.replace(/\D/g, '')) || 0)} keyboardType="number-pad"
                    style={styles.countInput} placeholder="0" placeholderTextColor={ink(0.35)} accessibilityLabel={`Ilość: ${option.title || option.label}`} />
                  <TouchableOpacity onPress={() => bump(option, 1)} disabled={count >= pickLimit(option)} style={[styles.stepButton, count >= pickLimit(option) && kit.disabled]} accessibilityLabel="Dodaj 1 szt.">
                    <Feather name="plus" size={18} color={colors.primary.gold} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          {batchRows.length > limit ? <SmallButton label={`Pokaż więcej (${limit} / ${batchRows.length})`} icon="chevron-down" onPress={() => setLimit((value) => value + PAGE)} /> : null}
        </View>
      )}
      <View style={styles.summary}>
        <Text style={kit.muted}>Ustaw ilość przy sprzęcie (− / + albo wpisz liczbę). Cenę netto wpiszesz przy sprzęcie (domyślnie cena rentalna z magazynu); nazwę i opis zmienisz po dodaniu („Edytuj” przy pozycji).</Text>
        <Text style={kit.text}>Wybrano: {batchCount} poz. · {batchPieces} szt. · {calcMoney(batchNetPerDay)} zł netto / dzień</Text>
        {batchMerge ? <Text style={kit.muted}>{batchMerge} z nich już jest w kalkulacji — zwiększy się ilość tych pozycji (nazwa, cena, dni i VAT bez zmian).</Text> : null}
        <View style={kit.row}>
          <View style={styles.smallField}><Label>Dni</Label><TextInput value={days} onChangeText={setDays} keyboardType="decimal-pad" style={kit.input} /></View>
          <View style={styles.smallField}><Label>VAT %</Label><TextInput value={vat} onChangeText={setVat} keyboardType="decimal-pad" style={kit.input} /></View>
          {batchCount ? <SmallButton label="Wyczyść wybór" icon="x" onPress={() => { setPicks({}); setOnlyPicked(false); }} /> : null}
        </View>
      </View>
    </View>
  );

  const catalogSection = selected && !browsing ? (
    <View style={styles.chosen}>
      {mode === 'warehouse' ? thumb(selected.thumbnail) : null}
      <View style={kit.flex}>
        <Text style={kit.text}>{mode === 'vehicle' ? 'Pojazd — informacja wewnętrzna: ' : mode === 'product' ? 'Usługa z katalogu: ' : 'Sprzęt: '}{selected.label}</Text>
        {mode === 'vehicle' ? <Text style={kit.muted}>W kalkulacji dla klienta pojawią się wyłącznie nazwa i opis pozycji poniżej. Wybór pojazdu nie rezerwuje go.</Text> : null}
        {mode === 'warehouse' && selected.stock != null ? <Text style={kit.muted}>Stan: {calcPlain(selected.stock)}</Text> : null}
      </View>
      <SmallButton label={mode === 'vehicle' ? 'Wybierz inny pojazd' : mode === 'product' ? 'Wybierz inną usługę' : 'Wybierz inny sprzęt'} icon="repeat" onPress={() => setBrowsing(true)} />
    </View>
  ) : (
    <View style={kit.gapSm}>
      {selected ? <SmallButton label={`Wróć do wybranej pozycji: ${selected.label}`} icon="chevron-left" onPress={() => setBrowsing(false)} /> : null}
      <TextInput value={search} onChangeText={(value) => { setSearch(value); setLimit(PAGE); }} style={kit.input}
        placeholder={mode === 'product' ? 'Szukaj usługi personelu…' : mode === 'vehicle' ? 'Szukaj pojazdu…' : 'Szukaj sprzętu…'} placeholderTextColor={ink(0.35)} autoCorrect={false} />
      {catalogLoading ? <ActivityIndicator color={colors.primary.gold} /> : catalogError ? <Text style={kit.warningText}>{catalogError}</Text> : !catalog.length ? (
        <Text style={kit.muted}>
          {mode === 'product'
            ? 'Brak usług. Otwórz kartę produktu → Podstawowe informacje → Edytuj. Zaznacz „Usługa personelu — bez sprzętu” oraz „Produkt aktywny”, a następnie zapisz sekcję.'
            : mode === 'vehicle' ? 'Brak dostępnych pojazdów.' : 'Brak sprzętu w magazynie.'}
        </Text>
      ) : (
        <View style={styles.catalog}>
          {catalogRows.slice(0, limit).map((option) => (
            <TouchableOpacity key={option.id} onPress={() => pick(option)} style={kit.selectRow} accessibilityRole="button">
              {mode !== 'vehicle' ? thumb(option.thumbnail) : <Feather name="truck" size={18} color={colors.text.tertiary} />}
              <View style={kit.flex}>
                <Text style={kit.text} numberOfLines={2}>{option.label}</Text>
                <Text style={kit.muted} numberOfLines={2}>
                  {mode === 'product'
                    ? `Obsada: ${option.people != null ? `${calcPlain(option.people)} os.` : 'nie określono'} · Jednostka: ${option.unit} · Min. ilość: ${calcPlain(option.minimum ?? 1)} ${option.unit} · ${calcMoney(option.price)} zł netto`
                    : mode === 'warehouse' ? `${calcMoney(option.price)} zł / dzień · Stan: ${calcPlain(option.stock ?? 0)}` : option.fuelType || ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.text.tertiary} />
            </TouchableOpacity>
          ))}
          {catalogRows.length > limit ? <SmallButton label={`Pokaż więcej (${limit} / ${catalogRows.length})`} icon="chevron-down" onPress={() => setLimit((value) => value + PAGE)} /> : null}
        </View>
      )}
    </View>
  );

  const fields = (
    <View style={kit.gapSm}>
      <Label>Nazwa</Label>
      <TextInput value={name} onChangeText={setName} style={kit.input} placeholder="Nazwa pozycji…" placeholderTextColor={ink(0.35)} />
      <Label>Opis</Label>
      <TextInput value={details} onChangeText={setDetails} multiline style={[kit.input, kit.multiline]} placeholder="Opcjonalny opis…" placeholderTextColor={ink(0.35)} />
      {category === 'transport' ? (
        <>
          <TravelPanel key={selected?.id || 'manual-transport'} inquiryId={inquiryId} calculationId={calculationId} vehicleId={mode === 'vehicle' ? selected?.id || '' : ''}
            vehicleFuelType={vehicleFuelType} initial={sourceChanged ? null : editing?.transportEstimate ?? null} days={days} onDays={setDays} onUnitPrice={setUnitPrice}
            onEstimate={setEstimate} onBusy={setTravelBusy} onPending={setTravelPending} />
          {travelPending ? (
            <TouchableOpacity onPress={() => { setTravelPending(false); setEstimate(null); }} disabled={travelBusy}>
              <Text style={kit.link}>Użyj ręcznie wpisanego dystansu i stawki poniżej</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
      <View style={kit.row}>
        <View style={styles.field}>
          <Label>{category === 'transport' ? 'Ilość aut' : 'Ilość'}</Label>
          <TextInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" style={kit.input} />
          {stockExceeded ? <Text style={kit.warningText}>Przekroczono stan ({calcPlain(selected?.stock ?? 0)} dostępne)</Text> : null}
        </View>
        <View style={styles.field}><Label>Jednostka</Label><TextInput value={unit} onChangeText={setUnit} style={kit.input} /></View>
        <View style={styles.field}>
          <Label>{category === 'transport' ? 'Odległość (km)' : 'Dni'}</Label>
          <TextInput value={days} editable={!travelBusy} keyboardType="decimal-pad" style={kit.input}
            onChangeText={(value) => { setDays(value); if (category === 'transport') { setEstimate(null); setTravelPending(false); } }} />
        </View>
        <View style={styles.field}><Label>VAT %</Label><TextInput value={vat} onChangeText={setVat} keyboardType="decimal-pad" style={kit.input} /></View>
      </View>
      <View style={kit.row}>
        <View style={styles.field}>
          <Label>{category === 'transport' ? 'Stawka za km (netto)' : 'Cena jednostkowa (netto)'}</Label>
          <TextInput value={unitPrice} editable={!travelBusy} keyboardType="decimal-pad" style={kit.input}
            onChangeText={(value) => { setUnitPrice(value); if (category === 'transport') { setEstimate(null); setTravelPending(false); } }} />
        </View>
        {category === 'equipment' || category === 'other' ? (
          <View style={styles.field}><Label>Pobór mocy (W)</Label><TextInput value={power} onChangeText={setPower} keyboardType="decimal-pad" style={kit.input} placeholder="np. 575" placeholderTextColor={ink(0.35)} /></View>
        ) : <View style={styles.field} />}
      </View>
      {price > 0 ? (
        <View style={[kit.between, styles.preview]}>
          <Text style={[kit.muted, kit.flex]}>
            {category === 'transport'
              ? `${calcPlain(amount)} aut × ${calcPlain(price, 6)} zł/km × ${calcPlain(span)} km`
              : `${calcPlain(amount)} × ${calcMoney(price)} × ${calcPlain(span)} dni`}
          </Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={kit.text}>{calcMoney(net)} PLN netto</Text>
            <Text style={[kit.muted, { color: colors.primary.gold }]}>{calcMoney(gross)} PLN brutto</Text>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <Sheet visible title={editing ? 'Edytuj pozycję' : 'Dodaj pozycję'} onClose={() => { if (!submitting) onClose(); }} width={900}
      footer={(
        <>
          <TouchableOpacity onPress={onClose} disabled={submitting} style={kit.secondary}><Text style={kit.secondaryText}>Anuluj</Text></TouchableOpacity>
          {batchMode ? (
            <TouchableOpacity onPress={() => void submitBatch()} disabled={submitting || !batchCount} style={[kit.primary, (submitting || !batchCount) && kit.disabled]}>
              {submitting ? <ActivityIndicator color={colors.background.primary} /> : null}
              <Text style={kit.primaryText}>{submitting ? 'Dodaję…' : batchCount ? `Dodaj pozycje (${batchCount})` : 'Dodaj pozycje'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => void submit()} disabled={!canSubmit} style={[kit.primary, !canSubmit && kit.disabled]}>
              {submitting ? <ActivityIndicator color={colors.background.primary} /> : null}
              <Text style={kit.primaryText}>{submitting ? 'Zapisuję…' : editing ? 'Zapisz zmiany' : 'Dodaj pozycję'}</Text>
            </TouchableOpacity>
          )}
        </>
      )}>
      {MODES[category].length ? (
        <Segmented value={mode} onChange={switchMode} options={MODES[category].map((id) => ({ id, label: MODE_LABELS[id] }))} />
      ) : null}
      {batchMode ? batch : (
        <>
          {mode !== 'manual' ? catalogSection : null}
          {mode === 'manual' || selected ? fields : null}
        </>
      )}
      {formError ? <Text style={kit.warningText}>{formError}</Text> : null}
    </Sheet>
  );
}

/**
 * „Trasa i koszt paliwa” (`CalculationVehicleTravel` + `VehicleTravelCalculator`): start, cel z zapytania / wydarzenia albo wpisany,
 * powrót, paliwo, spalanie (karta auta / tankowania) i cena (AutoCentrum, brutto), VAT paliwa → dystans (km) i stawka netto/km
 * w pozycji oraz zapis szacunku (`transport_estimate`).
 */
function TravelPanel({ inquiryId, calculationId, vehicleId, vehicleFuelType, initial, days, onDays, onUnitPrice, onEstimate, onBusy, onPending }: {
  inquiryId: string; calculationId: string; vehicleId: string; vehicleFuelType: string | null; initial: Record<string, unknown> | null; days: string;
  onDays: (value: string) => void; onUnitPrice: (value: string) => void; onEstimate: (value: Record<string, unknown> | null) => void;
  onBusy: (value: boolean) => void; onPending: (value: boolean) => void;
}) {
  const saved = initial || {};
  const savedFuel = (saved.fuel && typeof saved.fuel === 'object' ? saved.fuel : {}) as Record<string, unknown>;
  const savedRoute = saved.route && typeof saved.route === 'object' ? saved.route as CalcRoute : null;
  const savedType = typeof savedFuel.fuel_type === 'string' && savedFuel.fuel_type ? savedFuel.fuel_type : null;
  const [origin, setOrigin] = useState(typeof saved.origin === 'string' && saved.origin ? saved.origin : TRAVEL_ORIGIN);
  const [destination, setDestination] = useState(typeof saved.destination === 'string' ? saved.destination : '');
  const [manual, setManual] = useState(Boolean(typeof saved.destination === 'string' && saved.destination));
  const [suggested, setSuggested] = useState<CalcTravelContext['destination']>(null);
  const [contextError, setContextError] = useState('');
  const [fuelVat, setFuelVat] = useState(typeof saved.fuel_vat_percent === 'number' ? calcPlain(saved.fuel_vat_percent) : '23');
  const [route, setRoute] = useState<CalcRoute | null>(savedRoute);
  const [routeDirty, setRouteDirty] = useState(false);
  const [roundTrip, setRoundTrip] = useState(savedRoute ? savedRoute.round_trip !== false : true);
  const [fuelOverride, setFuelOverride] = useState<string | null>(null);
  const [manualPrices, setManualPrices] = useState<Record<string, string>>(
    typeof savedFuel.price === 'number' && savedFuel.price_source !== 'autocentrum' ? { [savedType || 'diesel']: calcPlain(savedFuel.price, 3) } : {},
  );
  const [manualConsumption, setManualConsumption] = useState<string | null>(typeof savedFuel.consumption === 'number' ? calcPlain(savedFuel.consumption) : null);
  const [consumptionInfo, setConsumptionInfo] = useState<{ value: number | null; source: string | null; error: string | null } | null>(null);
  const [quote, setQuote] = useState<CalcFuelQuote | null>(savedFuel.quote && typeof savedFuel.quote === 'object' ? savedFuel.quote as CalcFuelQuote : null);
  const [quoteError, setQuoteError] = useState('');
  const [priceLoading, setPriceLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [message, setMessage] = useState('');

  const fuelType = fuelOverride || vehicleFuelType || savedType || 'diesel';
  const liquid = isLiquidFuel(fuelType);
  const quoted = quote?.prices?.[fuelType];
  const price = manualPrices[fuelType] ?? (typeof quoted === 'number' ? calcPlain(quoted, 3) : '');
  const consumption = manualConsumption ?? (consumptionInfo?.value != null ? calcPlain(consumptionInfo.value) : '');
  const distance = routeDirty ? '' : days;
  const cost = liquid && distance.trim() ? fuelCost(calcParse(distance) ?? NaN, calcParse(consumption) ?? 0, calcParse(price) ?? 0) : null;

  useEffect(() => {
    let active = true;
    loadCalcTravelContext(inquiryId, calculationId)
      .then((reply) => { if (!active) return; setSuggested(reply.destination); setDestination((current) => (manual ? current : reply.destination?.label || '')); })
      .catch((cause) => { if (active) setContextError(cause instanceof Error ? cause.message : 'Wpisz cel ręcznie.'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiryId, calculationId]);
  useEffect(() => {
    if (!vehicleId) { setConsumptionInfo(null); return; }
    let active = true;
    calcVehicleConsumption(inquiryId, vehicleId).then((reply) => { if (active) setConsumptionInfo(reply); }).catch(() => { if (active) setConsumptionInfo(null); });
    return () => { active = false; };
  }, [inquiryId, vehicleId]);
  useEffect(() => {
    let active = true;
    setPriceLoading(true); setQuoteError('');
    calcFuelQuote(inquiryId).then((reply) => { if (active) setQuote(reply); })
      .catch((cause) => { if (active) { setQuote(null); setQuoteError(cause instanceof Error ? cause.message : 'Wpisz cenę paliwa ręcznie.'); } })
      .finally(() => { if (active) setPriceLoading(false); });
    return () => { active = false; };
  }, [inquiryId, refresh]);
  useEffect(() => () => onBusy(false), [onBusy]);

  const invalidateRoute = () => { setRouteDirty(true); setRoute(null); onPending(true); setMessage('Cel lub kierunek zmienił się. Oblicz trasę ponownie.'); };
  const settingsChanged = () => { onPending(true); setMessage('Ustawienia paliwa zmieniły się. Dotknij „Zastosuj koszt”.'); };

  /** Dystans → pole km, stawka netto/km z ceny brutto paliwa i VAT, zapis szacunku (jak w CRM i na Macu). */
  const apply = (distanceKm: number | null, newRoute: CalcRoute | null) => {
    const km = distanceKm ?? calcParse(days) ?? NaN;
    const nextRoute = newRoute ?? route;
    if (newRoute) { setRoute(newRoute); setRouteDirty(false); }
    if (distanceKm !== null) onDays(calcPlain(distanceKm, 1));
    const fuelPrice = calcParse(price) ?? 0;
    const fuelConsumption = calcParse(consumption) ?? 0;
    const rateVat = calcParse(fuelVat) ?? -1;
    if (!(fuelPrice > 0) || !(fuelConsumption > 0) || !Number.isFinite(km) || km <= 0 || rateVat < 0 || rateVat > 100) {
      onPending(true);
      setMessage('Uzupełnij spalanie, cenę paliwa i VAT paliwa, a następnie zastosuj koszt.');
      return;
    }
    const rate = fuelRatePerKm(fuelConsumption, fuelPrice, rateVat);
    const manualPrice = manualPrices[fuelType] !== undefined;
    onUnitPrice(calcPlain(rate, 6));
    onEstimate({
      version: 1, origin, destination,
      fuel: {
        fuel_type: fuelType, price: fuelPrice > 0 ? fuelPrice : null, consumption: fuelConsumption > 0 ? fuelConsumption : null,
        price_source: manualPrice ? 'manual' : 'autocentrum', quote: manualPrice ? null : quote,
      },
      fuel_vat_percent: rateVat, distance_km: km, rate_net_per_km: rate,
      fuel_cost_gross: Math.round(km * fuelConsumption / 100 * fuelPrice * 100) / 100,
      route: nextRoute, applied_at: new Date().toISOString(),
    });
    onPending(false);
    setMessage(`Zastosowano ${calcPlain(km)} km i ${calcPlain(rate, 6)} zł netto/km. Liczba aut jest mnożona w pozycji kalkulacji.`);
  };
  const calculate = async () => {
    if (routeLoading) return;
    setRouteLoading(true); onBusy(true); setRouteError('');
    try {
      const reply = await calcRoute(inquiryId, calculationId, origin, roundTrip, manual ? destination : null);
      if (typeof reply.distanceKm !== 'number') throw new Error('Nie udało się obliczyć trasy.');
      apply(reply.distanceKm, reply);
    } catch (cause) {
      setRouteError(cause instanceof Error ? cause.message : 'Nie udało się obliczyć trasy.');
    } finally {
      setRouteLoading(false); onBusy(false);
    }
  };

  const routeKm = route?.distanceKm;
  const showRoute = route && typeof routeKm === 'number' && calcParse(distance) === routeKm;
  const consumptionText = manualConsumption !== null ? 'Spalanie zapisane dla tej kalkulacji lub wpisane ręcznie.'
    : consumptionInfo?.source === 'vehicle' ? 'Średnie spalanie z karty auta. Możesz je skorygować dla tego przejazdu, np. przy jeździe z przyczepą.'
      : consumptionInfo?.value != null ? 'Spalanie z tankowań z ostatnich 90 dni, ważone przejechanym dystansem. Możesz je skorygować, np. dla jazdy z przyczepą.'
        : consumptionInfo?.error || 'Uzupełnij średnie spalanie na karcie auta lub wpisz je dla tego przejazdu.';
  const priceText = manualPrices[fuelType] !== undefined ? 'Cena wpisana ręcznie.'
    : typeof quoted === 'number' ? `Średnia krajowa: AutoCentrum.pl. Aktualizacja źródła: ${quote?.sourceUpdated || ''}${quote?.fetchedAt ? ` (pobrano ${new Date(quote.fetchedAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })})` : ''}.`
      : priceLoading ? 'Pobieranie cen paliw…' : 'Brak ceny dla wybranego paliwa — wpisz ją ręcznie.';
  const openMaps = () => {
    if (!route) return;
    const start = route.outbound?.startAddress || origin;
    const end = route.outbound?.endAddress || destination;
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(start)}&destination=${encodeURIComponent(end)}&travelmode=driving`).catch(() => undefined);
  };

  return (
    <View style={styles.travel}>
      <Text style={[kit.text, styles.strong]}>Trasa i koszt paliwa</Text>
      <Label>Miejsce startu</Label>
      <TextInput value={origin} editable={!routeLoading} onChangeText={(value) => { setOrigin(value); invalidateRoute(); }} style={kit.input} />
      <Label>Miejsce docelowe</Label>
      <TextInput value={destination} editable={!routeLoading} placeholder="Nazwa obiektu, ulica, numer i miasto" placeholderTextColor={ink(0.35)} style={kit.input}
        onChangeText={(value) => { setManual(true); setDestination(value.slice(0, 500)); invalidateRoute(); }} />
      {suggested ? (
        <View style={kit.row}>
          <Text style={[kit.muted, kit.flex]}>Lokalizacja z {suggested.source === 'inquiry' ? 'zapytania' : 'wydarzenia'}: {suggested.label}</Text>
          {manual ? <SmallButton label="Użyj tej lokalizacji" icon="map-pin" disabled={routeLoading} onPress={() => { setManual(false); setDestination(suggested.label); invalidateRoute(); }} /> : null}
        </View>
      ) : null}
      {contextError ? <Text style={kit.warningText}>{contextError}</Text> : null}
      <View style={kit.wrap}>
        <Chip label="Z powrotem do miejsca startu" active={roundTrip} disabled={routeLoading} onPress={() => { setRoundTrip(true); if (!roundTrip) invalidateRoute(); }} />
        <Chip label="Tylko dojazd" active={!roundTrip} disabled={routeLoading} onPress={() => { setRoundTrip(false); if (roundTrip) invalidateRoute(); }} />
      </View>
      <View style={kit.row}>
        <View style={styles.field}>
          <Label>Paliwo</Label>
          <SelectField value={fuelType} onChange={(value) => { setFuelOverride(value); settingsChanged(); }} disabled={routeLoading}
            options={[...FUEL_TYPES, ...(FUEL_TYPES.some((item) => item.id === fuelType) ? [] : [{ id: fuelType, label: fuelType }])].map((item) => ({ id: item.id, label: item.label }))} />
        </View>
        <View style={styles.field}>
          <Label>Średnie spalanie (l/100 km)</Label>
          <TextInput value={liquid ? consumption : ''} editable={liquid && !routeLoading} keyboardType="decimal-pad" style={kit.input} placeholder="Uzupełnij spalanie" placeholderTextColor={ink(0.35)}
            onChangeText={(value) => { setManualConsumption(value); settingsChanged(); }} />
        </View>
        <View style={styles.field}>
          <Label>Cena paliwa (zł/l, brutto)</Label>
          <TextInput value={liquid ? price : ''} editable={liquid && !routeLoading} keyboardType="decimal-pad" style={kit.input} placeholder={priceLoading ? 'Pobieranie…' : 'Uzupełnij cenę'} placeholderTextColor={ink(0.35)}
            onChangeText={(value) => { setManualPrices((current) => ({ ...current, [fuelType]: value })); settingsChanged(); }} />
        </View>
        <View style={styles.field}>
          <Label>VAT w cenie paliwa (%)</Label>
          <TextInput value={fuelVat} editable={!routeLoading} keyboardType="decimal-pad" style={kit.input}
            onChangeText={(value) => { setFuelVat(value); onPending(true); setMessage('Zmieniono VAT paliwa. Zastosuj koszt ponownie.'); }} />
        </View>
      </View>
      {liquid ? (
        <>
          <Text style={kit.muted}>{consumptionText}</Text>
          <View style={kit.between}>
            <Text style={[kit.muted, kit.flex]}>{priceText}</Text>
            <SmallButton label="Pobierz cenę" icon="refresh-cw" disabled={priceLoading || routeLoading}
              onPress={() => { setManualPrices((current) => { const next = { ...current }; delete next[fuelType]; return next; }); setRefresh((value) => value + 1); settingsChanged(); }} />
          </View>
          {quoteError ? <Text style={kit.warningText}>{quoteError}</Text> : null}
        </>
      ) : <Text style={kit.muted}>Dla tego napędu uzupełnij koszt energii lub paliwa ręcznie w polu stawki poniżej.</Text>}
      <View style={kit.row}>
        <SmallButton label={routeLoading ? 'Obliczanie trasy…' : 'Oblicz trasę i koszt'} icon="navigation" primary
          disabled={routeLoading || !origin.trim() || !destination.trim()} onPress={() => void calculate()} />
        {cost !== null ? <SmallButton label={`Zastosuj koszt: ${calcMoney(cost)} zł`} icon="check" disabled={routeLoading} onPress={() => apply(null, null)} /> : null}
        {routeLoading ? <ActivityIndicator color={colors.primary.gold} /> : null}
      </View>
      {routeError ? <Text style={[kit.text, { color: colors.status.error }]}>{routeError}</Text> : null}
      {showRoute && route ? (
        <View style={kit.gapSm}>
          <Text style={kit.muted}>{route.outbound?.startAddress || origin} → {route.outbound?.endAddress || destination}</Text>
          <Text style={kit.muted}>
            Dojazd: {calcPlain((route.outbound?.distanceMeters || 0) / 1000, 1)} km · {route.travelMinutes} min
            {route.inbound ? ` · Powrót: ${calcPlain(route.inbound.distanceMeters / 1000, 1)} km · ${Math.ceil(route.inbound.durationSeconds / 60)} min` : ''}
            {` · Łącznie: ${calcPlain(route.distanceKm, 1)} km`}
          </Text>
          <TouchableOpacity onPress={openMaps}><Text style={kit.link}>Google Maps — zobacz dojazd</Text></TouchableOpacity>
        </View>
      ) : null}
      <Text style={kit.muted}>
        Koszt = łączny dystans × spalanie / 100 × cena litra. Po korekcie spalania lub ceny dotknij „Zastosuj koszt”. Cena AutoCentrum jest brutto — stawka paliwowa
        netto/km = spalanie ÷ 100 × cena litra brutto ÷ (1 + VAT paliwa ÷ 100). Obejmuje samo paliwo; opłaty drogowe, wynajem i pracę kierowcy wyceń osobno.
      </Text>
      {message ? <Text style={[kit.muted, { color: colors.primary.gold }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strong: { fontWeight: typography.fontWeights.semibold },
  thumb: { width: 44, height: 44, borderRadius: borderRadius.md, backgroundColor: glow(0.06) },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: glow(0.03),
    borderWidth: 1, borderColor: glow(0.06),
  },
  pickRowActive: { borderColor: colors.primary.gold, backgroundColor: glow(0.06) },
  priceCell: { width: 110, alignItems: 'flex-end', gap: 2 },
  priceInput: {
    width: 100, minHeight: 40, textAlign: 'right', color: colors.text.primary, fontSize: typography.fontSizes.md, paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md, borderWidth: 1, borderColor: glow(0.12), backgroundColor: glow(0.04),
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: glow(0.15) },
  countInput: {
    width: 52, minHeight: 44, textAlign: 'center', color: colors.text.primary, fontSize: typography.fontSizes.md, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: glow(0.12), backgroundColor: glow(0.04),
  },
  summary: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: glow(0.05) },
  smallField: { width: 120, gap: 2 },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: glow(0.05) },
  catalog: { borderRadius: borderRadius.lg, backgroundColor: glow(0.03) },
  field: { flex: 1, minWidth: 150, gap: 2 },
  preview: { padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: glow(0.05) },
  travel: { gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: glow(0.04) },
});
