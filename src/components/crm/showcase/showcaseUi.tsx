'use client';

import { useRef, useState, type DragEvent } from 'react';
import {
  Award, Building2, Camera, Gamepad2, Gift, Layers, Lightbulb, Mic, Monitor, Music, PartyPopper, Sparkles, Speaker, Star, Theater,
  Tv, Users, UtensilsCrossed,
} from 'lucide-react';
import type { ShowcaseIcon } from '@/lib/showcase/showcaseShared';

/* Wspólne elementy Prezentacji w CRM: ikony działów, przeciąganie na listach (HTML5) i drobne kontrolki. */

export const SHOWCASE_ICON_COMPONENTS: Record<ShowcaseIcon, typeof Sparkles> = {
  sparkles: Sparkles,
  monitor: Monitor,
  tv: Tv,
  speaker: Speaker,
  lightbulb: Lightbulb,
  stage: Theater,
  mic: Mic,
  music: Music,
  camera: Camera,
  gamepad: Gamepad2,
  party: PartyPopper,
  users: Users,
  building: Building2,
  utensils: UtensilsCrossed,
  gift: Gift,
  star: Star,
  layers: Layers,
  award: Award,
};

export function SectionIcon({ icon, className }: { icon: ShowcaseIcon; className?: string }) {
  const Icon = SHOWCASE_ICON_COMPONENTS[icon] || Sparkles;
  return <Icon className={className} />;
}

/** Przeniesienie elementu na miejsce przed / za wskazanym (kolejność listy po upuszczeniu). */
export function moveItem<T>(list: T[], from: number, to: number, before: boolean): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  let index = to > from ? to - 1 : to;
  if (!before) index += 1;
  next.splice(Math.max(0, Math.min(next.length, index)), 0, moved);
  return next;
}

/**
 * Przeciąganie na liście (HTML5): `rowProps` — cel upuszczenia (cały wiersz), `handleProps` — uchwyt (albo cały wiersz,
 * gdy `wholeRow`). Miejsce upuszczenia: przed albo za wierszem według połowy wiersza (pion) albo kafelka (poziom).
 * `group` oddziela listy (np. bloki od wierszy w bloku) — przeciągnięcie z innej listy nie zmienia tej.
 */
export function useDragList<T>({ items, keyOf, onMove, axis = 'y', group }: {
  items: T[];
  keyOf: (item: T) => string;
  onMove: (next: T[]) => void;
  axis?: 'x' | 'y';
  group: string;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ key: string; before: boolean } | null>(null);
  const dragRef = useRef<string | null>(null);
  const type = `application/x-mavinci-${group}`.toLowerCase();
  const end = () => { dragRef.current = null; setDrag(null); setOver(null); };
  const handleProps = (item: T) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(type, keyOf(item));
      dragRef.current = keyOf(item);
      setDrag(keyOf(item));
    },
    onDragEnd: end,
  });
  const rowProps = (item: T) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragRef.current || !event.dataTransfer.types.includes(type)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const before = axis === 'y' ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2;
      if (over?.key !== keyOf(item) || over.before !== before) setOver({ key: keyOf(item), before });
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!dragRef.current || !event.dataTransfer.types.includes(type)) return;
      event.preventDefault();
      event.stopPropagation();
      const from = items.findIndex((entry) => keyOf(entry) === dragRef.current);
      const to = items.findIndex((entry) => keyOf(entry) === keyOf(item));
      const rect = event.currentTarget.getBoundingClientRect();
      const before = axis === 'y' ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2;
      end();
      if (from < 0 || to < 0 || from === to) return;
      const next = moveItem(items, from, to, before);
      if (next.some((entry, index) => keyOf(entry) !== keyOf(items[index]))) onMove(next);
    },
  });
  /** Kreska w miejscu upuszczenia (klasa Tailwind dla wiersza). */
  const indicator = (item: T) => {
    if (!over || over.key !== keyOf(item) || drag === keyOf(item)) return '';
    if (axis === 'y') return over.before ? 'shadow-[0_-2px_0_0_#d3bb73]' : 'shadow-[0_2px_0_0_#d3bb73]';
    return over.before ? 'shadow-[-3px_0_0_0_#d3bb73]' : 'shadow-[3px_0_0_0_#d3bb73]';
  };
  return { drag, handleProps, rowProps, indicator, dragging: (item: T) => drag === keyOf(item) };
}

/** Przełącznik (widoczność działu / karty, ukrycie bloku). */
export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#d3bb73]' : 'bg-[#e5e4e2]/20'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span className="text-[#e5e4e2]/80">{label}</span>
    </label>
  );
}

/** Pliki obrazów z przeciągnięcia (Finder, pulpit). HEIC — komunikat (zapisz jako JPEG albo dodaj z aplikacji na Maca). */
export function imageFiles(list: FileList | File[] | null | undefined): { images: File[]; heic: number; other: number } {
  const all = Array.from(list || []);
  const images = all.filter((file) => /^image\/(jpeg|png|webp)$/.test(file.type));
  const heic = all.filter((file) => /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)).length;
  return { images, heic, other: all.length - images.length - heic };
}

export const hasFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types || []).includes('Files');
