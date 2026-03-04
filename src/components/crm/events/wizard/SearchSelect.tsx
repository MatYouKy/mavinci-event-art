'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type BaseItem = {
  id: string;
};

type SearchSelectProps<T extends BaseItem> = {
  items: T[];
  value: string;
  onChange: (id: string) => void;

  label?: string;
  placeholder?: string;
  emptyText?: string;

  getLabel: (item: T) => string;
  getSearchText?: (item: T) => string; // jeśli chcesz szukać po większej ilości pól

  className?: string; // input
  dropdownClassName?: string;
};

export function SearchSelect<T extends BaseItem>({
  items,
  value,
  onChange,
  label,
  placeholder = 'Wybierz…',
  emptyText = 'Brak wyników',
  getLabel,
  getSearchText,
  className,
  dropdownClassName,
}: SearchSelectProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => (value ? items.find((i) => i.id === value) : null),
    [value, items],
  );

  // synchronizuj input z wybraną wartością
  useEffect(() => {
    if (selected) setQuery(getLabel(selected));
    if (!selected && value === '') setQuery('');
  }, [selected, value, getLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    return items.filter((item) => {
      const base = (getSearchText ? getSearchText(item) : getLabel(item)) || '';
      return base.toLowerCase().includes(q);
    });
  }, [items, query, getLabel, getSearchText]);

  // klik poza -> zamknij
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const pick = (id: string) => {
    const item = items.find((i) => i.id === id);
    onChange(id);
    setQuery(item ? getLabel(item) : '');
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const clear = () => {
    onChange('');
    setQuery('');
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">{label}</label>}

      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={
          className ??
          'w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none'
        }
      />

      {open && (
        <div
          className={
            dropdownClassName ??
            'absolute z-50 mt-2 max-h-72 w-full overflow-auto rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] shadow-lg'
          }
        >
          <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-3 py-2">
            <span className="text-xs text-gray-400">
              {filtered.length ? `Wyniki: ${filtered.length}` : emptyText}
            </span>
            {value && (
              <button
                type="button"
                onClick={clear}
                className="text-xs text-[#d3bb73] hover:opacity-90"
              >
                Wyczyść wybór
              </button>
            )}
          </div>

          {filtered.length ? (
            <ul className="py-1">
              {filtered.map((item) => {
                const isSelected = item.id === value;
                const labelText = getLabel(item);

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => pick(item.id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors
                        ${isSelected ? 'bg-[#d3bb73]/10 text-[#d3bb73]' : 'text-[#e5e4e2] hover:bg-white/5'}
                      `}
                    >
                      <span className="truncate">{labelText}</span>
                      {isSelected && <span className="ml-3 text-xs">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-3 py-3 text-sm text-gray-400">{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}