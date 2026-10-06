'use client';

import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export type SearchComboboxOption = {
  id: string;
  label: string;
  description?: string | null;
  keywords?: string | null;
};

export default function SearchCombobox({
  value,
  options,
  onChange,
  placeholder = 'Wybierz lub wyszukaj...',
  emptyLabel = 'Brak pasujących wyników',
  disabled = false,
  allowClear = true,
  className = '',
  ariaLabel,
  name,
  error,
  describedBy,
  filterOption,
}: {
  value: string;
  options: SearchComboboxOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
  ariaLabel?: string;
  name?: string;
  error?: boolean;
  describedBy?: string;
  filterOption?: (option: SearchComboboxOption, query: string) => boolean;
}) {
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const selected = options.find((option) => option.id === value);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pl');
    if (!normalized) return options;
    if (filterOption) return options.filter((option) => filterOption(option, query));
    return options.filter((option) =>
      `${option.label} ${option.description || ''} ${option.keywords || ''}`
        .toLocaleLowerCase('pl')
        .includes(normalized),
    );
  }, [options, query, filterOption]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, options]);

  const selectOption = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/30" />
      <input
        name={name}
        aria-invalid={error || false}
        aria-describedby={describedBy}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && filteredOptions[highlightedIndex] ? `${listId}-${highlightedIndex}` : undefined
        }
        style={error ? { borderColor: 'rgba(248,113,113,0.45)' } : undefined}
        role="combobox"
        aria-label={ariaLabel || placeholder}
        aria-expanded={open}
        aria-autocomplete="list"
        disabled={disabled}
        value={open ? query : selected?.label || ''}
        placeholder={placeholder}
        onBlur={(event) => {
          if (!wrapperRef.current?.contains(event.relatedTarget as Node)) {
            setOpen(false);
            setQuery('');
          }
        }}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex((current) =>
              open ? Math.min(current + 1, Math.max(0, filteredOptions.length - 1)) : 0,
            );
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlightedIndex((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter' && open && filteredOptions[highlightedIndex]) {
            event.preventDefault();
            selectOption(filteredOptions[highlightedIndex].id);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setQuery('');
          }
        }}
        className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] py-2.5 pl-9 pr-16 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/60 disabled:opacity-50"
      />
      {allowClear && value ? (
        <button
          type="button"
          aria-label="Wyczyść wybór"
          disabled={disabled}
          onClick={() => selectOption('')}
          className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-1 text-[#e5e4e2]/35 hover:bg-white/5 hover:text-[#e5e4e2]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Pokaż listę"
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setQuery('');
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-[#e5e4e2]/35 hover:bg-white/5 hover:text-[#e5e4e2] disabled:opacity-50"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#111522] p-1 shadow-2xl"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <button
                id={`${listId}-${index}`}
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left ${
                  index === highlightedIndex ? 'bg-[#d3bb73]/10' : 'hover:bg-white/5'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-[#e5e4e2]">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block truncate text-xs text-[#e5e4e2]/35">
                      {option.description}
                    </span>
                  )}
                </span>
                {option.id === value && <Check className="h-4 w-4 shrink-0 text-[#d3bb73]" />}
              </button>
            ))
          ) : (
            <p className="px-3 py-6 text-center text-xs text-[#e5e4e2]/35">{emptyLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}
