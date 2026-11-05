import { supabase } from '@/lib/supabase/browser';
import {
  EQUIPMENT_LOG_LABELS,
  EQUIPMENT_RETURN_PHOTO_BUCKET,
  equipmentLineDone,
  equipmentLineTone,
  equipmentStageLines,
  type EquipmentChecklist,
  type EquipmentChecklistLine,
  type EquipmentChecklistLogEntry,
  type EquipmentStageKey,
} from '@/lib/events/equipment/equipmentChecklist';
import type { EquipmentChecklistRpc, EquipmentChecklistRunResult } from './useEquipmentChecklist';

/** Stan checklisty przekazywany do wiersza listy sprzętu (jedna lista = checklista). */
export type EquipmentRowChecklist = {
  line: EquipmentChecklistLine;
  stage: EquipmentStageKey;
  /** Czy bieżąca osoba może odhaczać ten etap (`can.pack` / `can.loadback` / `can.return`). */
  editable: boolean;
  busy: boolean;
  people: EquipmentChecklist['people'];
  eventId: string;
  save: (fn: EquipmentChecklistRpc, params: Record<string, unknown>) => Promise<EquipmentChecklistRunResult>;
};

/** Tło wiersza (bez obramowań): czerwony = brak / uszkodzenie, żółty = czeka na zgodę, zielony = zgodne. */
export function equipmentRowTint(line: EquipmentChecklistLine, stage: EquipmentStageKey): string {
  switch (equipmentLineTone(line, stage)) {
    case 'ok':
      return 'bg-emerald-500/[0.05]';
    case 'pending':
      return 'bg-amber-400/[0.09]';
    case 'shortage':
    case 'missing':
    case 'damaged':
      return 'bg-red-500/[0.09]';
    default:
      return '';
  }
}

/** Postęp etapu: odhaczone w całości / pozycje etapu (przy wydaniu bez nieodhaczonych pozycji opcjonalnych). */
export function equipmentStageProgress(checklist: EquipmentChecklist, stage: EquipmentStageKey): { done: number; total: number; problems: number } {
  const lines = equipmentStageLines(checklist, stage).filter(line => stage !== 'dispatch' || line.required || line.packed_qty != null);
  let done = 0;
  let problems = 0;
  for (const line of lines) {
    const tone = equipmentLineTone(line, stage);
    if (equipmentLineDone(line, stage)) done += 1;
    else if (tone === 'shortage' || tone === 'missing' || tone === 'damaged' || tone === 'pending') problems += 1;
  }
  return { done, total: lines.length, problems };
}

export const equipmentInputClass =
  'block w-full rounded-lg bg-black/25 px-3 py-2 text-sm text-[#e5e4e2] outline-none placeholder:text-white/35 focus:bg-black/35 focus:ring-1 focus:ring-[#d3bb73]/25 disabled:opacity-60';

export const equipmentPrimaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#210811] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-45';
export const equipmentSecondaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#d3bb73]/15 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/25 disabled:cursor-not-allowed disabled:opacity-45';
export const equipmentQuietButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-[#e5e4e2]/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45';
export const equipmentDangerButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-45';

const pad = (value: number) => String(value).padStart(2, '0');

/** „05.11.2026, 17:40”. */
export function formatEquipmentDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** „05.11, 17:40” — do chipów etapów. */
export function formatEquipmentShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** „Jan Kowalski · 05.11.2026, 17:40”. */
export function equipmentByLine(name: string | null | undefined, at: string | null | undefined): string {
  return [name, formatEquipmentDate(at)].filter(Boolean).join(' · ');
}

export const firstName = (name: string | null | undefined): string => (name || '').trim().split(/\s+/)[0] || '';

/** Komunikat błędu z bazy (funkcje checklisty zwracają czytelne komunikaty po polsku). */
export function equipmentErrorMessage(error: unknown, fallback = 'Nie udało się zapisać checklisty. Spróbuj ponownie.'): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  if (/Failed to fetch|Network request failed|fetch failed|NetworkError/i.test(message)) {
    return 'Brak połączenia. Spróbuj ponownie za chwilę.';
  }
  return message || fallback;
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
      return packed == null ? 'odznaczono' : `${packed}/${numberOf(d.quantity) ?? '?'} szt.`;
    }
    case 'loadback_set': {
      const qty = numberOf(d.loadback_qty);
      return qty == null ? 'odznaczono' : `wraca ${qty}/${numberOf(d.shipped_qty) ?? '?'} szt.`;
    }
    case 'return_set': {
      const ok = numberOf(d.ok);
      if (ok == null) return numberOf(d.photos) ? `zdjęcia: ${numberOf(d.photos)}` : 'odznaczono';
      const parts = [`sprawne ${ok}`];
      if (numberOf(d.damaged)) parts.push(`uszkodzone ${numberOf(d.damaged)}`);
      if (numberOf(d.missing)) parts.push(`brak ${numberOf(d.missing)}`);
      if (numberOf(d.photos)) parts.push(`zdjęcia ${numberOf(d.photos)}`);
      return parts.join(', ');
    }
    case 'filled':
      return numberOf(d.count) ? `pozycji: ${numberOf(d.count)}` : '';
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
  return EQUIPMENT_LOG_LABELS[entry.action] ?? 'Zmiana checklisty';
}
