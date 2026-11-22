import 'server-only';
import { randomUUID } from 'crypto';
import { can, type NativeContext } from './auth';
import { fail } from './offers';
import {
  calculateModular,
  componentQuantity,
  ledProcessorNotices,
  ledRootQuantity,
  ledSectionTotals,
  ledTreeSnapshot,
  modularScope,
  modularTitle,
  productConfigurationSnapshot,
  profileLabels,
  stageLinkGroups,
  stageLinksFor,
  stageRootQuantity,
  type EquipmentSnapshot,
  type LedSection,
  type ModularSnapshot,
  type ProductConfigurationSnapshot,
  type StageEquipment,
  type StageLink,
  type WarehouseStageSnapshot,
} from '@/lib/CRM/Offers/modularProduct';
import { isHeightChoice, selectStageHeight, stageHeightOptions } from '@/lib/CRM/Offers/stageHeightSelection';
import { loadConfigurationEquipment } from '@/lib/CRM/Offers/loadConfigurationEquipment';

/*
 * Konfigurator produktów modułowych na Macu (podest z magazynu, ekran LED z sekcjami, a w starszych ofertach podest ze
 * stawkami, LED z powierzchnią, nagłośnienie i mikrofony) — te same funkcje co `ModularProductConfigurator` w CRM
 * (`modularProduct.ts`, `stageHeightSelection.ts`, `loadConfigurationEquipment.ts`). Mac trzyma kopię konfiguracji
 * (snapshot) i wysyła zmiany jako operacje; serwer je stosuje, pobiera sprzęt z magazynu (ceny rentalne, zależności),
 * dobiera warianty do wysokości podestu i zwraca konfigurację z gotowym widokiem: drzewo wyboru, sekcje LED, stan modułów,
 * procesory, składniki, cenę i komunikaty. Zapis w ofercie robią operacje pozycji, kreatora i propozycji
 * (`createModularConfiguration` w `offerItems.ts`, `offerWizard.ts`, `offerRecommendations.ts`).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILES = ['warehouse_stage', 'stage', 'led', 'sound', 'microphones'];
const text = (value: unknown) => (value == null ? '' : String(value));
/** Liczba z pola: puste lub błędne — NaN (komunikat poda kalkulator, jak w CRM). */
const numberOf = (value: unknown) => (value === '' || value == null ? NaN : Number(value));
/** Liczba z konfiguracji (po JSON brak liczby to `null`). */
const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : NaN);
const orNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const plain = (value: number) => (Number.isFinite(value) ? value.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) : '—');
const money = (value: number) => value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Konfiguracja produktu w ofercie: jak tworzenie ofert (oferty, wydarzenia albo własne wydarzenia). */
const canConfigure = (ctx: NativeContext) =>
  ['offers_manage', 'events_manage', 'events_create'].some((scope) => can(ctx.employee, scope));

const isTree = (s: ProductConfigurationSnapshot): s is EquipmentSnapshot =>
  s.profile === 'led' && Boolean((s as EquipmentSnapshot).catalog?.led_tree);

/** Konfiguracja przysłana z Maca (kopia z pozycji, propozycji albo poprzedniej odpowiedzi). */
export function modularSnapshotOf(value: unknown): ProductConfigurationSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Nieprawidłowa konfiguracja produktu.');
  const snapshot = structuredClone(value) as Row;
  if (!PROFILES.includes(text(snapshot.profile)) || !snapshot.catalog || typeof snapshot.catalog !== 'object'
    || !snapshot.selection || typeof snapshot.selection !== 'object') {
    fail('Nieobsługiwany typ konfiguratora.');
  }
  return snapshot as ProductConfigurationSnapshot;
}

// MARK: Operacje z Maca (jak `onChange` kontrolek konfiguratora w CRM)

