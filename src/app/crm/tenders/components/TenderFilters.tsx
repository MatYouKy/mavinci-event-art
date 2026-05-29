'use client';

import { Search, SlidersHorizontal } from 'lucide-react';
import type { TenderFiltersState } from '../page';

interface Props {
  filters: TenderFiltersState;
  onChange: (filters: TenderFiltersState) => void;
}

export default function TenderFilters({ filters, onChange }: Props) {
  const update = (partial: Partial<TenderFiltersState>) => {
    onChange({ ...filters, ...partial });
  };

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
      <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
        <SlidersHorizontal className="h-4 w-4" />
        <span>Filtry</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/30" />
          <input
            type="text"
            placeholder="Szukaj w tytule, opisie, zamawiającym..."
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] py-2 pl-10 pr-4 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/40 focus:outline-none"
          />
        </div>

        <select
          value={filters.source}
          onChange={(e) => update({ source: e.target.value })}
          className="rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
        >
          <option value="">Wszystkie źródła</option>
          <option value="bzp">BZP</option>
          <option value="ted">TED</option>
          <option value="baza_konkurencyjnosci">Baza Konkurencyjności</option>
        </select>

        <select
          value={filters.status}
          onChange={(e) => update({ status: e.target.value })}
          className="rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
        >
          <option value="">Wszystkie statusy</option>
          <option value="new">Nowy</option>
          <option value="reviewing">W analizie</option>
          <option value="interested">Zainteresowany</option>
          <option value="preparing">Przygotowywanie oferty</option>
          <option value="submitted">Oferta złożona</option>
          <option value="won">Wygrana</option>
          <option value="lost">Przegrana</option>
          <option value="ignored">Zignorowany</option>
        </select>

        <select
          value={filters.isMatched}
          onChange={(e) => update({ isMatched: e.target.value })}
          className="rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
        >
          <option value="">Wszystkie</option>
          <option value="matched">Dopasowane</option>
          <option value="unmatched">Niedopasowane</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
          <input
            type="checkbox"
            checked={filters.isWatched}
            onChange={(e) => update({ isWatched: e.target.checked })}
            className="rounded border-[#d3bb73]/30 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]/30"
          />
          Tylko obserwowane
        </label>

        <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
          <input
            type="checkbox"
            checked={filters.showHidden}
            onChange={(e) => update({ showHidden: e.target.checked })}
            className="rounded border-[#d3bb73]/30 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]/30"
          />
          Pokaż ukryte
        </label>

        <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
          <span>Min. ocena:</span>
          <input
            type="number"
            min={0}
            max={100}
            value={filters.minScore}
            onChange={(e) => update({ minScore: Number(e.target.value) })}
            className="w-16 rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-2 py-1 text-center text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
          />
        </div>

        <div className="ml-auto flex items-center gap-2 text-sm text-[#e5e4e2]/60">
          <span>Sortuj:</span>
          <select
            value={filters.sortBy}
            onChange={(e) => update({ sortBy: e.target.value })}
            className="rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
          >
            <option value="relevance_score">Ocena trafności</option>
            <option value="publication_date">Data publikacji</option>
            <option value="submission_deadline">Termin składania</option>
            <option value="created_at">Data dodania</option>
          </select>
          <button
            onClick={() => update({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })}
            className="rounded-lg border border-[#d3bb73]/15 px-2 py-1 text-[#e5e4e2]/60 hover:border-[#d3bb73]/30"
          >
            {filters.sortDir === 'desc' ? 'Malejąco' : 'Rosnąco'}
          </button>
        </div>
      </div>
    </div>
  );
}
