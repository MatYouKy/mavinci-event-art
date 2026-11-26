import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  Chip, DateTimeField, Label, Segmented, SelectField, SelectList, Sheet, SheetActions, SmallButton, kit, useNotice,
} from '../Inquiries/InquiryKit';
import { supabase } from '../../lib/supabase';
import {
  checkRentalAvailability, issueRental, rentalCatalog, rentalCatalogFree, rentalCatalogMatches, rentalCategoryPaths, rentalCategoryScope,
  rentalCategoryTree, rentalDateTime, rentalErrorMessage, rentalIsoFromLocal, rentalItemUnits, rentalKitFree, rentalLineNet, rentalLinesDemand,
  rentalLocalInput, rentalMoney, rentalOutQty, rentalVehicleConflicts, resolveRentalItem, returnRental, saveRental, setRentalItems, setRentalStatus,
  setRentalTrips, type RentalAccess, type RentalAvailability, type RentalCatalog, type RentalCatalogItem, type RentalCatalogKit, type RentalDetail,
  type RentalHandover, type RentalItem, type RentalItemInput, type RentalResolveAction, type RentalSaveData, type RentalTripInput, type RentalTripKind,
  type RentalUnit, type RentalVehicleConflict,
} from '../../lib/rental';
import {
  loadRentalOptions, searchRentalClients, uploadRentalProtocolAsset, type RentalAsset, type RentalClientHit, type RentalOptions,
} from '../../lib/rentalApi';
import { chooseRentalSource, pickRentalAssets, rentalConflictText, rentalCount, rentalNumber, rentalPlain, ui } from './rentalUi';
import { borderRadius, colors, spacing, typography } from '../../theme';

/*
 * Okna karty wypożyczenia w telefonie — jak okna CRM (`src/components/crm/rental/*`) i Maca: dane wypożyczenia, pozycje
 * z katalogu magazynu (wolne sztuki w oknie od wyjazdu do powrotu sprzętu), protokół wydania / odbioru (zdjęcia z aparatu do linii), rozstrzygnięcie rozbieżności (egzemplarze),
 * dostawa i odbiór (pojazd, kierowca, zajętość pojazdu), anulowanie z powodem. Walidacja jak w CRM, resztę sprawdza baza.
 */

type Notice = ReturnType<typeof useNotice>;

/** Dzień (czas polski) przesunięty o `plusDays` od dziś, o pełnej godzinie — jak domyślne terminy w CRM. */
function warsawAt(plusDays: number, hour: number) {
  const [y, m, d] = rentalLocalInput(new Date().toISOString()).slice(0, 10).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + plusDays)).toISOString().slice(0, 10);
  return new Date(rentalIsoFromLocal(`${day}T${String(hour).padStart(2, '0')}:00`) || Date.now());
}

const trimmed = (value: string) => value.trim() || null;

// MARK: Dane wypożyczenia

