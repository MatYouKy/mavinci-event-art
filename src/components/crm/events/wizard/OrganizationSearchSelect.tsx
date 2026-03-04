import { useMemo, useRef, useState, useEffect } from 'react';

export function OrganizationSearchSelect({
  organizations,
  value,
  onChange,
}: {
  organizations: { id: string; name: string; alias?: string | null }[];
  value: string;
  onChange: (orgId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedOrg = useMemo(
    () => (value ? organizations.find((o) => o.id === value) : null),
    [value, organizations],
  );

  // jeśli z zewnątrz zmieni się value (np. wczytanie edycji) - pokaż nazwę w inpucie
  useEffect(() => {
    if (selectedOrg) setQuery(selectedOrg.alias || selectedOrg.name);
    if (!selectedOrg && value === '') setQuery('');
  }, [selectedOrg, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return organizations;

    return organizations.filter((o) => {
      const label = `${o.alias || ''} ${o.name || ''}`.toLowerCase();
      return label.includes(q);
    });
  }, [organizations, query]);

  // klik poza listą zamyka
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const pick = (orgId: string) => {
    const org = organizations.find((o) => o.id === orgId);
    onChange(orgId);
    setQuery(org ? org.alias || org.name : '');
    setOpen(false);
    // opcjonalnie: zostaw focus na inpucie
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
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Wybierz organizację"
        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
      />

      {/* Lista podpowiedzi */}
      {open && (
        <div className="absolute z-50 mt-2 max-h-72 w-full overflow-auto rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] shadow-lg">
          {/* nagłówek akcji */}
          <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-3 py-2">
            <span className="text-xs text-gray-400">
              {filtered.length ? `Wyniki: ${filtered.length}` : 'Brak wyników'}
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
              {filtered.map((org) => {
                const label = org.alias || org.name;
                const isSelected = org.id === value;

                return (
                  <li key={org.id}>
                    <button
                      type="button"
                      onClick={() => pick(org.id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors
                        ${isSelected ? 'bg-[#d3bb73]/10 text-[#d3bb73]' : 'text-[#e5e4e2] hover:bg-white/5'}
                      `}
                    >
                      <span className="truncate">{label}</span>
                      {isSelected && <span className="ml-3 text-xs">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-3 py-3 text-sm text-gray-400">Brak pasujących organizacji</div>
          )}
        </div>
      )}
    </div>
  );
}