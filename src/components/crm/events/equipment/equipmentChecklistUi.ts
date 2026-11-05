import { supabase } from '@/lib/supabase/browser';
import {
  EQUIPMENT_LOG_LABELS,
  EQUIPMENT_RETURN_PHOTO_BUCKET,
  type EquipmentChecklistLine,
  type EquipmentChecklistLogEntry,
  type EquipmentLineTone,
  type EquipmentStageKey,
} from '@/lib/events/equipment/equipmentChecklist';

/** Tło wiersza pozycji (bez obramowań): czerwony = brak / uszkodzenie, żółty = czeka, zielony = zgodne. */
export const EQUIPMENT_TONE_ROW: Record<EquipmentLineTone, string> = {
  unchecked: 'bg-white/[0.04]',
  ok: 'bg-emerald-500/[0.10]',
  shortage: 'bg-red-500/[0.12]',
  pending: 'bg-amber-400/[0.12]',
  damaged: 'bg-red-500/[0.14]',
  missing: 'bg-red-500/[0.14]',
  skipped: 'bg-white/[0.02]',
};

export const EQUIPMENT_TONE_CHIP: Record<EquipmentLineTone, string> = {
  unchecked: 'bg-white/10 text-[#e5e4e2]/75',
  ok: 'bg-emerald-400/15 text-emerald-200',
  shortage: 'bg-red-500/20 text-red-200',
  pending: 'bg-amber-400/20 text-amber-200',
  damaged: 'bg-red-500/20 text-red-200',
  missing: 'bg-red-500/20 text-red-200',
  skipped: 'bg-white/5 text-[#e5e4e2]/50',
};

/** Etykieta stanu pozycji na etapie (przy wydaniu braki opisuje EQUIPMENT_SHORTAGE_LABELS). */
export function equipmentToneLabel(tone: EquipmentLineTone, stage: EquipmentStageKey): string {
  if (stage === 'dispatch') {
    return { unchecked: 'Do odhaczenia', ok: 'Spakowane', shortage: 'Brak — zgoda', pending: 'Brak — czeka na zgodę',
      damaged: 'Brak', missing: 'Brak — bez zgody', skipped: 'Niewymagane' }[tone];
  }
  if (stage === 'loadback') {
    return { unchecked: 'Do sprawdzenia', ok: 'Wraca komplet', shortage: 'Brak', pending: 'Czeka', damaged: 'Brak',
      missing: 'Nie wraca w komplecie', skipped: 'Nie wydano' }[tone];
  }
  return { unchecked: 'Do sprawdzenia', ok: 'Sprawne', shortage: 'Brak', pending: 'Czeka', damaged: 'Uszkodzone',
    missing: 'Brak', skipped: 'Nie wydano' }[tone];
}

export const equipmentInputClass =
  'block w-full rounded-lg bg-black/25 px-3 py-2 text-sm text-[#e5e4e2] outline-none placeholder:text-white/35 focus:bg-black/35 focus:ring-1 focus:ring-[#d3bb73]/25 disabled:opacity-60';

export const equipmentPrimaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#d3bb73] px-3.5 py-2 text-sm font-medium text-[#210811] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-45';
export const equipmentSecondaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#d3bb73]/15 px-3.5 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/25 disabled:cursor-not-allowed disabled:opacity-45';
export const equipmentQuietButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-[#e5e4e2]/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45';
export const equipmentDangerButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-500/20 px-3.5 py-2 text-sm text-red-100 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-45';

const pad = (value: number) => String(value).padStart(2, '0');

/** „05.11.2026, 17:40”. */
export function formatEquipmentDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** „Jan Kowalski · 05.11.2026, 17:40”. */
export function equipmentByLine(name: string | null | undefined, at: string | null | undefined): string {
  return [name, formatEquipmentDate(at)].filter(Boolean).join(' · ');
}

/** Komunikat błędu z bazy (funkcje checklisty zwracają czytelne komunikaty po polsku). */
export function equipmentErrorMessage(error: unknown, fallback = 'Nie udało się zapisać checklisty. Spróbuj ponownie.'): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  if (/Failed to fetch|Network request failed|fetch failed|NetworkError/i.test(message)) {
    return 'Brak połączenia. Spróbuj ponownie za chwilę.';
  }
  return message || fallback;
}

/** Pozycje pogrupowane według kategorii magazynu (kolejność z bazy: kategoria, nazwa). */
export function groupEquipmentLines(lines: EquipmentChecklistLine[]): { category: string; lines: EquipmentChecklistLine[] }[] {
  const groups = new Map<string, EquipmentChecklistLine[]>();
  for (const line of lines) {
    const key = line.category || 'Bez kategorii';
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  }
  return Array.from(groups, ([category, items]) => ({ category, lines: items }));
}

/** Publiczny adres zdjęcia zwrotu (bucket event-files jest publiczny). */
export function equipmentPhotoUrl(path: string): string {
  return supabase.storage.from(EQUIPMENT_RETURN_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

const numberOf = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Krótki opis wpisu historii (ilości, braki). */
export function equipmentLogDetail(entry: EquipmentChecklistLogEntry): string {
  const d = entry.details || {};
  switch (entry.action) {
    case 'packed': {
      const packed = numberOf(d.packed_qty);
      const quantity = numberOf(d.quantity);
      return packed == null ? 'odznaczono' : `${packed}/${quantity ?? '?'} szt.`;
    }
    case 'loadback_set': {
      const qty = numberOf(d.loadback_qty);
      return qty == null ? 'odznaczono' : `wraca ${qty}/${numberOf(d.shipped_qty) ?? '?'} szt.`;
    }
    case 'return_set': {
      const ok = numberOf(d.ok);
      if (ok == null) return numberOf(d.photos) ? `zdjęcia: ${numberOf(d.photos)}` : 'odznaczono';
      const parts = [`sprawne ${ok}`];
      const damaged = numberOf(d.damaged);
      const missing = numberOf(d.missing);
      if (damaged) parts.push(`uszkodzone ${damaged}`);
      if (missing) parts.push(`brak ${missing}`);
      if (numberOf(d.photos)) parts.push(`zdjęcia ${numberOf(d.photos)}`);
      return parts.join(', ');
    }
    case 'filled': {
      const count = numberOf(d.count);
      return count ? `pozycji: ${count}` : '';
    }
    case 'shortage_requested':
    case 'shortage_approved':
    case 'shortage_rejected':
    case 'dispatch_confirmed':
      return textOf(d.shortages) ? `Braki: ${textOf(d.shortages)}` : '';
    case 'loadback_confirmed':
      return textOf(d.missing) ? `Rozbieżności: ${textOf(d.missing)}` : 'komplet';
    case 'return_confirmed': {
      const issues = numberOf(d.issues);
      return issues ? `Rozbieżności (${issues}): ${textOf(d.list) ?? ''}`.trim() : 'bez rozbieżności';
    }
    default:
      return '';
  }
}

export function equipmentLogLabel(entry: EquipmentChecklistLogEntry): string {
  return EQUIPMENT_LOG_LABELS[entry.action] ?? entry.action;
}