export function RentalFormSheet({ visible, rental, access, notice, onClose, onSaved }: {
  visible: boolean; rental: RentalDetail | null; access: RentalAccess | null; notice: Notice; onClose: () => void; onSaved: (id: string) => void;
}) {
  const [client, setClient] = useState<RentalClientHit | null>(null);
  const [clientName, setClientName] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RentalClientHit[]>([]);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(new Date());
  const [endsAt, setEndsAt] = useState(new Date());
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [handover, setHandover] = useState<RentalHandover>('pickup');
  const [address, setAddress] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [deposit, setDeposit] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [vat, setVat] = useState('23');
  const [salesNote, setSalesNote] = useState('');
  const [warehouseNote, setWarehouseNote] = useState('');
  const [options, setOptions] = useState<RentalOptions | null>(null);

  const issued = !!rental && ['issued', 'returned'].includes(rental.status);
  const returned = rental?.status === 'returned';
  const canSeller = Boolean(access?.admin || access?.sales_all || rental?.access.admin || rental?.access.sales_all);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setHits([]);
    if (rental) {
      setClient(rental.organization_id ? { kind: 'organization', id: rental.organization_id, name: rental.organization_name || rental.client_name }
        : rental.contact_id ? { kind: 'contact', id: rental.contact_id, name: rental.contact_name || rental.client_name } : null);
      setClientName(rental.organization_id || rental.contact_id ? '' : rental.client_name);
      setTitle(rental.title || '');
      setStartsAt(new Date(rental.starts_at));
      setEndsAt(new Date(rental.ends_at));
      setRecipientName(rental.recipient_name || '');
      setRecipientPhone(rental.recipient_phone || '');
      setHandover(rental.handover);
      setAddress(rental.delivery_address || '');
      setSellerId(rental.seller_id || '');
      setCompanyId(rental.my_company_id || '');
      setDeposit(rentalPlain(rental.sales?.deposit_amount ?? 0));
      setDiscount(rentalPlain(rental.sales?.discount_percent ?? 0));
      setVat(rentalPlain(rental.sales?.vat_rate ?? 23));
      setSalesNote(rental.sales?.sales_note || '');
      setWarehouseNote(rental.warehouse_note || '');
    } else {
      setClient(null); setClientName(''); setTitle('');
      setStartsAt(warsawAt(1, 10)); setEndsAt(warsawAt(3, 12));
      setRecipientName(''); setRecipientPhone(''); setHandover('pickup'); setAddress('');
      setSellerId(access?.employee_id || ''); setCompanyId('');
      setDeposit('0'); setDiscount('0'); setVat('23'); setSalesNote(''); setWarehouseNote('');
    }
    if (!options) loadRentalOptions().then(setOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rental?.id]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) { setHits([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      searchRentalClients(text).then((rows) => { if (alive) setHits(rows); }).catch(() => { if (alive) setHits([]); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  const save = async () => {
    if (!client && !clientName.trim()) { notice.notify('Wskaż klienta z bazy albo wpisz nazwę klienta.', true); return; }
    if (endsAt.getTime() <= startsAt.getTime()) { notice.notify('Zwrot musi być po wydaniu.', true); return; }
    if (handover === 'delivery' && !address.trim()) { notice.notify('Podaj adres dostawy.', true); return; }
    const data: RentalSaveData = {
      title: title.trim(),
      organization_id: client?.kind === 'organization' ? client.id : null,
      contact_id: client?.kind === 'contact' ? client.id : null,
      client_name: client ? client.name : clientName.trim(),
      recipient_name: trimmed(recipientName),
      recipient_phone: trimmed(recipientPhone),
      sales_note: trimmed(salesNote),
      warehouse_note: trimmed(warehouseNote),
      deposit_amount: rentalNumber(deposit) ?? 0,
      discount_percent: rentalNumber(discount) ?? 0,
      vat_rate: rentalNumber(vat) ?? 23,
    };
    if (!issued) {
      data.starts_at = startsAt.toISOString();
      data.handover = handover;
    }
    if (!returned) data.ends_at = endsAt.toISOString();
    data.delivery_address = handover === 'delivery' ? address.trim() : null;
    if (companyId) data.my_company_id = companyId;
    if (canSeller && sellerId) data.seller_id = sellerId;
    const id = await notice.run('Zapisywanie…', () => saveRental(supabase, rental?.id || null, data),
      rental ? 'Zapisano zmiany wypożyczenia' : 'Utworzono wypożyczenie');
    if (id) onSaved(id);
  };

  return (
    <Sheet visible={visible} title={rental ? 'Dane wypożyczenia' : 'Nowe wypożyczenie'} subtitle={rental?.number} onClose={onClose}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void save()} label={rental ? 'Zapisz' : 'Utwórz'} saving={!!notice.busy} />}>
      <Label>Klient</Label>
      {client ? (
        <View style={[kit.selectField, ui.row]}>
          <Feather name={client.kind === 'organization' ? 'briefcase' : 'user'} size={16} color={colors.primary.gold} />
          <Text style={[ui.text, ui.flex]} numberOfLines={1}>{client.name}</Text>
          <TouchableOpacity onPress={() => setClient(null)} accessibilityRole="button"><Text style={ui.link}>Zmień</Text></TouchableOpacity>
        </View>
      ) : (
        <>
          <TextInput value={query} onChangeText={setQuery} placeholder="Szukaj w bazie (organizacja lub osoba)" placeholderTextColor={colors.text.tertiary}
            style={kit.input} autoCorrect={false} />
          {hits.length ? (
            <SelectList options={hits.map((hit) => ({ id: `${hit.kind}:${hit.id}`, label: hit.name, detail: hit.kind === 'organization' ? 'Organizacja' : 'Osoba' }))}
              selected={[]} searchable={false} onToggle={(key) => { const hit = hits.find((row) => `${row.kind}:${row.id}` === key); if (hit) { setClient(hit); setQuery(''); setHits([]); } }} />
          ) : null}
          <TextInput value={clientName} onChangeText={setClientName} placeholder="…albo klient spoza bazy (nazwa)" placeholderTextColor={colors.text.tertiary} style={kit.input} />
        </>
      )}
      <Label>Nazwa wypożyczenia</Label>
      <TextInput value={title} onChangeText={setTitle} placeholder="Np. Dekoracje — wesele 12.12" placeholderTextColor={colors.text.tertiary} style={kit.input} />
      <Label>Wydanie</Label>
      {issued ? <Text style={ui.text}>{rentalDateTime(startsAt.toISOString())}</Text> : <DateTimeField value={startsAt} onChange={setStartsAt} />}
      <Label>Planowany zwrot</Label>
      {returned ? <Text style={ui.text}>{rentalDateTime(endsAt.toISOString())}</Text> : <DateTimeField value={endsAt} onChange={setEndsAt} />}
      <Label>Odbierający</Label>
      <TextInput value={recipientName} onChangeText={setRecipientName} placeholder="Imię i nazwisko" placeholderTextColor={colors.text.tertiary} style={kit.input} />
      <TextInput value={recipientPhone} onChangeText={setRecipientPhone} placeholder="Telefon" placeholderTextColor={colors.text.tertiary} style={kit.input}
        keyboardType="phone-pad" />
      <Label>Przekazanie</Label>
      {issued ? <Text style={ui.text}>{handover === 'delivery' ? 'Dostawa' : 'Odbiór własny'}</Text> : (
        <Segmented value={handover} options={[{ id: 'pickup', label: 'Odbiór własny' }, { id: 'delivery', label: 'Dostawa' }]} onChange={setHandover} />
      )}
      {handover === 'delivery' ? (
        <TextInput value={address} onChangeText={setAddress} placeholder="Adres dostawy" placeholderTextColor={colors.text.tertiary} style={[kit.input, kit.multiline]} multiline />
      ) : null}
      {options && options.companies.length > 1 ? (
        <>
          <Label>Firma</Label>
          <SelectField value={companyId} onChange={setCompanyId} placeholder="Domyślna"
            options={[{ id: '', label: 'Domyślna' }, ...options.companies.map((company) => ({ id: company.id, label: company.name }))]} />
        </>
      ) : null}
      {canSeller && options?.employees.length ? (
        <>
          <Label>Opiekun</Label>
          <SelectField value={sellerId} onChange={setSellerId} options={options.employees.map((employee) => ({ id: employee.id, label: employee.name }))} />
        </>
      ) : null}
      <View style={ui.row}>
        <View style={ui.flex}><Label>Kaucja (zł)</Label><TextInput value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" style={kit.input} /></View>
        <View style={ui.flex}><Label>Rabat (%)</Label><TextInput value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" style={kit.input} /></View>
        <View style={ui.flex}><Label>VAT (%)</Label><TextInput value={vat} onChangeText={setVat} keyboardType="decimal-pad" style={kit.input} /></View>
      </View>
      <Label>Uwagi sprzedaży (widzi tylko sprzedaż)</Label>
      <TextInput value={salesNote} onChangeText={setSalesNote} multiline style={[kit.input, kit.multiline]} />
      <Label>Uwagi dla magazynu</Label>
      <TextInput value={warehouseNote} onChangeText={setWarehouseNote} multiline style={[kit.input, kit.multiline]} />
    </Sheet>
  );
}

// MARK: Pozycje — katalog magazynu i wybrane pozycje (jak `RentalItemsModal` w CRM i okno pozycji na Macu)

type ItemLine = {
  key: string; id?: string; kind: 'equipment' | 'service'; equipment_id: string | null; kit_id: string | null; kit_name: string | null; name: string;
  quantity: string; price_mode: 'per_day' | 'flat'; unit_price: string; days: string; discount: string; replacement: string; note: string;
  issued: number; settled: number;
};
type ItemsTab = 'catalog' | 'lines';
let lineCounter = 0;
const lineKey = () => `line-${Date.now()}-${(lineCounter += 1)}`;
/** Ile wierszy katalogu naraz (dalsze — „Pokaż więcej”). */
const CATALOG_PAGE = 60;
const isDirect = (line: ItemLine, equipmentId: string) => line.kind === 'equipment' && line.equipment_id === equipmentId && !line.kit_id;
const isNewKit = (line: ItemLine, kitId: string) => line.kind === 'equipment' && line.kit_id === kitId && !line.equipment_id;

/** −/ilość/+ w wierszu katalogu; wpisana ilość zapisuje się po zakończeniu edycji (przycięta do wolnych sztuk). */
function QuantityStepper({ value, canAdd, label, onChange }: { value: number; canAdd: boolean; label: string; onChange: (next: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => { setText(value ? String(value) : ''); }, [value]);
  return (
    <View style={catalogStyles.stepper}>
      <TouchableOpacity onPress={() => onChange(value - 1)} disabled={value <= 0} style={[catalogStyles.stepButton, value <= 0 && kit.disabled]}
        accessibilityRole="button" accessibilityLabel={`Mniej: ${label}`}>
        <Feather name="minus" size={16} color={colors.text.primary} />
      </TouchableOpacity>
      <TextInput value={text} onChangeText={setText} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.text.tertiary}
        selectTextOnFocus style={catalogStyles.stepInput} accessibilityLabel={`Ilość: ${label}`}
        onEndEditing={() => { onChange(rentalCount(text)); setText(value ? String(value) : ''); }} />
      <TouchableOpacity onPress={() => onChange(value + 1)} disabled={!canAdd} style={[catalogStyles.stepButton, !canAdd && kit.disabled]}
        accessibilityRole="button" accessibilityLabel={`Więcej: ${label}`}>
        <Feather name="plus" size={16} color={colors.primary.gold} />
      </TouchableOpacity>
    </View>
  );
}

function CatalogThumb({ url, icon }: { url: string | null; icon: 'package' | 'layers' }) {
  return url
    ? <Image source={{ uri: url }} style={catalogStyles.thumb} accessibilityIgnoresInvertColors />
    : <View style={[catalogStyles.thumb, catalogStyles.thumbEmpty]}><Feather name={icon} size={18} color={colors.primary.gold} /></View>;
}

export function RentalItemsSheet({ visible, rental, notice, startInCatalog = false, onClose, onSaved }: {
  visible: boolean; rental: RentalDetail; notice: Notice; startInCatalog?: boolean; onClose: () => void; onSaved: (rental: RentalDetail) => void;
}) {
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [tab, setTab] = useState<ItemsTab>('lines');
  const [catalog, setCatalog] = useState<RentalCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [hideBusy, setHideBusy] = useState(false);
  const [limit, setLimit] = useState(CATALOG_PAGE);
  const [availability, setAvailability] = useState<Record<string, RentalAvailability>>({});
  const [checking, setChecking] = useState(false);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      setCatalog(await rentalCatalog(supabase, rental.starts_at, rental.ends_at, rental.id));
    } catch (cause) {
      setCatalogError(rentalErrorMessage(cause, 'Nie udało się pobrać katalogu magazynu.'));
    } finally {
      setCatalogLoading(false);
    }
  }, [rental.ends_at, rental.id, rental.starts_at]);

  useEffect(() => {
    if (!visible) return;
    setAvailability({});
    setQuery('');
    setCategoryId('');
    setHideBusy(false);
    setLimit(CATALOG_PAGE);
    setLines(rental.items.map((item) => ({
      key: item.id, id: item.id, kind: item.kind, equipment_id: item.equipment_id, kit_id: item.kit_id, kit_name: item.kit_name, name: item.name,
      quantity: String(item.quantity), price_mode: item.price_mode || 'per_day', unit_price: rentalPlain(item.unit_price ?? 0), days: rentalPlain(item.days ?? null),
      discount: rentalPlain(item.discount_percent ?? 0), replacement: rentalPlain(item.replacement_value ?? null), note: item.note || '',
      issued: item.issued_qty,
      settled: item.returned_ok_qty + item.damaged_back_qty + item.damaged_out_qty + item.missing_back_qty + item.missing_out_qty,
    })));
    setTab(startInCatalog || !rental.items.length ? 'catalog' : 'lines');
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rental.id]);

  const kits = useMemo(() => catalog?.kits || [], [catalog]);
  const itemsById = useMemo(() => new Map((catalog?.items || []).map((item) => [item.id, item])), [catalog]);
  const paths = useMemo(() => rentalCategoryPaths(catalog?.categories || []), [catalog]);
  const scope = useMemo(() => (categoryId && catalog ? rentalCategoryScope(catalog.categories, categoryId) : null), [catalog, categoryId]);
  const categoryOptions = useMemo(() => [
    { id: '', label: 'Wszystkie kategorie' },
    ...rentalCategoryTree(catalog?.categories || []).map(({ category }) => ({ id: category.id, label: paths.get(category.id) || category.name })),
  ], [catalog, paths]);

  /** Sztuki sprzętu zajęte przez pozycje (zestawy jeszcze nierozpisane — wg składu z katalogu); `skip` pomija pozycje. */
  const demandOf = useCallback((source: ItemLine[], skip?: (line: ItemLine) => boolean) => rentalLinesDemand(
    source.filter((line) => !skip?.(line)).map((line) => ({
      kind: line.kind, equipment_id: line.equipment_id, kit_id: line.kit_id, quantity: rentalCount(line.quantity), settled: line.settled,
    })), kits), [kits]);
  const demand = useMemo(() => demandOf(lines), [demandOf, lines]);
  const demandList = useMemo(() => [...demand].map(([equipment_id, quantity]) => ({ equipment_id, quantity })), [demand]);
  const demandKey = JSON.stringify(demandList);

  useEffect(() => {
    if (!visible) return;
    if (!demandList.length) { setAvailability({}); return; }
    let alive = true;
    const timer = setTimeout(() => {
      setChecking(true);
      checkRentalAvailability(supabase, rental.starts_at, rental.ends_at, demandList, rental.id)
        .then((rows) => { if (alive) setAvailability(Object.fromEntries(rows.map((row) => [row.equipment_id, row]))); })
        .catch((cause) => { if (alive) notice.notify(cause instanceof Error ? cause.message : 'Nie udało się sprawdzić dostępności.', true); })
        .finally(() => { if (alive) setChecking(false); });
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, demandKey, rental.id, rental.starts_at, rental.ends_at]);

  const update = (key: string, patch: Partial<ItemLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const blank = { id: undefined, kit_name: null, days: '', discount: '0', replacement: '', note: '', issued: 0, settled: 0, price_mode: 'per_day' as const };

  /** Ilość sprzętu w pozycjach bez zestawu: najwyżej wolne w oknie (minus inne pozycje), najmniej tyle, ile wydano. */
  const setEquipment = (item: RentalCatalogItem, wanted: number) => setLines((current) => {
    const direct = current.filter((line) => isDirect(line, item.id));
    const selected = direct.reduce((sum, line) => sum + rentalCount(line.quantity), 0);
    const minimum = direct.reduce((sum, line) => sum + line.issued, 0);
    const others = demandOf(current, (line) => isDirect(line, item.id)).get(item.id) || 0;
    const settled = direct.reduce((sum, line) => sum + line.settled, 0);
    const maximum = item.available - others + settled;
    let target = Math.max(0, Math.floor(wanted));
    if (target > selected) target = Math.max(selected, Math.min(target, maximum));
    target = Math.max(target, minimum);
    if (target === selected) return current;
    if (target > selected) {
      const first = direct[0];
      if (first) return current.map((line) => (line.key === first.key ? { ...line, quantity: String(rentalCount(line.quantity) + target - selected) } : line));
      return [...current, { ...blank, key: lineKey(), kind: 'equipment', equipment_id: item.id, kit_id: null, name: item.name, quantity: String(target), unit_price: rentalPlain(item.price ?? null) }];
    }
    let remaining = selected - target;
    const next = new Map<string, number>();
    for (const line of [...direct].reverse()) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, rentalCount(line.quantity) - line.issued);
      if (take <= 0) continue;
      next.set(line.key, rentalCount(line.quantity) - take);
      remaining -= take;
    }
    return current.flatMap((line) => {
      if (!next.has(line.key)) return [line];
      const quantity = next.get(line.key)!;
      return quantity > 0 ? [{ ...line, quantity: String(quantity) }] : [];
    });
  });

  /** Zestawy dodane teraz (rozpiszą się na składniki przy zapisie): najwyżej tyle kompletów, ile pozwalają wolne składniki. */
  const setKit = (entry: RentalCatalogKit, wanted: number) => setLines((current) => {
    const added = current.filter((line) => isNewKit(line, entry.id));
    const selected = added.reduce((sum, line) => sum + rentalCount(line.quantity), 0);
    const free = rentalKitFree(entry, itemsById, demandOf(current, (line) => isNewKit(line, entry.id)));
    let target = Math.max(0, Math.floor(wanted));
    if (target > selected) target = Math.max(selected, Math.min(target, free));
    if (target === selected) return current;
    const rest = current.filter((line) => !isNewKit(line, entry.id));
    if (target === 0) return rest;
    const first = added[0];
    const line: ItemLine = first
      ? { ...first, quantity: String(target) }
      : { ...blank, key: lineKey(), kind: 'equipment', equipment_id: null, kit_id: entry.id, kit_name: entry.name, name: `Zestaw: ${entry.name}`, quantity: String(target), unit_price: '0' };
    const index = first ? current.findIndex((row) => row.key === first.key) : -1;
    return index >= 0 ? [...rest.slice(0, index), line, ...rest.slice(index)] : [...rest, line];
  });

  const addService = () => {
    setTab('lines');
    setLines((current) => [...current, {
      key: lineKey(), kind: 'service', equipment_id: null, kit_id: null, kit_name: null, name: '', quantity: '1', price_mode: 'flat', unit_price: '0', days: '',
      discount: '0', replacement: '', note: '', issued: 0, settled: 0,
    }]);
  };

  const visibleItems = useMemo(() => {
    if (!catalog) return [];
    return catalog.items
      .filter((item) => !scope || (item.category_id && scope.has(item.category_id)))
      .filter((item) => rentalCatalogMatches(query, item.name, item.brand, item.model, item.category_id ? paths.get(item.category_id) : null))
      .filter((item) => !hideBusy || item.available > 0 || lines.some((line) => isDirect(line, item.id)))
      .map((item) => ({ item, path: (item.category_id && paths.get(item.category_id)) || 'Bez kategorii' }))
      .sort((a, b) => a.path.localeCompare(b.path, 'pl') || a.item.name.localeCompare(b.item.name, 'pl'));
  }, [catalog, hideBusy, lines, paths, query, scope]);
  const visibleKits = useMemo(() => kits
    .filter((entry) => !scope || (entry.category_id && scope.has(entry.category_id)))
    .filter((entry) => rentalCatalogMatches(query, entry.name, ...entry.components.map((part) => part.name)))
    .filter((entry) => !hideBusy || entry.available > 0 || lines.some((line) => isNewKit(line, entry.id))), [hideBusy, kits, lines, query, scope]);

  useEffect(() => { setLimit(CATALOG_PAGE); }, [query, categoryId, hideBusy]);

  const netOf = (line: ItemLine) => rentalLineNet({
    quantity: rentalCount(line.quantity), price_mode: line.price_mode, unit_price: rentalNumber(line.unit_price), days: rentalNumber(line.days),
    discount_percent: rentalNumber(line.discount) ?? 0,
  }, rental.default_days);
  const total = lines.reduce((sum, line) => sum + netOf(line), 0);
  const blocking = rental.status !== 'draft' && Object.values(availability).some((row) => row.shortage > 0);
  const equipmentLines = lines.filter((line) => line.kind === 'equipment');
  const equipmentPieces = equipmentLines.reduce((sum, line) => sum + rentalCount(line.quantity), 0);
  const windowWider = catalog
    ? new Date(catalog.window.starts_at).getTime() < new Date(rental.starts_at).getTime()
      || new Date(catalog.window.ends_at).getTime() > new Date(rental.ends_at).getTime()
    : false;

  const save = async () => {
    if (lines.some((line) => line.kind === 'service' && !line.name.trim())) { setTab('lines'); notice.notify('Podaj nazwę każdej usługi.', true); return; }
    if (lines.some((line) => rentalCount(line.quantity) < 1)) { setTab('lines'); notice.notify('Ilość każdej pozycji musi być większa od zera.', true); return; }
    if (lines.some((line) => line.id && rentalCount(line.quantity) < line.issued)) { setTab('lines'); notice.notify('Ilość nie może być mniejsza niż już wydana.', true); return; }
    const items: RentalItemInput[] = lines.map((line) => ({
      ...(line.id ? { id: line.id } : {}),
      kind: line.kind,
      equipment_id: line.equipment_id,
      kit_id: line.kit_id,
      name: line.kind === 'service' ? line.name.trim() : line.kit_id && !line.equipment_id ? undefined : line.name,
      quantity: rentalCount(line.quantity),
      ...(line.kind === 'service' && !line.id ? { unit: 'usł.' } : {}),
      price_mode: line.price_mode,
      unit_price: rentalNumber(line.unit_price),
      days: rentalNumber(line.days),
      discount_percent: rentalNumber(line.discount) ?? 0,
      ...(line.kind === 'equipment' ? { replacement_value: rentalNumber(line.replacement) } : {}),
      note: trimmed(line.note),
    }));
    const saved = await notice.run('Zapisywanie…', () => setRentalItems(supabase, rental.id, items), 'Zapisano pozycje wypożyczenia');
    if (saved) onSaved(saved);
  };

  const shownItems = visibleItems.slice(0, limit);

  return (
    <Sheet visible={visible} title="Pozycje wypożyczenia" width={760} onClose={onClose}
      subtitle={`${rental.number} · ${rentalDateTime(rental.starts_at)} – ${rentalDateTime(rental.ends_at)} · ${rentalPlain(rental.default_days)} dób`}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void save()} label="Zapisz pozycje" disabled={blocking} saving={!!notice.busy} />}>
      <Segmented value={tab} onChange={setTab}
        options={[{ id: 'catalog', label: 'Katalog magazynu' }, { id: 'lines', label: `Wybrane (${lines.length})` }]} />
      {blocking ? (
        <Text style={ui.warning}>Wypożyczenie jest zarezerwowane — zmniejsz ilości brakującego sprzętu albo zmień termin, aby zapisać.</Text>
      ) : null}
      {tab === 'catalog' ? (
        <>
          {catalog ? (
            <Text style={ui.mutedXs}>
              Wolne sztuki dla czasu, w którym sprzęt jest poza magazynem: {rentalDateTime(catalog.window.starts_at)} – {rentalDateTime(catalog.window.ends_at)}
              {windowWider ? ' (z dostawą, odbiorem albo wcześniejszym wydaniem)' : ''}. Uwzględnia eventy i inne wypożyczenia.
            </Text>
          ) : null}
          <TextInput value={query} onChangeText={setQuery} placeholder="Szukaj sprzętu, dekoracji, zestawu, marki…" placeholderTextColor={colors.text.tertiary}
            style={kit.input} autoCorrect={false} clearButtonMode="while-editing" />
          <SelectField value={categoryId} onChange={setCategoryId} options={categoryOptions} placeholder="Wszystkie kategorie" />
          <View style={ui.wrap}>
            <Chip label="Ukryj zajęte" active={hideBusy} onPress={() => setHideBusy((value) => !value)} />
            <SmallButton icon="refresh-cw" label="Odśwież" onPress={() => void loadCatalog()} disabled={catalogLoading} />
            {catalogLoading ? <ActivityIndicator color={colors.primary.gold} /> : null}
          </View>
          {equipmentPieces > 0 ? (
            <Text style={ui.mutedXs}>Wybrano {equipmentLines.length} pozycji sprzętu ({equipmentPieces} szt.) — ceny, doby i rabaty w „Wybrane”.</Text>
          ) : null}
          {catalogError ? <Text style={ui.danger}>{catalogError}</Text> : null}
          {!catalog ? (
            catalogLoading ? <Text style={ui.muted}>Wczytywanie katalogu magazynu…</Text> : null
          ) : !visibleItems.length && !visibleKits.length ? (
            <Text style={ui.muted}>Brak sprzętu dla wybranych filtrów.</Text>
          ) : (
            <View>
              {visibleKits.length ? <Text style={catalogStyles.header}>Zestawy</Text> : null}
              {visibleKits.map((entry) => {
                const selected = lines.filter((line) => isNewKit(line, entry.id)).reduce((sum, line) => sum + rentalCount(line.quantity), 0);
                const free = rentalKitFree(entry, itemsById, demandOf(lines, (line) => isNewKit(line, entry.id)));
                return (
                  <View key={entry.id} style={[catalogStyles.row, entry.available === 0 && !selected && catalogStyles.dim]}>
                    <CatalogThumb url={entry.thumbnail_url} icon="layers" />
                    <View style={ui.flex}>
                      <Text style={ui.textSm} numberOfLines={2}>{entry.name}</Text>
                      <Text style={ui.mutedXs} numberOfLines={2}>{entry.components.map((part) => `${part.quantity}× ${part.name}`).join(', ')}</Text>
                      <Text style={entry.available > 0 ? ui.success : ui.warning}>{entry.available > 0 ? `Kompletów: ${entry.available}` : 'Zajęte w terminie'}</Text>
                    </View>
                    <QuantityStepper value={selected} canAdd={selected < free} label={entry.name} onChange={(next) => setKit(entry, next)} />
                  </View>
                );
              })}
              {shownItems.map(({ item, path }, index) => {
                const selected = lines.filter((line) => isDirect(line, item.id)).reduce((sum, line) => sum + rentalCount(line.quantity), 0);
                const directUse = lines.filter((line) => isDirect(line, item.id)).reduce((sum, line) => sum + Math.max(0, rentalCount(line.quantity) - line.settled), 0);
                const used = demand.get(item.id) || 0;
                const inKits = Math.max(0, used - directUse);
                const over = used - item.available;
                const detail = [[item.brand, item.model].filter(Boolean).join(' '), item.price != null ? `${rentalMoney(item.price)}/doba` : ''].filter(Boolean).join(' · ');
                return (
                  <View key={item.id}>
                    {index === 0 || shownItems[index - 1].path !== path ? <Text style={catalogStyles.header}>{path}</Text> : null}
                    <View style={[catalogStyles.row, item.available === 0 && !selected && catalogStyles.dim]}>
                      <CatalogThumb url={item.thumbnail_url} icon="package" />
                      <View style={ui.flex}>
                        <Text style={ui.textSm} numberOfLines={2}>{item.name}</Text>
                        {detail ? <Text style={ui.mutedXs} numberOfLines={1}>{detail}</Text> : null}
                        <Text style={item.available > 0 ? ui.success : ui.warning}>
                          {item.available > 0 ? `Dostępne ${item.available} z ${item.stock}` : `Zajęte w terminie (stan ${item.stock})`}
                        </Text>
                        {inKits > 0 ? <Text style={ui.mutedXs}>w zestawach: {inKits}</Text> : null}
                        {over > 0 ? <Text style={ui.warning}>Brakuje {over}</Text> : null}
                      </View>
                      <QuantityStepper value={selected} canAdd={rentalCatalogFree(item, demand) > 0} label={item.name} onChange={(next) => setEquipment(item, next)} />
                    </View>
                  </View>
                );
              })}
              {visibleItems.length > shownItems.length ? (
                <SmallButton icon="chevron-down" label={`Pokaż więcej (${visibleItems.length - shownItems.length})`} onPress={() => setLimit((value) => value + CATALOG_PAGE)} />
              ) : null}
            </View>
          )}
        </>
      ) : (
        <>
          <View style={ui.wrap}>
            <SmallButton icon="package" label="Dodaj z katalogu" onPress={() => setTab('catalog')} />
            <SmallButton icon="tool" label="Dodaj usługę" onPress={addService} />
            {checking ? <ActivityIndicator color={colors.primary.gold} /> : null}
          </View>
          {!lines.length ? <Text style={ui.muted}>Brak pozycji — wybierz sprzęt z katalogu magazynu albo dodaj usługę.</Text> : null}
          {lines.map((line) => {
            const state = line.equipment_id ? availability[line.equipment_id] : undefined;
            return (
              <View key={line.key} style={ui.well}>
                <View style={ui.between}>
                  <View style={ui.flex}>
                    {line.kind === 'service' ? (
                      <TextInput value={line.name} onChangeText={(name) => update(line.key, { name })} placeholder="Nazwa usługi (np. transport)"
                        placeholderTextColor={colors.text.tertiary} style={kit.input} />
                    ) : <Text style={ui.text}>{line.name}</Text>}
                    {line.kit_name ? <Text style={ui.mutedXs}>{line.equipment_id ? `Z zestawu: ${line.kit_name}` : 'Zestaw zostanie rozpisany na składniki po zapisie'}</Text> : null}
                    {line.issued > 0 ? <Text style={ui.warning}>Wydano {line.issued}</Text> : null}
                    {state ? (state.shortage > 0 ? (
                      <>
                        <Text style={ui.warning}>Brakuje {state.shortage} (dostępne {state.available} z {state.stock})</Text>
                        {state.conflicts.map((conflict) => <Text key={`${conflict.type}-${conflict.id}`} style={ui.mutedXs}>{rentalConflictText(conflict, ' – do zwrotu')}</Text>)}
                      </>
                    ) : <Text style={ui.success}>Dostępne {state.available} z {state.stock}</Text>) : null}
                  </View>
                  <TouchableOpacity onPress={() => setLines((current) => current.filter((row) => row.key !== line.key))} disabled={line.issued > 0}
                    style={[kit.iconButton, line.issued > 0 && kit.disabled]} accessibilityLabel={line.issued > 0 ? 'Pozycja została wydana' : 'Usuń pozycję'}>
                    <Feather name="trash-2" size={18} color={colors.status.error} />
                  </TouchableOpacity>
                </View>
                <View style={ui.row}>
                  <View style={ui.flex}><Label>Ilość</Label><TextInput value={line.quantity} onChangeText={(quantity) => update(line.key, { quantity })} keyboardType="number-pad" style={kit.input} /></View>
                  <View style={ui.flex}><Label>Cena netto</Label><TextInput value={line.unit_price} onChangeText={(unit_price) => update(line.key, { unit_price })} keyboardType="decimal-pad" style={kit.input} /></View>
                </View>
                <Segmented value={line.price_mode} options={[{ id: 'per_day', label: 'za dobę' }, { id: 'flat', label: 'za całość' }]}
                  onChange={(price_mode) => update(line.key, { price_mode })} />
                <View style={ui.row}>
                  {line.price_mode === 'per_day' ? (
                    <View style={ui.flex}><Label>Doby</Label><TextInput value={line.days} onChangeText={(days) => update(line.key, { days })} placeholder={rentalPlain(rental.default_days)}
                      placeholderTextColor={colors.text.tertiary} keyboardType="decimal-pad" style={kit.input} /></View>
                  ) : null}
                  <View style={ui.flex}><Label>Rabat %</Label><TextInput value={line.discount} onChangeText={(value) => update(line.key, { discount: value })} keyboardType="decimal-pad" style={kit.input} /></View>
                  {line.kind === 'equipment' ? (
                    <View style={ui.flex}><Label>Wart. odtw.</Label><TextInput value={line.replacement} onChangeText={(replacement) => update(line.key, { replacement })} placeholder="z katalogu"
                      placeholderTextColor={colors.text.tertiary} keyboardType="decimal-pad" style={kit.input} /></View>
                  ) : null}
                </View>
                <TextInput value={line.note} onChangeText={(note) => update(line.key, { note })} placeholder="Uwagi do pozycji" placeholderTextColor={colors.text.tertiary} style={kit.input} />
                <Text style={[ui.money, { alignSelf: 'flex-end' }]}>{rentalMoney(netOf(line))} netto</Text>
              </View>
            );
          })}
        </>
      )}
      <Text style={ui.muted}>Razem netto (przed rabatem na całość): {rentalMoney(total)}</Text>
    </Sheet>
  );
}

