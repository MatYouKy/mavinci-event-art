'use client';

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

// Filter only the board's already-authorized dataset; never alter the source order.
export function useTaskSearch<T extends { title: string }>(tasks: T[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredTasks = useMemo(
    () => normalizedQuery ? tasks.filter(task => task.title.toLowerCase().includes(normalizedQuery)) : tasks,
    [tasks, normalizedQuery],
  );
  return { searchQuery, setSearchQuery, filteredTasks };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
}

export default function TaskSearchInput({ value, onChange, resultCount, totalCount }: Props) {
  return <div className="mb-3 shrink-0 px-2">
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/45" />
      <input
        type="search"
        aria-label="Szukaj zadania po tytule"
        placeholder="Szukaj zadania po tytule…"
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onChange(''); } }}
        className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-10 pr-10 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/45 focus:bg-white/[0.08] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]/20 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && <button type="button" aria-label="Wyczyść wyszukiwanie zadań" onClick={() => onChange('')} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#e5e4e2]">
        <X aria-hidden="true" className="h-4 w-4" />
      </button>}
    </div>
    <p role="status" aria-live="polite" className="mt-1 text-xs text-[#e5e4e2]/55">
      {value.trim() ? (resultCount ? `Wyniki: ${resultCount} z ${totalCount} zadań we wszystkich kolumnach` : 'Nie znaleziono zadań pasujących do wpisanego tytułu.') : ''}
    </p>
  </div>;
}
