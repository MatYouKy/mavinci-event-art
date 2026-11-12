/*
 * Checklista sprzętu wydarzenia w trzech etapach — wspólna kopia CRM ↔ aplikacja mobilna
 * (src/lib/events/equipment/equipmentChecklist.ts ↔ mobile/src/lib/equipmentChecklist.ts; zgodność sprawdza
 * scripts/ci/check-shared-copies.mjs). Etapy, uprawnienia (`can`), blokady i powiadomienia liczy baza
 * (migracja 20261105170000_event_equipment_checklist.sql, docs/equipment-checklist.md) — tu są tylko typy,
 * odczyt wyniku RPC, etykiety i walidacja formularzy zgodna z bazą.
 */

export type EquipmentChecklistStage = 'empty' | 'dispatch' | 'loadback' | 'return' | 'issues' | 'done';
export type EquipmentStageKey = 'dispatch' | 'loadback' | 'return';
export type EquipmentShortageStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type EquipmentLineKind = 'equipment' | 'kit' | 'cable';

export type EquipmentChecklistLine = {
  id: string;
  name: string;
  kind: EquipmentLineKind;
  category: string | null;
  thumbnail_url: string | null;
  notes: string | null;
  quantity: number;
  /** Wymagana przy wydaniu (nie opcjonalna, nie wynajem zewnętrzny, nie usunięta z oferty). */
  required: boolean;
  optional: boolean;
  external_rental: boolean;
  removed: boolean;
  packed_qty: number | null;
  packed_at: string | null;
  packed_by: string | null;
  packed_by_name: string | null;
  shortage_qty: number;
  shortage_reason: string | null;
  shortage_status: EquipmentShortageStatus;
  shortage_decided_by: string | null;
  shortage_decided_name: string | null;
  shortage_decided_at: string | null;
  shortage_decision_note: string | null;
  /** Ile wydano (spakowano) — podstawa załadunku powrotnego i zwrotu. */
  shipped_qty: number;
  loadback_qty: number | null;
  loadback_note: string | null;
  loadback_at: string | null;
  loadback_by: string | null;
  loadback_by_name: string | null;
  return_ok_qty: number | null;
  return_damaged_qty: number | null;
  return_missing_qty: number | null;
  return_note: string | null;
  return_photos: string[];
  returned_at: string | null;
  returned_by: string | null;
  returned_by_name: string | null;
};

/** Osoba z checklisty (awatar przy pozycji / etapie): `EmployeeAvatar` w CRM, inicjały w aplikacji. */
export type EquipmentChecklistPerson = { id: string; name: string; avatar_url: string | null; avatar_metadata: Record<string, unknown> | null };

export type EquipmentChecklistCan = {
  pack: boolean;
  request_approval: boolean;
  approve_shortages: boolean;
  confirm_dispatch: boolean;
  request_unlock: boolean;
  loadback: boolean;
  confirm_loadback: boolean;
  return: boolean;
  confirm_return: boolean;
  ack_issues: boolean;
  reopen: boolean;
};

export type EquipmentChecklistSummary = {
  lines: number;
  required: number;
  unchecked_dispatch: number;
  packed_full: number;
  shortages: number;
  shortages_pending: number;
  shortages_approved: number;
  shortages_rejected: number;
  shipped: number;
  loadback_unchecked: number;
  loadback_missing: number;
  return_unchecked: number;
  return_damaged: number;
  return_missing: number;
};

export type EquipmentChecklistLogEntry = {
  id: string;
  stage: EquipmentStageKey;
  action: string;
  line_id: string | null;
  line_name: string | null;
  details: Record<string, unknown>;
  note: string | null;
  actor_name: string | null;
  created_at: string;
};