const catalogStyles = StyleSheet.create({
  header: {
    marginTop: spacing.sm, paddingVertical: spacing.xs, color: colors.primary.gold, fontSize: typography.fontSizes.xs, textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default,
  },
  dim: { opacity: 0.6 },
  thumb: { width: 40, height: 40, borderRadius: borderRadius.md },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.secondary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepButton: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border.default,
  },
  stepInput: {
    width: 44, height: 32, paddingVertical: 0, textAlign: 'center', borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: colors.border.default, color: colors.text.primary, fontSize: typography.fontSizes.sm,
  },
});

// MARK: Protokół wydania / odbioru

type ProtocolRow = { id: string; name: string; unit: string; max: number; qty: string; damaged: string; missing: string; note: string; photos: string[] };

export function RentalProtocolSheet({ visible, issue, rental, notice, onClose, onSaved }: {
  visible: boolean; issue: boolean; rental: RentalDetail; notice: Notice; onClose: () => void; onSaved: (protocolId: string) => void;
}) {
  const [rows, setRows] = useState<ProtocolRow[]>([]);
  const [person, setPerson] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    setPerson(rental.recipient_name || '');
    setNote('');
    setRows(rental.items.filter((item) => item.kind === 'equipment').flatMap((item) => {
      const max = issue ? item.quantity - item.issued_qty : rentalOutQty(item);
      return max > 0 ? [{ id: item.id, name: item.name, unit: item.unit, max, qty: String(max), damaged: '0', missing: '0', note: '', photos: [] }] : [];
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, issue, rental.id]);

  const update = (id: string, patch: Partial<ProtocolRow>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addPhotos = (row: ProtocolRow) => {
    const remaining = 10 - row.photos.length;
    if (remaining <= 0) { notice.notify('Najwyżej 10 zdjęć na pozycję.', true); return; }
    chooseRentalSource('Zdjęcie do protokołu', (source) => {
      void (async () => {
        let assets: RentalAsset[];
        try {
          assets = await pickRentalAssets(source, remaining);
        } catch (cause) {
          notice.notify(cause instanceof Error ? cause.message : 'Nie udało się wybrać zdjęcia.', true);
          return;
        }
        if (!assets.length) return;
        const paths = await notice.run('Przesyłanie zdjęć…', async () => {
          const uploaded: string[] = [];
          for (const asset of assets) uploaded.push(await uploadRentalProtocolAsset(rental.id, asset));
          return uploaded;
        });
        if (paths?.length) setRows((current) => current.map((item) => (item.id === row.id ? { ...item, photos: [...item.photos, ...paths].slice(0, 10) } : item)));
      })();
    });
  };

  const save = async () => {
    if (person.trim().length < 2) { notice.notify(issue ? 'Podaj, kto odbiera sprzęt.' : 'Podaj, kto zwraca sprzęt.', true); return; }
    const problems = rows.flatMap((row) => {
      const qty = rentalCount(row.qty);
      const damaged = issue ? 0 : rentalCount(row.damaged);
      const missing = issue ? 0 : rentalCount(row.missing);
      const list: string[] = [];
      if (qty + damaged + missing > row.max) list.push(`„${row.name}”: najwyżej ${row.max} ${row.unit}`);
      if (issue && qty > 0 && qty < row.max && row.note.trim().length < 3) list.push(`„${row.name}”: opisz brak przy wydaniu`);
      if (!issue && damaged + missing > 0 && row.note.trim().length < 3) list.push(`„${row.name}”: opisz uszkodzenia lub brak`);
      return list;
    });
    if (problems.length) { notice.notify(problems.join('; '), true); return; }
    const protocolId = await notice.run('Zapisywanie protokołu…', () => (issue
      ? issueRental(supabase, rental.id, rows.filter((row) => rentalCount(row.qty) > 0)
        .map((row) => ({ item_id: row.id, qty: rentalCount(row.qty), note: trimmed(row.note), photos: row.photos })), person.trim(), trimmed(note))
      : returnRental(supabase, rental.id, rows
        .filter((row) => rentalCount(row.qty) + rentalCount(row.damaged) + rentalCount(row.missing) > 0)
        .map((row) => ({
          item_id: row.id, ok: rentalCount(row.qty), damaged: rentalCount(row.damaged), missing: rentalCount(row.missing), note: trimmed(row.note), photos: row.photos,
        })), person.trim(), trimmed(note))), issue ? 'Zapisano protokół wydania' : 'Zapisano protokół odbioru');
    if (protocolId) onSaved(protocolId);
  };

  return (
    <Sheet visible={visible} title={issue ? 'Protokół wydania' : 'Protokół odbioru'} width={720} onClose={onClose}
      subtitle={`${rental.number} · ${rental.client_name}${issue ? '' : ' · co wróciło sprawne, uszkodzone i czego brakuje'}`}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void save()} label={issue ? 'Zapisz wydanie' : 'Zapisz odbiór'} disabled={!rows.length} saving={!!notice.busy} />}>
      {!rows.length ? <Text style={ui.muted}>{issue ? 'Cały sprzęt został już wydany.' : 'U klienta nie ma już sprzętu z tego wypożyczenia.'}</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={ui.well}>
          <Text style={ui.text}>{row.name}</Text>
          <Text style={ui.mutedXs}>{issue ? 'Do wydania' : 'U klienta'}: {row.max} {row.unit}</Text>
          <View style={ui.row}>
            <View style={ui.flex}><Label>{issue ? 'Wydaję' : 'Sprawne'}</Label><TextInput value={row.qty} onChangeText={(qty) => update(row.id, { qty })} keyboardType="number-pad" style={kit.input} /></View>
            {!issue ? (
              <>
                <View style={ui.flex}><Label>Uszkodzone</Label><TextInput value={row.damaged} onChangeText={(damaged) => update(row.id, { damaged })} keyboardType="number-pad" style={kit.input} /></View>
                <View style={ui.flex}><Label>Brak</Label><TextInput value={row.missing} onChangeText={(missing) => update(row.id, { missing })} keyboardType="number-pad" style={kit.input} /></View>
              </>
            ) : null}
          </View>
          <TextInput value={row.note} onChangeText={(value) => update(row.id, { note: value })} placeholderTextColor={colors.text.tertiary} style={kit.input}
            placeholder={issue ? 'Uwagi (wymagane przy wydaniu mniejszej ilości)' : 'Opis uszkodzeń lub braku'} />
          <View style={ui.wrap}>
            <SmallButton icon="camera" label={`Zdjęcia (${row.photos.length})`} onPress={() => addPhotos(row)} />
            {row.photos.length ? <SmallButton danger icon="x" label="Usuń zdjęcia" onPress={() => update(row.id, { photos: [] })} /> : null}
          </View>
        </View>
      ))}
      <Label>{issue ? 'Odbiera' : 'Zwraca'}</Label>
      <TextInput value={person} onChangeText={setPerson} placeholder="Imię i nazwisko" placeholderTextColor={colors.text.tertiary} style={kit.input} />
      <Label>Uwagi do protokołu</Label>
      <TextInput value={note} onChangeText={setNote} multiline style={[kit.input, kit.multiline]} />
      <Text style={ui.mutedXs}>Po zapisie otworzysz PDF do podpisu; zdjęcie podpisanego protokołu dodasz jako skan na karcie.</Text>
    </Sheet>
  );
}