/** Sekcje LED (`LedSectionsConfigurator.commit`): przy poprawnym układzie powierzchnia i skrętki z sekcji. */
function commitSections(s: EquipmentSnapshot, next: LedSection[]) {
  try {
    const totals = ledSectionTotals(next);
    const cable = s.catalog.led_cable_component_id;
    s.selection = { ...s.selection, led_sections: next, area: totals.area, quantities: { ...s.selection.quantities, ...(cable ? { [cable]: totals.cables } : {}) } };
  } catch {
    s.selection = { ...s.selection, led_sections: next };
  }
}

function applySectionEdit(s: EquipmentSnapshot, op: string, edit: Row) {
  const sections = s.selection.led_sections;
  if (op === 'sectionsCreate' && !sections) {
    commitSections(s, [{ id: randomUUID(), name: 'Sekcja 1', columns: 2, rows: 2 }]);
    return;
  }
  if (!sections) return;
  if (op === 'sectionAdd' && sections.length < 30) {
    commitSections(s, [...sections, { id: randomUUID(), name: `Sekcja ${sections.length + 1}`, columns: 2, rows: 2 }]);
  } else if (op === 'sectionRemove' && sections.length > 1) {
    commitSections(s, sections.filter((section) => section.id !== text(edit.id)));
  } else if (op === 'sectionSet') {
    commitSections(s, sections.map((section) => {
      if (section.id !== text(edit.id)) return section;
      const next = { ...section };
      if (edit.name !== undefined) next.name = text(edit.name).slice(0, 100);
      if (edit.columns !== undefined) next.columns = numberOf(edit.columns);
      if (edit.rows !== undefined) next.rows = numberOf(edit.rows);
      return next;
    }));
  }
}

function applyEdit(snapshot: ProductConfigurationSnapshot, edit: Row): ProductConfigurationSnapshot {
  const op = text(edit.op);
  const key = text(edit.key).slice(0, 2000);
  const id = text(edit.id).slice(0, 200);
  if (snapshot.profile === 'warehouse_stage') {
    const s = snapshot as WarehouseStageSnapshot;
    const p = s.selection;
    if (op === 'size') { p.width = numberOf(edit.width); p.depth = numberOf(edit.depth); }
    else if (op === 'width') p.width = numberOf(edit.value);
    else if (op === 'depth') p.depth = numberOf(edit.value);
    else if (op === 'height') p.height = numberOf(edit.value);
    else if (op === 'skirt' && ['front_sides', 'all'].includes(edit.value)) p.skirt = edit.value;
    else if (op === 'rootEnabled') p.enabled = { ...p.enabled, ['root:' + id]: edit.enabled === true };
    else if (op === 'rootQuantity') p.quantities = { ...p.quantities, [id]: numberOf(edit.value) };
    else if (op === 'choice') p.choices = { ...p.choices, [key]: text(edit.linkId) };
    else if (op === 'enabled') p.enabled = { ...p.enabled, [key]: edit.enabled === true };
    else if (op === 'english' && s.equipment?.[id]) s.equipment[id] = { ...s.equipment[id], name_en: text(edit.value).slice(0, 300) };
    return s;
  }
  if (isTree(snapshot)) {
    const s = snapshot;
    const p = s.selection;
    if (op === 'rootEnabled') s.selection = { ...p, led_enabled: { ...(p.led_enabled || {}), ['root:' + id]: edit.enabled === true } };
    else if (op === 'rootQuantity') s.selection = { ...p, quantities: { ...p.quantities, [id]: numberOf(edit.value) } };
    else if (op === 'choice') s.selection = { ...p, led_choices: { ...(p.led_choices || {}), [key]: text(edit.linkId) } };
    else if (op === 'enabled') s.selection = { ...p, led_enabled: { ...(p.led_enabled || {}), [key]: edit.enabled === true } };
    else if (op === 'english' && p.led_equipment?.[id]) {
      s.selection = { ...p, led_equipment: { ...p.led_equipment, [id]: { ...p.led_equipment[id], name_en: text(edit.value).slice(0, 300) } } };
    } else applySectionEdit(s, op, edit);
    return s;
  }
  if (snapshot.profile === 'stage') {
    const s = snapshot as ModularSnapshot;
    const p = s.selection;
    if (op === 'size') { p.width = numberOf(edit.width); p.depth = numberOf(edit.depth); }
    else if (op === 'width') p.width = numberOf(edit.value);
    else if (op === 'depth') p.depth = numberOf(edit.value);
    else if (op === 'height') p.height = numberOf(edit.value);
    else if (op === 'skirt' && ['none', 'front_sides', 'all'].includes(edit.value)) p.skirt = edit.value;
    else if (op === 'carpet') p.carpet = edit.enabled === true;
    else if (op === 'stairs') p.stairs = numberOf(edit.value);
    else if (op === 'accessoryQuantity') p.accessories = p.accessories.map((item) => (item.id === id ? { ...item, quantity: numberOf(edit.value) } : item));
    return s;
  }
  // Zestawy ze składników (LED z powierzchnią lub sekcjami, nagłośnienie, mikrofony).
  const s = snapshot as EquipmentSnapshot;
  if (op === 'area') s.selection = { ...s.selection, area: numberOf(edit.value) };
  else if (op === 'componentQuantity') s.selection = { ...s.selection, quantities: { ...s.selection.quantities, [id]: numberOf(edit.value) } };
  else applySectionEdit(s, op, edit);
  return s;
}