export type EquipmentChecklist = {
  event_id: string;
  stage: EquipmentChecklistStage;
  dispatch: {
    confirmed_at: string | null;
    confirmed_by: string | null;
    confirmed_by_name: string | null;
    note: string | null;
    locked: boolean;
    unlock_requested: boolean;
    unlock_requested_at: string | null;
    unlock_reason: string | null;
    shortage_requested_at: string | null;
    shortage_requested_name: string | null;
    shortage_request_note: string | null;
  };
  loadback: { confirmed_at: string | null; confirmed_by: string | null; confirmed_by_name: string | null; note: string | null };
  return: {
    confirmed_at: string | null;
    confirmed_by: string | null;
    confirmed_by_name: string | null;
    note: string | null;
    issue_count: number;
    issues_ack_at: string | null;
    issues_ack_by: string | null;
    issues_ack_name: string | null;
    issues_ack_note: string | null;
  };
  can: EquipmentChecklistCan;
  /** Co blokuje zatwierdzenie bieżącego etapu (gotowe zdania z bazy). */
  blockers: string[];
  /** Osoby występujące w checkliście (id pracownika → dane do awatara). */
  people: Record<string, EquipmentChecklistPerson>;
  summary: EquipmentChecklistSummary;
  lines: EquipmentChecklistLine[];
  log: EquipmentChecklistLogEntry[];
};

/** Funkcje bazy (nazwy RPC) — te same w CRM i w aplikacji. */
export const EQUIPMENT_CHECKLIST_RPC = {
  get: 'get_event_equipment_checklist',
  pack: 'set_event_equipment_packed',
  fill: 'fill_event_equipment_stage',
  requestApproval: 'request_event_equipment_shortage_approval',
  decideShortages: 'decide_event_equipment_shortages',
  confirmDispatch: 'confirm_event_equipment_dispatch',
  requestUnlock: 'request_event_equipment_unlock',
  reopen: 'reopen_event_equipment_stage',
  loadback: 'set_event_equipment_loadback',
  confirmLoadback: 'confirm_event_equipment_loadback',
  returnLine: 'set_event_equipment_return',
  confirmReturn: 'confirm_event_equipment_return',
  ackIssues: 'acknowledge_event_equipment_return_issues',
} as const;

