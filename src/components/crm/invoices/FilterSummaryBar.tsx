'use client';

import { SlidersHorizontal, X } from 'lucide-react';

/*
 * Stan filtrów listy — okno „Dopasuj dokument do płatności” i „Wszystkie dokumenty” w Finansach (na Macu `FinFilterSummary`).
 * Filtry działają od razu po zmianie, a ten pasek pokazuje, że są włączone: ile pozycji widać z ilu, które filtry działają
 * (× wyłącza jeden) i „Wyczyść filtry”. Bez filtrów — liczba wszystkich pozycji. Zmienione pole filtra wyróżnia
 * `activeFilterClass`.
 */

export type FilterChip = { key: string; label: string; onRemove: () => void };

/** Odmiana rzeczownika po liczbie: 1, 2–4 (bez 12–14), 5+ — np. „dokument”, „dokumenty”, „dokumentów”. */
export function polishCount(count: number, forms: [string, string, string]) {
  if (count === 1) return forms[0];
  const ones = count % 10;
  const tens = count % 100;
  return ones >= 2 && ones <= 4 && !(tens >= 12 && tens <= 14) ? forms[1] : forms[2];
}

/** Pole filtra: zmienione względem domyślnego — złota obwódka i tło; domyślne — zwykłe pole. */
export function activeFilterClass(active: boolean) {
  return active
    ? 'border-[#d3bb73]/70 bg-[#d3bb73]/10 text-[#d3bb73]'
    : 'border-white/15 bg-[#1c1f33] text-[#e5e4e2]';
}

/** Data `RRRR-MM-DD` po polsku (etykieta filtra). */
export function filterDateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pl-PL');
}

export default function FilterSummaryBar({
  shown,
  total,
  forms,
  chips,
  onClear,
  className = '',
}: {
  shown: number;
  total: number;
  forms: [string, string, string];
  chips: FilterChip[];
  onClear: () => void;
  className?: string;
}) {
  const active = chips.length > 0;
  return (
    <div role="status" aria-live="polite" className={`flex min-h-[26px] flex-wrap items-center gap-2 text-xs ${className}`}>
      <SlidersHorizontal className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40'}`} aria-hidden="true" />
      {active ? (
        <>
          <span className="font-medium tabular-nums text-[#e5e4e2]">Pokazano {shown} z {total}</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              title="Wyłącz ten filtr"
              aria-label={`Wyłącz filtr: ${chip.label}`}
              className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-[#d3bb73]/40 bg-[#d3bb73]/10 px-2 py-0.5 text-[11px] text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
            >
              <span className="truncate">{chip.label}</span>
              <X className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-[11px] font-medium text-[#d3bb73] underline-offset-2 hover:underline"
          >
            Wyczyść filtry
          </button>
        </>
      ) : (
        <span className="text-[#e5e4e2]/50">
          Bez filtrów · {total} {polishCount(total, forms)}
        </span>
      )}
    </div>
  );
}