// MARK: Rozbieżność po zwrocie

const UNIT_STATUS: Record<string, string> = {
  available: 'Dostępny', reserved: 'Zarezerwowany', in_use: 'W użyciu', damaged: 'Uszkodzony', in_service: 'W serwisie', retired: 'Wycofany',
};
const RESOLVE_OPTIONS: Record<RentalResolveAction, string> = {
  damaged_back: 'Uszkodzone: sprawne — wraca na stan',
  damaged_service: 'Uszkodzone: do serwisu',
  damaged_write_off: 'Uszkodzone: spisz ze stanu',
  missing_back: 'Brak: oddane później',
  missing_write_off: 'Brak: spisz ze stanu',
};

export function RentalResolveSheet({ item, rental, notice, onClose, onSaved }: {
  item: RentalItem | null; rental: RentalDetail; notice: Notice; onClose: () => void; onSaved: (rental: RentalDetail) => void;
}) {
  const actions = useMemo(() => {
    if (!item) return [] as RentalResolveAction[];
    const list: RentalResolveAction[] = [];
    if (item.open_damaged > 0) list.push('damaged_back', ...(item.has_units ? ['damaged_service' as const] : []), 'damaged_write_off');
    if (item.open_missing > 0) list.push('missing_back', 'missing_write_off');
    return list;
  }, [item]);
  const [action, setAction] = useState<RentalResolveAction>('damaged_back');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [units, setUnits] = useState<RentalUnit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const pending = item ? (action.startsWith('damaged') ? item.open_damaged : item.open_missing) : 0;
  const needsUnits = Boolean(item?.has_units) && (action === 'damaged_service' || action.endsWith('write_off'));
  const needsNote = action === 'damaged_service' || action.endsWith('write_off');

  useEffect(() => {
    if (!item) return;
    const first = actions[0] || 'damaged_back';
    setAction(first);
    setQty(String(first.startsWith('damaged') ? item.open_damaged : item.open_missing));
    setNote('');
    setSelected([]);
    setUnits([]);
    if (!item.has_units) return;
    let alive = true;
    rentalItemUnits(supabase, item.id)
      .then((rows) => { if (alive) setUnits(rows.filter((unit) => ['available', 'reserved', 'in_use'].includes(unit.status))); })
      .catch((cause) => { if (alive) notice.notify(cause instanceof Error ? cause.message : 'Nie udało się pobrać egzemplarzy.', true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const pick = (next: RentalResolveAction) => {
    setAction(next);
    setSelected([]);
    if (item) setQty(String(next.startsWith('damaged') ? item.open_damaged : item.open_missing));
  };

  const save = async () => {
    if (!item) return;
    const amount = rentalCount(qty);
    if (amount < 1 || amount > pending) { notice.notify(`Podaj ilość od 1 do ${pending}.`, true); return; }
    if (needsUnits && selected.length !== amount) { notice.notify(`Zaznacz ${amount} egzemplarz(e/y).`, true); return; }
    if (needsNote && note.trim().length < 3) { notice.notify('Opisz decyzję (stan, przyczyna).', true); return; }
    const saved = await notice.run('Zapisywanie…', () => resolveRentalItem(supabase, item.id, action, amount, needsUnits ? selected : null, trimmed(note)),
      'Zapisano rozstrzygnięcie');
    if (saved) onSaved(saved);
  };

  return (
    <Sheet visible={!!item} title="Rozbieżność po zwrocie" onClose={onClose}
      subtitle={item ? `${rental.number} · ${item.name} · uszkodzone: ${item.open_damaged}, brak: ${item.open_missing}` : undefined}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void save()} label="Zapisz" saving={!!notice.busy} />}>
      <Label>Decyzja</Label>
      <SelectList options={actions.map((value) => ({ id: value, label: RESOLVE_OPTIONS[value] }))} selected={[action]} searchable={false}
        onToggle={(id) => pick(id as RentalResolveAction)} />
      <Label>Ilość (do rozstrzygnięcia: {pending} {item?.unit || ''})</Label>
      <TextInput value={qty} onChangeText={setQty} keyboardType="number-pad" style={kit.input} />
      {needsUnits ? (
        <>
          <Label>Egzemplarze ({selected.length} z {rentalCount(qty)})</Label>
          <Text style={ui.mutedXs}>
            {action === 'damaged_service' ? 'Dostaną status „Uszkodzony”, wrócą na stan po naprawie w Magazynie.' : 'Dostaną status „Wycofany”.'}
          </Text>
          <SelectList multiple emptyText="Brak egzemplarzy na stanie." selected={selected}
            options={units.map((unit) => ({ id: unit.id, label: unit.serial || 'Bez numeru', detail: [UNIT_STATUS[unit.status] || unit.status, unit.location].filter(Boolean).join(' · ') }))}
            onToggle={(id) => setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))} />
        </>
      ) : null}
      <Label>{needsNote ? 'Opis (wymagany)' : 'Opis'}</Label>
      <TextInput value={note} onChangeText={setNote} multiline style={[kit.input, kit.multiline]} />
    </Sheet>
  );
}

// MARK: Dostawa i odbiór

type TripState = { enabled: boolean; vehicle: string; driver: string; start: Date; end: Date; note: string; conflicts: RentalVehicleConflict[] };
const TRIP_KINDS: RentalTripKind[] = ['delivery', 'collection'];
const TRIP_LABELS: Record<RentalTripKind, string> = { delivery: 'Dostawa do klienta', collection: 'Odbiór od klienta' };

function initialTrip(rental: RentalDetail, kind: RentalTripKind): TripState {
  const trip = rental.trips.find((item) => item.kind === kind);
  const anchor = new Date(kind === 'delivery' ? rental.starts_at : rental.ends_at).getTime();
  const start = trip ? new Date(trip.starts_at) : new Date(anchor + (kind === 'delivery' ? -2 : 0) * 3_600_000);
  const end = trip ? new Date(trip.ends_at) : new Date(anchor + (kind === 'delivery' ? 0 : 2) * 3_600_000);
  return {
    enabled: Boolean(trip) || rental.handover === 'delivery', vehicle: trip?.vehicle_id || '', driver: trip?.driver_id || '', start, end,
    note: trip?.note || '', conflicts: [],
  };
}

export function RentalTripsSheet({ visible, rental, notice, onClose, onSaved }: {
  visible: boolean; rental: RentalDetail; notice: Notice; onClose: () => void; onSaved: (rental: RentalDetail) => void;
}) {
  const [trips, setTrips] = useState<Record<RentalTripKind, TripState>>(() => ({ delivery: initialTrip(rental, 'delivery'), collection: initialTrip(rental, 'collection') }));
  const [options, setOptions] = useState<RentalOptions | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTrips({ delivery: initialTrip(rental, 'delivery'), collection: initialTrip(rental, 'collection') });
    if (!options) loadRentalOptions().then(setOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rental.id]);

  const key = (trip: TripState) => `${trip.enabled}|${trip.vehicle}|${trip.start.getTime()}|${trip.end.getTime()}`;
  const deliveryKey = key(trips.delivery);
  const collectionKey = key(trips.collection);

  // Zajętość pojazdu w godzinach przejazdu (eventy i inne wypożyczenia; to wypożyczenie pomijane).
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const timer = setTimeout(() => {
      for (const kind of TRIP_KINDS) {
        const trip = trips[kind];
        if (!trip.enabled || !trip.vehicle || trip.end <= trip.start) {
          setTrips((current) => (current[kind].conflicts.length ? { ...current, [kind]: { ...current[kind], conflicts: [] } } : current));
          continue;
        }
        rentalVehicleConflicts(supabase, trip.vehicle, trip.start.toISOString(), trip.end.toISOString(), rental.id)
          .then((conflicts) => { if (alive) setTrips((current) => ({ ...current, [kind]: { ...current[kind], conflicts } })); })
          .catch(() => undefined);
      }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, deliveryKey, collectionKey, rental.id]);

  const update = (kind: RentalTripKind, patch: Partial<TripState>) => setTrips((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));

  const save = async () => {
    const list: RentalTripInput[] = [];
    for (const kind of TRIP_KINDS) {
      const trip = trips[kind];
      if (!trip.enabled) continue;
      if (trip.end <= trip.start) { notice.notify(`${TRIP_LABELS[kind]}: podaj godziny (koniec po początku).`, true); return; }
      list.push({
        kind, vehicle_id: trip.vehicle || null, driver_id: trip.driver || null, starts_at: trip.start.toISOString(), ends_at: trip.end.toISOString(), note: trimmed(trip.note),
      });
    }
    const saved = await notice.run('Zapisywanie…', () => setRentalTrips(supabase, rental.id, list), 'Zapisano dostawę i odbiór');
    if (saved) onSaved(saved);
  };

  const vehicles = [{ id: '', label: 'Bez pojazdu z floty' }, ...(options?.vehicles || []).map((vehicle) => ({ id: vehicle.id, label: vehicle.name }))];
  const drivers = [{ id: '', label: 'Nie wybrano' }, ...(options?.employees || []).map((employee) => ({ id: employee.id, label: employee.name }))];

  return (
    <Sheet visible={visible} title="Dostawa i odbiór" onClose={onClose} subtitle={`${rental.number}${rental.delivery_address ? ` · ${rental.delivery_address}` : ''}`}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void save()} label="Zapisz" saving={!!notice.busy} />}>
      {TRIP_KINDS.map((kind) => {
        const trip = trips[kind];
        return (
          <View key={kind} style={ui.well}>
            <TouchableOpacity onPress={() => update(kind, { enabled: !trip.enabled })} style={ui.row} accessibilityRole="checkbox" accessibilityState={{ checked: trip.enabled }}>
              <Feather name={trip.enabled ? 'check-square' : 'square'} size={18} color={trip.enabled ? colors.primary.gold : colors.text.tertiary} />
              <Text style={ui.text}>{TRIP_LABELS[kind]}</Text>
            </TouchableOpacity>
            {trip.enabled ? (
              <>
                <Label>Pojazd</Label>
                <SelectField value={trip.vehicle} options={vehicles} onChange={(vehicle) => update(kind, { vehicle })} />
                {!options?.vehicles.length ? <Text style={ui.mutedXs}>Lista pojazdów wymaga dostępu do Floty.</Text> : null}
                <Label>Kierowca</Label>
                <SelectField value={trip.driver} options={drivers} onChange={(driver) => update(kind, { driver })} />
                <Label>Od</Label>
                <DateTimeField value={trip.start} onChange={(start) => update(kind, { start })} />
                <Label>Do</Label>
                <DateTimeField value={trip.end} onChange={(end) => update(kind, { end })} />
                <TextInput value={trip.note} onChangeText={(value) => update(kind, { note: value })} placeholder="Uwagi" placeholderTextColor={colors.text.tertiary} style={kit.input} />
                {trip.conflicts.length ? (
                  <View style={ui.warnWell}>
                    <Text style={ui.warning}>Pojazd jest zajęty w tym czasie</Text>
                    {trip.conflicts.map((conflict) => <Text key={`${conflict.type}-${conflict.id}`} style={ui.mutedXs}>{rentalConflictText(conflict, '')}</Text>)}
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        );
      })}
      <Text style={[ui.mutedXs, { marginTop: spacing.xs }]}>Pojazd zarezerwowanego lub wydanego wypożyczenia jest zajęty w tych godzinach — eventy go nie dostaną.</Text>
    </Sheet>
  );
}

// MARK: Anulowanie z rezerwacji (z powodem)

export function RentalCancelSheet({ visible, rental, notice, onClose, onSaved }: {
  visible: boolean; rental: RentalDetail; notice: Notice; onClose: () => void; onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (visible) setReason(''); }, [visible]);
  const save = async () => {
    if (reason.trim().length < 3) { notice.notify('Podaj powód (co najmniej 3 znaki).', true); return; }
    const done = await notice.run('Zapisywanie…', () => setRentalStatus(supabase, rental.id, 'cancelled', reason.trim()), 'Anulowano wypożyczenie');
    if (done) onSaved();
  };
  return (
    <Sheet visible={visible} title="Anuluj wypożyczenie" subtitle="Sprzęt wróci do dostępnych, a magazyn dostanie powiadomienie z powodem." onClose={onClose}
      footer={<SheetActions onCancel={onClose} cancelLabel="Wróć" onConfirm={() => void save()} label="Anuluj wypożyczenie" danger saving={!!notice.busy} />}>
      <Label>Powód anulowania</Label>
      <TextInput value={reason} onChangeText={setReason} multiline style={[kit.input, kit.multiline]} autoFocus />
    </Sheet>
  );
}