/** Zdjęcia zwrotu: bucket i ścieżka akceptowane przez bazę (najwyżej 10 na pozycję). */
export const EQUIPMENT_RETURN_PHOTO_BUCKET = 'event-files';
export const EQUIPMENT_RETURN_PHOTO_LIMIT = 10;
export function equipmentReturnPhotoPath(eventId: string, lineId: string, fileName: string): string {
  const safe = fileName.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'zdjecie.jpg';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${eventId}/equipment-return/${lineId}/${unique}-${safe}`;
}

export const EQUIPMENT_STAGE_LABELS: Record<EquipmentChecklistStage, string> = {
  empty: 'Brak sprzętu',
  dispatch: 'Wydanie z magazynu',
  loadback: 'Załadunek powrotny',
  return: 'Zwrot na magazyn',
  issues: 'Rozbieżności do przyjęcia',
  done: 'Zakończone',
};

export const EQUIPMENT_STAGE_TABS: { key: EquipmentStageKey; label: string; owner: string; done: string }[] = [
  { key: 'dispatch', label: 'Wydanie', owner: 'Magazyn', done: 'Załadowane' },
  { key: 'loadback', label: 'Po wydarzeniu', owner: 'Kierownik realizacji', done: 'Załadowane po wydarzeniu' },
  { key: 'return', label: 'Zwrot', owner: 'Magazyn', done: 'Zwrócone' },
];

/** Krótka podpowiedź „co teraz” dla etapu wydarzenia. */
export const EQUIPMENT_STAGE_HINTS: Record<EquipmentChecklistStage, string> = {
  empty: 'Wydarzenie nie ma sprzętu na liście.',
  dispatch: 'Magazyn odhacza spakowane ilości. Brak oznacz mniejszą ilością z powodem — wydanie czeka na zgodę sprzedawcy lub administratora.',
  loadback: 'Kierownik realizacji przy załadunku po wydarzeniu odhacza, co wraca z wydanego sprzętu, i zatwierdza listę.',
  return: 'Magazyn wpisuje, ile wróciło sprawne, uszkodzone i czego brakuje (z opisem i zdjęciami), i zatwierdza zwrot.',
  issues: 'Zwrot ma rozbieżności — sprzedawca wydarzenia lub administrator przyjmuje je z decyzją, co dalej.',
  done: 'Sprzęt wrócił i został sprawdzony.',
};

export const EQUIPMENT_SHORTAGE_LABELS: Record<EquipmentShortageStatus, string> = {
  none: '',
  pending: 'Brak — czeka na zgodę',
  approved: 'Brak — zgoda',
  rejected: 'Brak — bez zgody',
};

export const EQUIPMENT_KIND_LABELS: Record<EquipmentLineKind, string> = {
  equipment: 'Sprzęt',
  kit: 'Zestaw',
  cable: 'Kabel',
};

/**
 * Jedna kolejność sprzętu wszędzie — lista sprzętu i checklista w CRM, aplikacji na Maca i telefonie oraz PDF checklisty:
 * zestawy, sprzęt, przewody; w każdej grupie kategoria magazynu (pozycje bez kategorii na końcu), potem nazwa
 * (polski alfabet, liczby naturalnie: „Kabel 2 m” przed „Kabel 10 m”).
 */
export type EquipmentOrderKey = { kind: EquipmentLineKind; category: string | null; name: string; id: string };

export const EQUIPMENT_KIND_SECTION_LABELS: Record<EquipmentLineKind, string> = {
  kit: 'Zestawy',
  equipment: 'Sprzęt',
  cable: 'Przewody',
};

const EQUIPMENT_KIND_ORDER: Record<EquipmentLineKind, number> = { kit: 0, equipment: 1, cable: 2 };

export function compareEquipmentOrder(a: EquipmentOrderKey, b: EquipmentOrderKey): number {
  const kind = (EQUIPMENT_KIND_ORDER[a.kind] ?? 1) - (EQUIPMENT_KIND_ORDER[b.kind] ?? 1);
  if (kind) return kind;
  const categoryA = (a.category || '').trim();
  const categoryB = (b.category || '').trim();
  if (!categoryA !== !categoryB) return categoryA ? -1 : 1;
  const category = categoryA.localeCompare(categoryB, 'pl', { sensitivity: 'base' });
  if (category) return category;
  const name = (a.name || '').localeCompare(b.name || '', 'pl', { sensitivity: 'base', numeric: true });
  return name || String(a.id).localeCompare(String(b.id));
}

/** Klucz kolejności wiersza `event_equipment` z osadzonymi `equipment` / `kit` / `cable` (i ich `category`). */
export function equipmentRowOrderKey(row: any): EquipmentOrderKey {
  const pick = (value: any) => (Array.isArray(value) ? value[0] : value) ?? null;
  const equipment = pick(row?.equipment), kit = pick(row?.kit), cable = pick(row?.cable);
  const kind: EquipmentLineKind = row?.kit_id || kit ? 'kit' : row?.cable_id || cable ? 'cable' : 'equipment';
  const owner = kind === 'kit' ? kit : kind === 'cable' ? cable : equipment;
  return {
    kind,
    category: pick(owner?.category)?.name ?? null,
    name: String(owner?.name || ''),
    id: String(row?.id || ''),
  };
}

export const EQUIPMENT_LOG_LABELS: Record<string, string> = {
  packed: 'Spakowano',
  filled: 'Wszystko zgodne',
  shortage_requested: 'Prośba o zgodę na braki',
  shortage_approved: 'Zgoda na braki',
  shortage_rejected: 'Brak zgody na braki',
  dispatch_confirmed: 'Wydanie potwierdzone',
  unlock_requested: 'Prośba o odblokowanie wydania',
  reopened: 'Cofnięto etap',
  loadback_set: 'Załadunek powrotny',
  loadback_confirmed: 'Załadunek powrotny zatwierdzony',
  return_set: 'Zwrot',
  return_confirmed: 'Zwrot zatwierdzony',
  issues_acknowledged: 'Rozbieżności przyjęte',
};

/** Wygląd pozycji na bieżącym etapie: czerwony = brak / uszkodzenie, żółty = czeka, zielony = zgodne. */
export type EquipmentLineTone = 'unchecked' | 'ok' | 'shortage' | 'pending' | 'damaged' | 'missing' | 'skipped';

export function equipmentLineTone(line: EquipmentChecklistLine, stage: EquipmentStageKey): EquipmentLineTone {
  if (stage === 'dispatch') {
    if (line.packed_qty == null) return line.required ? 'unchecked' : 'skipped';
    if (line.packed_qty >= line.quantity) return 'ok';
    if (!line.required) return line.packed_qty > 0 ? 'ok' : 'skipped';
    return line.shortage_status === 'approved' ? 'shortage' : line.shortage_status === 'rejected' ? 'missing' : 'pending';
  }
  if (line.shipped_qty <= 0) return 'skipped';
  if (stage === 'loadback') {
    if (line.loadback_qty == null) return 'unchecked';
    return line.loadback_qty >= line.shipped_qty ? 'ok' : 'missing';
  }
  if (line.return_ok_qty == null) return 'unchecked';
  if ((line.return_damaged_qty || 0) > 0) return 'damaged';
  return (line.return_missing_qty || 0) > 0 ? 'missing' : 'ok';
}

/** Kto i kiedy wykonał pozycję na etapie (badge „Załadowane” z awatarem). */
export function equipmentLineActor(line: EquipmentChecklistLine, stage: EquipmentStageKey): { id: string | null; name: string | null; at: string | null } {
  if (stage === 'dispatch') return { id: line.packed_by, name: line.packed_by_name, at: line.packed_at };
  if (stage === 'loadback') return { id: line.loadback_by, name: line.loadback_by_name, at: line.loadback_at };
  return { id: line.returned_by, name: line.returned_by_name, at: line.returned_at };
}

/** Pozycja „odhaczona w całości” na etapie (przekreślona z badge'em), a nie z brakiem / uszkodzeniem. */
export function equipmentLineDone(line: EquipmentChecklistLine, stage: EquipmentStageKey): boolean {
  return equipmentLineTone(line, stage) === 'ok';
}

/** Braki do decyzji sprzedawcy / administratora — parametr `p_lines` dla decide_event_equipment_shortages. */
export function equipmentShortageDecisionLines(checklist: EquipmentChecklist): { id: string; shortage_qty: number }[] {
  return checklist.lines
    .filter((line) => line.shortage_status === 'pending' || line.shortage_status === 'rejected')
    .map((line) => ({ id: line.id, shortage_qty: line.shortage_qty }));
}

/** Etap do cofnięcia przez administratora: ostatni zatwierdzony (zwrot → załadunek powrotny → wydanie). */
export function equipmentReopenableStage(checklist: EquipmentChecklist): EquipmentStageKey | null {
  if (checklist.return.confirmed_at && checklist.return.confirmed_by_name !== 'Nic nie wydano z magazynu') return 'return';
  if (checklist.loadback.confirmed_at && checklist.loadback.confirmed_by_name !== 'Nic nie wydano z magazynu') return 'loadback';
  if (checklist.dispatch.confirmed_at) return 'dispatch';
  return null;
}

/** Pozycje widoczne na etapie: wydanie — wszystkie; załadunek i zwrot — tylko wydane. */
export function equipmentStageLines(checklist: EquipmentChecklist, stage: EquipmentStageKey): EquipmentChecklistLine[] {
  return stage === 'dispatch' ? checklist.lines : checklist.lines.filter((line) => line.shipped_qty > 0);
}

/** Domyślny etap do pokazania: bieżący etap wydarzenia (rozbieżności i zakończone → zwrot). */
export function equipmentDefaultStage(checklist: EquipmentChecklist): EquipmentStageKey {
  if (checklist.stage === 'loadback') return 'loadback';
  if (checklist.stage === 'return' || checklist.stage === 'issues' || checklist.stage === 'done') return 'return';
  return 'dispatch';
}

/** Walidacja jak w bazie — komunikat do pokazania przy polu albo null. */
export function equipmentPackedError(line: EquipmentChecklistLine, qty: number | null, reason: string): string | null {
  if (qty == null) return null;
  if (!Number.isInteger(qty) || qty < 0 || qty > line.quantity) return `Spakowana ilość musi być od 0 do ${line.quantity}.`;
  if (qty < line.quantity && line.required && reason.trim().length < 3) return `Brakuje ${line.quantity - qty} szt. — opisz powód braku.`;
  return null;
}

export function equipmentLoadbackError(line: EquipmentChecklistLine, qty: number | null, note: string): string | null {
  if (qty == null) return null;
  if (!Number.isInteger(qty) || qty < 0 || qty > line.shipped_qty) return `Ilość musi być od 0 do ${line.shipped_qty} (tyle wydano).`;
  if (qty < line.shipped_qty && note.trim().length < 3) return `Brakuje ${line.shipped_qty - qty} szt. — opisz, co się stało.`;
  return null;
}

export function equipmentReturnMissing(line: EquipmentChecklistLine, ok: number, damaged: number): number {
  return Math.max(line.shipped_qty - ok - damaged, 0);
}

export function equipmentReturnError(line: EquipmentChecklistLine, ok: number | null, damaged: number, note: string): string | null {
  if (ok == null) return null;
  if (!Number.isInteger(ok) || !Number.isInteger(damaged) || ok < 0 || damaged < 0 || ok + damaged > line.shipped_qty) {
    return `Sprawne i uszkodzone razem mogą dać najwyżej ${line.shipped_qty} szt.`;
  }
  if ((damaged > 0 || ok + damaged < line.shipped_qty) && note.trim().length < 3) return 'Opisz uszkodzenia lub brak.';
  return null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};
const numOrNull = (value: unknown): number | null => (value == null || value === '' ? null : num(value, NaN));
const bool = (value: unknown): boolean => value === true;
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const STAGES: EquipmentChecklistStage[] = ['empty', 'dispatch', 'loadback', 'return', 'issues', 'done'];
const SHORTAGES: EquipmentShortageStatus[] = ['none', 'pending', 'approved', 'rejected'];
const KINDS: EquipmentLineKind[] = ['equipment', 'kit', 'cable'];
const STAGE_KEYS: EquipmentStageKey[] = ['dispatch', 'loadback', 'return'];

function parseLine(raw: unknown): EquipmentChecklistLine | null {
  const line = obj(raw);
  const id = str(line.id);
  if (!id) return null;
  const shortage = str(line.shortage_status) as EquipmentShortageStatus | null;
  const kind = str(line.kind) as EquipmentLineKind | null;
  const nullable = (key: string) => {
    const value = numOrNull(line[key]);
    return value == null || Number.isNaN(value) ? null : value;
  };
  return {
    id,
    name: str(line.name) || 'Sprzęt',
    kind: kind && KINDS.includes(kind) ? kind : 'equipment',
    category: str(line.category),
    thumbnail_url: str(line.thumbnail_url),
    notes: str(line.notes),
    quantity: num(line.quantity),
    required: bool(line.required),
    optional: bool(line.optional),
    external_rental: bool(line.external_rental),
    removed: bool(line.removed),
    packed_qty: nullable('packed_qty'),
    packed_at: str(line.packed_at),
    packed_by: str(line.packed_by),
    packed_by_name: str(line.packed_by_name),
    shortage_qty: num(line.shortage_qty),
    shortage_reason: str(line.shortage_reason),
    shortage_status: shortage && SHORTAGES.includes(shortage) ? shortage : 'none',
    shortage_decided_by: str(line.shortage_decided_by),
    shortage_decided_name: str(line.shortage_decided_name),
    shortage_decided_at: str(line.shortage_decided_at),
    shortage_decision_note: str(line.shortage_decision_note),
    shipped_qty: num(line.shipped_qty),
    loadback_qty: nullable('loadback_qty'),
    loadback_note: str(line.loadback_note),
    loadback_at: str(line.loadback_at),
    loadback_by: str(line.loadback_by),
    loadback_by_name: str(line.loadback_by_name),
    return_ok_qty: nullable('return_ok_qty'),
    return_damaged_qty: nullable('return_damaged_qty'),
    return_missing_qty: nullable('return_missing_qty'),
    return_note: str(line.return_note),
    return_photos: list(line.return_photos).filter((path): path is string => typeof path === 'string' && path.length > 0),
    returned_at: str(line.returned_at),
    returned_by: str(line.returned_by),
    returned_by_name: str(line.returned_by_name),
  };
}

/** Odczyt wyniku RPC get_event_equipment_checklist (i każdej funkcji zmieniającej checklistę). */
export function parseEquipmentChecklist(raw: unknown): EquipmentChecklist | null {
  const data = obj(raw);
  const eventId = str(data.event_id);
  if (!eventId) return null;
  const stage = str(data.stage) as EquipmentChecklistStage | null;
  const dispatch = obj(data.dispatch);
  const loadback = obj(data.loadback);
  const ret = obj(data.return);
  const can = obj(data.can);
  const summary = obj(data.summary);
  return {
    event_id: eventId,
    stage: stage && STAGES.includes(stage) ? stage : 'dispatch',
    dispatch: {
      confirmed_at: str(dispatch.confirmed_at),
      confirmed_by: str(dispatch.confirmed_by),
      confirmed_by_name: str(dispatch.confirmed_by_name),
      note: str(dispatch.note),
      locked: bool(dispatch.locked),
      unlock_requested: bool(dispatch.unlock_requested),
      unlock_requested_at: str(dispatch.unlock_requested_at),
      unlock_reason: str(dispatch.unlock_reason),
      shortage_requested_at: str(dispatch.shortage_requested_at),
      shortage_requested_name: str(dispatch.shortage_requested_name),
      shortage_request_note: str(dispatch.shortage_request_note),
    },
    loadback: { confirmed_at: str(loadback.confirmed_at), confirmed_by: str(loadback.confirmed_by), confirmed_by_name: str(loadback.confirmed_by_name), note: str(loadback.note) },
    return: {
      confirmed_at: str(ret.confirmed_at),
      confirmed_by: str(ret.confirmed_by),
      confirmed_by_name: str(ret.confirmed_by_name),
      note: str(ret.note),
      issue_count: num(ret.issue_count),
      issues_ack_at: str(ret.issues_ack_at),
      issues_ack_by: str(ret.issues_ack_by),
      issues_ack_name: str(ret.issues_ack_name),
      issues_ack_note: str(ret.issues_ack_note),
    },
    can: {
      pack: bool(can.pack),
      request_approval: bool(can.request_approval),
      approve_shortages: bool(can.approve_shortages),
      confirm_dispatch: bool(can.confirm_dispatch),
      request_unlock: bool(can.request_unlock),
      loadback: bool(can.loadback),
      confirm_loadback: bool(can.confirm_loadback),
      return: bool(can.return),
      confirm_return: bool(can.confirm_return),
      ack_issues: bool(can.ack_issues),
      reopen: bool(can.reopen),
    },
    blockers: list(data.blockers).filter((item): item is string => typeof item === 'string'),
    people: Object.fromEntries(Object.entries(obj(data.people)).map(([id, raw]) => {
      const person = obj(raw);
      const metadata = obj(person.avatar_metadata);
      return [id, { id, name: str(person.name) || 'Pracownik', avatar_url: str(person.avatar_url),
        avatar_metadata: Object.keys(metadata).length ? metadata : null }];
    })),
    summary: {
      lines: num(summary.lines),
      required: num(summary.required),
      unchecked_dispatch: num(summary.unchecked_dispatch),
      packed_full: num(summary.packed_full),
      shortages: num(summary.shortages),
      shortages_pending: num(summary.shortages_pending),
      shortages_approved: num(summary.shortages_approved),
      shortages_rejected: num(summary.shortages_rejected),
      shipped: num(summary.shipped),
      loadback_unchecked: num(summary.loadback_unchecked),
      loadback_missing: num(summary.loadback_missing),
      return_unchecked: num(summary.return_unchecked),
      return_damaged: num(summary.return_damaged),
      return_missing: num(summary.return_missing),
    },
    lines: list(data.lines).map(parseLine).filter((line): line is EquipmentChecklistLine => line !== null).sort(compareEquipmentOrder),
    log: list(data.log).map((raw) => {
      const entry = obj(raw);
      const entryStage = str(entry.stage) as EquipmentStageKey | null;
      return {
        id: str(entry.id) || '',
        stage: entryStage && STAGE_KEYS.includes(entryStage) ? entryStage : 'dispatch',
        action: str(entry.action) || '',
        line_id: str(entry.line_id),
        line_name: str(entry.line_name),
        details: obj(entry.details),
        note: str(entry.note),
        actor_name: str(entry.actor_name),
        created_at: str(entry.created_at) || '',
      };
    }).filter((entry) => entry.id),
  };
}

/** Kod błędu bazy „brak funkcji” — starsza baza bez migracji checklisty (ekran pokazuje dawną listę / komunikat). */
export function isEquipmentChecklistMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === 'PGRST202' || error.code === '42883' || /get_event_equipment_checklist/.test(error.message || '')));
}