// MARK: Sprzęt z magazynu (pobranie przy otwarciu i „Pobierz aktualny sprzęt i ceny rentalne”)

async function withEquipment(ctx: NativeContext, snapshot: ProductConfigurationSnapshot, refresh: boolean) {
  // Nazwy angielskie wpisane w tej ofercie zostają po ponownym pobraniu (jak `refresh` w CRM).
  const keepEnglish = (next: Record<string, StageEquipment>, before?: Record<string, StageEquipment> | null) => {
    for (const node of Object.values(next)) node.name_en = before?.[node.id]?.name_en || '';
    return next;
  };
  try {
    if (snapshot.profile === 'warehouse_stage') {
      const s = snapshot as WarehouseStageSnapshot;
      if (refresh || !s.equipment) {
        s.equipment = keepEnglish(await loadConfigurationEquipment(ctx.supabase, s.catalog), s.equipment);
        s.loaded_at = new Date().toISOString();
      }
    } else if (isTree(snapshot)) {
      const s = snapshot;
      if (refresh || !s.selection.led_equipment) {
        const equipment = keepEnglish(await loadConfigurationEquipment(ctx.supabase, s.catalog.led_tree!, 'led'), s.selection.led_equipment);
        s.selection = { ...s.selection, led_equipment: equipment, led_loaded_at: new Date().toISOString() };
      }
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Nie udało się pobrać sprzętu.';
  }
}

// MARK: Widok dla Maca

type NodeView = { id: string; path: string; name: string; detail: string; groups: GroupView[] };
type GroupView = {
  key: string;
  kind: 'automatic' | 'choice' | 'optional' | 'required';
  label: string;
  placeholder: string;
  options: { id: string; label: string }[];
  selected: string;
  enabled: boolean;
  children: NodeView[];
};

const modeText = (link: StageLink) =>
  link.mode === 'per_item' ? 'na sztukę' : link.mode === 'per_batch' ? `na każde ${link.per_quantity} szt.` : 'na cały zestaw';

/** Drzewo wyboru jak `SelectionTree` w CRM (warianty, dodatki opcjonalne, warianty dobrane do wysokości). */
function nodeView(s: WarehouseStageSnapshot, id: string, path: string, q: number, ancestors: string[], heightDriven: boolean): NodeView | null {
  const node = s.equipment?.[id];
  if (!node || ancestors.includes(id) || ancestors.length >= 8) return null;
  const p = s.selection;
  const name = (equipment: string) => s.equipment?.[equipment]?.name;
  const groups = stageLinkGroups(stageLinksFor(s, node)).map((group): GroupView => {
    const key = path + '/' + group.key;
    const automatic = heightDriven && isHeightChoice(group) && group.required;
    const selected = group.choice ? group.links.filter((link) => link.id === p.choices[key]) : group.required || p.enabled[key] ? group.links : [];
    const label = automatic
      ? `${group.label}: ${selected.length ? `${name(selected[0].equipment_id) || 'Wybrany komponent'} — dobrano do ${p.height} cm` : 'Brak pasującego wariantu. Wybierz dostępną wysokość powyżej.'}`
      : group.choice ? `${group.label} — ${group.required ? 'wybierz jeden wariant (wymagane)' : 'opcjonalnie'}`
        : !group.required ? `${name(group.links[0].equipment_id) || 'Dodatek'} — opcjonalnie` : 'Wymagana zależność';
    return {
      key,
      kind: automatic ? 'automatic' : group.choice ? 'choice' : !group.required ? 'optional' : 'required',
      label,
      placeholder: group.required ? 'Wybierz…' : 'Bez dodatku',
      options: group.choice && !automatic ? group.links.map((link) => ({
        id: link.id,
        label: `${name(link.equipment_id) || 'Niedostępny sprzęt'} · ${plain(link.quantity)} ${modeText(link)}${link.min_height != null || link.max_height != null ? ` · ${link.min_height ?? '—'}–${link.max_height ?? '—'} cm` : ''}`,
      })) : [],
      selected: text(p.choices[key]),
      enabled: Boolean(p.enabled[key]),
      children: selected.map((link) => nodeView(s, link.equipment_id, path + '/' + link.id, componentQuantity(link, q), [...ancestors, id], heightDriven))
        .filter((child): child is NodeView => Boolean(child)),
    };
  });
  return { id, path, name: node.name, detail: `${plain(q)} · ${node.rate == null ? 'Do wyceny' : `${money(node.rate)} zł netto`}`, groups };
}

/** Stan modułów LED w magazynie (`LedInventoryNotice`): bez odjęcia rezerwacji na termin, informacja wewnętrzna. */
async function ledInventory(ctx: NativeContext, equipmentId: string | undefined, modules: number) {
  if (!equipmentId) return { text: 'W karcie produktu wskaż moduł magazynowy, aby porównać zapotrzebowanie ze stanem własnego ekranu.', warning: true };
  const [item, units] = await Promise.all([
    ctx.supabase.from('equipment_items').select('total_quantity').eq('id', equipmentId).is('deleted_at', null).maybeSingle(),
    ctx.supabase.from('equipment_units').select('id,status').eq('equipment_id', equipmentId),
  ]);
  if (item.error || units.error) return { text: 'Nie udało się pobrać stanu modułów.', warning: true };
  const rows = (units.data || []) as Row[];
  const stock = rows.length
    ? rows.filter((unit) => ['available', 'reserved', 'in_use'].includes(unit.status)).length
    : Math.max(0, Number((item.data as Row | null)?.total_quantity || 0));
  const missing = Math.max(0, modules - stock);
  return {
    text: `Potrzeba ${modules} modułów · własny magazyn: ${stock}${missing ? ` · do uzupełnienia rentalem: ${missing} szt.` : ' · wystarczająca liczba własnych modułów.'}`,
    warning: missing > 0,
  };
}

type Totals = ReturnType<typeof ledSectionTotals>;
const totalsOf = (sections: LedSection[] | undefined): Totals | null => {
  if (!sections) return null;
  try { return ledSectionTotals(sections); } catch { return null; }
};

async function ledView(ctx: NativeContext, s: EquipmentSnapshot, totals: Totals | null, quantity: number) {
  const sections = s.selection.led_sections;
  const equipmentId = s.catalog.led_tree?.roots.find((root) => root.basis === 'decks')?.equipment_id || s.catalog.led_equipment_id;
  return {
    hasSections: Boolean(sections),
    canAdd: Boolean(sections && sections.length < 30),
    sections: (sections || []).map((section) => {
      const columns = finite(section.columns);
      const rows = finite(section.rows);
      return {
        id: section.id,
        name: text(section.name),
        columns: orNull(columns),
        rows: orNull(rows),
        summary: `${plain(columns / 2)} × ${plain(rows / 2)} m · ${plain(columns * rows)} kafelków · ${plain(columns * rows / 4)} m²`,
      };
    }),
    totals: totals ? `Razem: ${totals.modules} modułów · ${plain(totals.area)} m². Skrętki: ${totals.signalCables} + 1 zapasowa = ${totals.cables} szt. / zestaw.` : null,
    inventory: totals ? await ledInventory(ctx, equipmentId, totals.modules * Math.max(1, Number.isFinite(quantity) ? quantity : 1)) : null,
    notices: [] as Row[],
  };
}

async function viewOf(ctx: NativeContext, s: ProductConfigurationSnapshot, quantity: number, loadError: string | null) {
  const result = calculateModular(s);
  const view: Row = {
    profile: s.profile,
    heading: s.profile === 'warehouse_stage' ? modularTitle(s) : s.profile === 'stage' ? 'Konfiguracja podestu' : `${profileLabels[s.profile]} — konfiguracja`,
    title: modularTitle(s),
    scope: modularScope(s),
    error: loadError || result.error,
    loadError,
    lines: result.lines.map((line) => ({
      key: line.key,
      name: line.name,
      quantity: `${plain(line.quantity)} ${line.unit}`,
      rate: line.rate == null ? 'Do wyceny' : money(line.rate),
      total: line.rate == null ? '—' : `${money(line.total)} zł`,
    })),
    calculatorTotal: result.error ? null : result.total,
    totalText: '',
    note: null,
    roots: [],
    english: [],
    loadedAt: null,
    stage: null,
    led: null,
    legacyStage: null,
    components: null,
    area: null,
    areaEditable: false,
  };

  if (s.profile === 'warehouse_stage') {
    const w = s as WarehouseStageSnapshot;
    const p = w.selection;
    const height = finite(p.height);
    const width = finite(p.width);
    const depth = finite(p.depth);
    const options = stageHeightOptions(w);
    view.totalText = result.error ? 'Uzupełnij konfigurację' : `${money(result.total)} zł netto / podest / dzień`;
    view.note = 'Ilość podestów i dni w ofercie mnoży cenę całego zestawu. PDF pokazuje rozmiar, wyposażenie i cenę podestu; stawki części pozostają wewnętrzne.';
    view.stage = {
      width: orNull(width),
      depth: orNull(depth),
      height: orNull(height),
      skirt: p.skirt,
      showSkirt: w.catalog.roots.some((root) => root.basis === 'edge' || root.basis === 'sides'),
      presets: [[2, 1], [4, 2], [6, 3], [8, 4]].map(([presetWidth, presetDepth]) => ({ width: presetWidth, depth: presetDepth, label: `${presetWidth} × ${presetDepth} m` })),
      heightOptions: options.map((range) => ({
        height: Number.isFinite(height) ? Math.min(range.max, Math.max(range.min, Math.round(height))) : range.min,
        label: range.min === range.max ? `${range.min} cm` : `${range.min}–${range.max} cm`,
      })),
      heightMessage: !w.equipment ? null : options.length
        ? (options.some((range) => height >= range.min && height <= range.max) ? 'Dostępne wysokości dla tego wyposażenia:' : 'Ta wysokość nie pasuje do wyposażenia. Wybierz jedną z dostępnych:')
        : 'Brak pełnych danych do automatycznego doboru. Opiekun musi sprawdzić zakresy wysokości komponentów.',
      summary: Number.isInteger(width) && Number.isInteger(depth) && width >= 1 && depth >= 1 && (width % 2 === 0 || depth % 2 === 0)
        ? `${width} × ${depth} m · ${width * depth} m² · ${width * depth / 2} blatów 1 × 2 m`
        : 'Wpisz pełne metry; jeden bok musi być parzysty, aby ułożyć blaty 1 × 2 m.',
    };
    view.roots = w.catalog.roots.map((root) => {
      const name = w.equipment?.[root.equipment_id]?.name;
      const active = root.required || Boolean(p.enabled['root:' + root.id]);
      const manual = active && root.basis === 'manual';
      return {
        id: root.id,
        title: root.basis === 'decks' ? 'Blaty i dobrane wyposażenie' : name || 'Pobieranie wybranego sprzętu…',
        optional: !root.required,
        optionalLabel: `${name || 'Dodatek'} — opcjonalnie`,
        enabled: active,
        quantityEditable: manual,
        quantity: manual ? orNull(p.quantities[root.id]) : null,
        tree: active ? nodeView(w, root.equipment_id, root.id, stageRootQuantity(w, root), [], true) : null,
      };
    });
    view.english = Object.values(w.equipment || {}).map((node) => ({ id: node.id, name: node.name, nameEn: node.name_en }));
    view.loadedAt = w.loaded_at;
  } else if (isTree(s)) {
    const graph = ledTreeSnapshot(s);
    const p = s.selection;
    const totals = totalsOf(p.led_sections || []);
    view.totalText = result.error ? 'Uzupełnij konfigurację' : `${money(result.total)} zł netto / zestaw / dzień`;
    view.led = await ledView(ctx, s, totals, quantity);
    view.led.notices = totals ? ledProcessorNotices(graph, totals.signalCables) : [];
    view.roots = graph.catalog.roots.map((root) => {
      const name = graph.equipment?.[root.equipment_id]?.name;
      const active = root.required || Boolean(graph.selection.enabled['root:' + root.id]);
      const manual = active && root.basis === 'manual' && root.id !== s.catalog.led_cable_root_id;
      return {
        id: root.id,
        title: name || 'Komponent',
        optional: !root.required,
        optionalLabel: `${name || 'Dodatek'} — opcjonalnie`,
        enabled: active,
        quantityEditable: manual,
        quantity: manual ? orNull(p.quantities[root.id]) : null,
        tree: active && totals ? nodeView(graph, root.equipment_id, root.id, ledRootQuantity(graph, root, totals, s.catalog.led_cable_root_id), [], false) : null,
      };
    });
    view.english = Object.values(graph.equipment || {}).map((node) => ({ id: node.id, name: node.name, nameEn: node.name_en }));
    view.loadedAt = p.led_loaded_at || null;
  } else if (s.profile === 'stage') {
    const m = s as ModularSnapshot;
    const p = m.selection;
    view.totalText = result.error ? 'Uzupełnij konfigurację, aby ustalić cenę' : `${money(result.total)} zł netto / zestaw / dzień · mnożnik ${plain(m.catalog.multiplier)}`;
    view.note = 'W PDF klient zobaczy zakres i cenę zestawu. Stawki części oraz mnożnik pozostają w kalkulacji. Montaż i transport dodaj oddzielnie, jeśli nie są objęte inną pozycją.';
    view.legacyStage = {
      width: orNull(p.width), depth: orNull(p.depth), height: orNull(p.height), skirt: p.skirt, carpet: p.carpet === true, stairs: orNull(p.stairs),
      presets: [[4, 2], [6, 3], [8, 4]].map(([presetWidth, presetDepth]) => ({ width: presetWidth, depth: presetDepth, label: `${presetWidth} × ${presetDepth} m` })),
      heights: m.catalog.heights.map((row) => row.cm),
      heightMissing: !m.catalog.heights.some((row) => row.cm === p.height),
      accessories: p.accessories.map((item) => ({ id: item.id, name: item.name, quantity: orNull(item.quantity) })),
    };
  } else {
    const e = s as EquipmentSnapshot;
    const p = e.selection;
    view.totalText = result.error ? 'Uzupełnij konfigurację' : `${money(result.total)} zł netto / zestaw / dzień · mnożnik ${plain(e.catalog.multiplier)}`;
    view.note = 'Sprzedawca dobiera modele, ilości i konstrukcję do wymagań realizacji. Klient zobaczy zakres i cenę zestawu. Montaż, obsługę oraz transport uwzględnij jako składniki lub osobne pozycje oferty.';
    if (e.profile === 'led') {
      view.led = await ledView(ctx, e, totalsOf(p.led_sections), quantity);
      view.area = p.led_sections ? null : orNull(p.area);
      view.areaEditable = !p.led_sections;
    }
    view.components = e.catalog.components.map((row) => {
      const editable = row.basis === 'manual' && !(e.profile === 'led' && p.led_sections && row.id === e.catalog.led_cable_component_id);
      const amount = row.basis === 'area' ? finite(p.area) * row.quantity
        : row.basis === 'parent' ? (finite(p.quantities[row.parent_id!]) || 0) * row.quantity
          : row.basis === 'manual' ? finite(p.quantities[row.id]) : row.quantity;
      return {
        id: row.id,
        name: `${row.name}${row.required ? ' · wymagany' : ''}`,
        editable,
        quantity: editable ? orNull(p.quantities[row.id] ?? row.quantity) : null,
        text: `${plain(amount)} ${row.basis === 'area' ? 'm²' : 'szt.'}`,
      };
    });
  }
  return view;
}

// MARK: Operacja `modular`

/**
 * POST op=modular: `productId` (nowa konfiguracja z karty produktu) albo `snapshot` (zapisana lub bieżąca konfiguracja),
 * `edits` — zmiany w kolejności wprowadzenia, `refresh` — ponowne pobranie sprzętu i cen rentalnych, `quantity` — liczba
 * zestawów w ofercie (do porównania modułów LED ze stanem magazynu), `view: false` — bez widoku. Zwraca konfigurację po
 * zmianach i widok.
 */
export async function configureModular(ctx: NativeContext, body: Row) {
  if (!canConfigure(ctx)) fail('Nie masz uprawnień do konfiguracji ofert.');
  return configureModularView(ctx, body);
}

/**
 * To samo co `configureModular`, bez sprawdzania uprawnień do ofert — dla „Oferty ze spotkania” w Prezentacjach
 * (`showcaseOffer.server.ts`), gdzie dostęp sprawdza `sales_showcase_offer_can`, a widok bez stawek części przygotowuje pokaz.
 */
export async function configureModularView(ctx: NativeContext, body: Row) {
  let snapshot: ProductConfigurationSnapshot;
  if (body.snapshot) {
    snapshot = modularSnapshotOf(body.snapshot);
  } else {
    const productId = text(body.productId);
    if (!UUID.test(productId)) fail('Wybierz produkt.');
    const { data, error } = await ctx.supabase.from('offer_products').select('configuration_schema').eq('id', productId).maybeSingle();
    if (error || !data) fail('Nie znaleziono produktu.');
    if (!(data as Row).configuration_schema) fail('Ten produkt nie ma konfiguratora.');
    snapshot = productConfigurationSnapshot((data as Row).configuration_schema);
  }
  const edits = (Array.isArray(body.edits) ? body.edits : []).slice(0, 100) as Row[];
  for (const edit of edits) if (edit && typeof edit === 'object') snapshot = applyEdit(snapshot, edit);
  const loadError = await withEquipment(ctx, snapshot, body.refresh === true);
  // Warianty zależne od wysokości (np. nogi) dobierane automatycznie po każdej zmianie (`selectStageHeight`, jak w CRM).
  if (snapshot.profile === 'warehouse_stage') snapshot = selectStageHeight(snapshot as WarehouseStageSnapshot);
  // `view: false` — sama konfiguracja ze świeżym sprzętem (wycena oferty ze spotkania), bez budowania widoku.
  if (body.view === false) {
    if (loadError) fail(loadError);
    return { snapshot, view: null };
  }
  return { snapshot, view: await viewOf(ctx, snapshot, numberOf(body.quantity), loadError) };
}
