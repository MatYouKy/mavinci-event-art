'use client';

/* eslint-disable @next/next/no-img-element */

import {
  Archive, File as FileIcon, FileAudio, FileImage, FileSpreadsheet, FileText, FileType, FileVideo, Folder, FolderHeart, Image as ImageIcon,
  Images, Palette, Presentation, Type, Video,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MaterialKind, MaterialSystemFolder } from '@/lib/materials/materialsShared';

/* Wspólne elementy widoków Materiałów w CRM (klasy przycisków, ikony rodzajów plików, miniatury, daty). */

export const cardClass = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
/**
 * Układ dwóch paneli na komputerze (Dysk, Materiały): pasek folderów i obszar treści w ramkach — wyraźna linia między paskiem
 * a treścią (jak na Macu: `crmPanel()`). Obszar treści ma ramkę od szerokości `lg` (na telefonie i tablecie — bez ramki, cała
 * szerokość); jego tło jest ciemniejsze od kart, żeby listy i kafelki w środku (`cardClass`) dalej się odróżniały.
 */
export const sidePanelClass = 'rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]';
export const contentPanelClass = 'lg:rounded-xl lg:border lg:border-[#d3bb73]/20 lg:bg-[#161a2a] lg:p-5';
export const inputClass =
  'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/40 disabled:opacity-50';
export const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40';
export const primaryButton = `${buttonClass} bg-[#d3bb73] font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90`;
export const secondaryButton = `${buttonClass} border border-[#d3bb73]/20 bg-[#d3bb73]/5 text-[#d3bb73] hover:bg-[#d3bb73]/15`;
export const ghostButton = `${buttonClass} text-[#e5e4e2]/70 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]`;
export const dangerButton = `${buttonClass} border border-red-400/25 bg-red-500/10 text-red-300 hover:bg-red-500/20`;

const KIND_ICONS: Record<MaterialKind, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  design: Palette,
  archive: Archive,
  font: Type,
  other: FileIcon,
};

export const kindIcon = (kind: MaterialKind): LucideIcon => KIND_ICONS[kind] || FileType;

const SYSTEM_ICONS: Record<MaterialSystemFolder, LucideIcon> = {
  brand: FolderHeart,
  photos: Images,
  video: Video,
  presentations: Presentation,
  documents: FileText,
  social: ImageIcon,
};

export const folderIcon = (systemKey: MaterialSystemFolder | null): LucideIcon => (systemKey ? SYSTEM_ICONS[systemKey] : Folder);

/** Miniatura pliku (obraz z serwera) albo ikona rodzaju. */
export function MaterialThumb({ url, kind, name, className = '', contain = false }: {
  url: string | null; kind: MaterialKind; name: string; className?: string; contain?: boolean;
}) {
  const Icon = kindIcon(kind);
  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-[#0f1119] text-[#d3bb73]/70 ${className}`} title={name}>
      {url ? (
        <img src={url} alt={name} loading="lazy" decoding="async" draggable={false}
          className={`h-full w-full ${contain || kind === 'pdf' ? 'bg-white object-contain' : 'object-cover'}`} />
      ) : (
        <Icon className="h-1/3 max-h-10 w-1/3 max-w-10" strokeWidth={1.4} />
      )}
      {kind === 'video' && url && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">wideo</span>
      )}
      {kind === 'pdf' && url && (
        <span className="absolute bottom-1 right-1 rounded bg-red-700/90 px-1 py-0.5 text-[9px] font-bold leading-none text-white">PDF</span>
      )}
    </div>
  );
}

export function dateLabel(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateTimeLabel(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** „za 12 dni” / „dziś” — kiedy element zniknie z kosza. */
export function purgeLabel(value: string | null | undefined) {
  if (!value) return '';
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'dziś';
  if (days === 1) return 'za 1 dzień';
  return `za ${days} dni`;
}

export const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/** Pliki przeciągnięte z dysku (nie elementy Materiałów przeciągane w obrębie strony). */
export const isFileDrag = (event: { dataTransfer: DataTransfer | null }) =>
  Array.from(event.dataTransfer?.types || []).includes('Files');

export const ITEM_DRAG_TYPE = 'application/x-mavinci-materials';
