'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Columns3, RotateCcw } from 'lucide-react';

export type TableDensity = 'compact' | 'standard' | 'comfortable';

export interface TableColumnOption {
  id: string;
  label: string;
  required?: boolean;
}

interface StoredTablePreferences {
  visibleColumns: string[];
  density: TableDensity;
}

export function useStoredTablePreferences(
  storageKey: string,
  columns: TableColumnOption[],
  defaultDensity: TableDensity = 'compact',
) {
  const defaultColumns = columns.map((column) => column.id);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultColumns);
  const [density, setDensity] = useState<TableDensity>(defaultDensity);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredTablePreferences>;
        const allowedIds = new Set(columns.map((column) => column.id));
        const requiredIds = columns.filter((column) => column.required).map((column) => column.id);
        const storedColumns = Array.isArray(parsed.visibleColumns)
          ? parsed.visibleColumns.filter((id) => allowedIds.has(id))
          : defaultColumns;

        setVisibleColumns(Array.from(new Set([...requiredIds, ...storedColumns])));
        if (['compact', 'standard', 'comfortable'].includes(parsed.density || '')) {
          setDensity(parsed.density as TableDensity);
        }
      }
    } catch {
      setVisibleColumns(defaultColumns);
      setDensity(defaultDensity);
    } finally {
      setLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ visibleColumns, density }));
  }, [density, loaded, storageKey, visibleColumns]);

  const toggleColumn = (id: string) => {
    const column = columns.find((item) => item.id === id);
    if (column?.required) return;
    setVisibleColumns((current) =>
      current.includes(id) ? current.filter((columnId) => columnId !== id) : [...current, id],
    );
  };

  const reset = () => {
    setVisibleColumns(defaultColumns);
    setDensity(defaultDensity);
  };

  return {
    density,
    setDensity,
    visibleColumns,
    isColumnVisible: (id: string) => visibleColumns.includes(id),
    toggleColumn,
    reset,
  };
}

export function TablePreferencesControl({
  columns,
  density,
  visibleColumns,
  onToggleColumn,
  onDensityChange,
  onReset,
}: {
  columns: TableColumnOption[];
  density: TableDensity;
  visibleColumns: string[];
  onToggleColumn: (id: string) => void;
  onDensityChange: (density: TableDensity) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const densities: { id: TableDensity; label: string; description: string }[] = [
    { id: 'compact', label: 'S', description: 'Kompaktowa' },
    { id: 'standard', label: 'M', description: 'Standardowa' },
    { id: 'comfortable', label: 'L', description: 'Wygodna' },
  ];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs transition-colors ${
          open
            ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
            : 'border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
        }`}
        title="Kolumny i wielkość tabeli"
      >
        <Columns3 className="h-4 w-4" />
        <span className="hidden sm:inline">Kolumny</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-[#d3bb73]/20 bg-[#171a2a] p-3 shadow-2xl">
          <div className="mb-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/45">
              Wielkość wierszy
            </p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#0f1119] p-1">
              {densities.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onDensityChange(item.id)}
                  title={item.description}
                  className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                    density === item.id
                      ? 'bg-[#d3bb73] text-[#0a0d1a]'
                      : 'text-[#e5e4e2]/55 hover:text-[#e5e4e2]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/45">
            Widoczne kolumny
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {columns.map((column) => {
              const checked = visibleColumns.includes(column.id);
              return (
                <button
                  key={column.id}
                  type="button"
                  onClick={() => onToggleColumn(column.id)}
                  disabled={column.required}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[#e5e4e2]/75 hover:bg-[#d3bb73]/10 disabled:cursor-default disabled:opacity-70"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      checked
                        ? 'border-[#d3bb73] bg-[#d3bb73] text-[#0a0d1a]'
                        : 'border-[#e5e4e2]/25'
                    }`}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="flex-1">{column.label}</span>
                  {column.required && <span className="text-[10px] text-[#e5e4e2]/30">stała</span>}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onReset}
            className="mt-3 flex w-full items-center justify-center gap-2 border-t border-[#d3bb73]/10 pt-3 text-xs text-[#e5e4e2]/45 transition-colors hover:text-[#d3bb73]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Przywróć domyślne
          </button>
        </div>
      )}
    </div>
  );
}

export const tableDensityClasses: Record<TableDensity, string> = {
  compact:
    '[&_th]:!px-1.5 [&_th]:!py-1 [&_th]:!text-[9px] [&_td]:!px-1.5 [&_td]:!py-1 [&_td]:!text-[10px]',
  standard:
    '[&_th]:!px-2.5 [&_th]:!py-2 [&_th]:!text-[10px] [&_td]:!px-2.5 [&_td]:!py-2 [&_td]:!text-xs',
  comfortable:
    '[&_th]:!px-4 [&_th]:!py-3 [&_th]:!text-xs [&_td]:!px-4 [&_td]:!py-3 [&_td]:!text-sm',
};
