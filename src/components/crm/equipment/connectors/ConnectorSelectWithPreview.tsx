import { useMemo, useState } from 'react';
import Image from 'next/image';
import Popover from '@/components/UI/Tooltip';
import { usePortalDropdown } from '@/hooks/usePortalDropdown';
import { PortalDropdownMenu } from '@/components/UI/PortalDropdownMenu/PortalDropdownMenu';
import { ConnectorType } from '@/store/slices/equipmentSlice';

export function ConnectorSelectWithPreview({
  label,
  value,
  onChange,
  connectorTypes,
  placeholder = 'Wybierz wtyk',
  returnValue = 'id',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  connectorTypes: ConnectorType[];
  placeholder?: string;
  returnValue?: 'id' | 'name';
}) {
  const [query, setQuery] = useState('');
  const dropdown = usePortalDropdown({
    width: 'trigger',
    align: 'left',
    offsetY: 8,
  });

  const selected = useMemo(
    () => connectorTypes.find((c) => c.id === value || c.name === value) || null,
    [connectorTypes, value],
  );

  const handleSelect = (connector: ConnectorType | null) => {
    onChange(connector ? (returnValue === 'name' ? connector.name : connector.id) : '');
    setQuery('');
    dropdown.close();
  };

  const filteredConnectors = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return connectorTypes;

    return connectorTypes.filter((connector) => {
      const haystack = [connector.name, connector.description, connector.common_uses]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [connectorTypes, query]);

  return (
    <div>
      <label className="mb-2 block text-sm text-[#e5e4e2]/60">{label}</label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={(e) => {
            setQuery('');
            dropdown.toggle('connector-select', e);
          }}
          className="flex min-h-[42px] flex-1 items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-left text-[#e5e4e2]"
        >
          <span className={selected ? '' : 'text-[#e5e4e2]/40'}>
            {selected?.name || placeholder}
          </span>
          <span className="text-xs text-[#e5e4e2]/40">▼</span>
        </button>

        {selected?.thumbnail_url && (
          <Popover
            trigger={
              <Image
                src={selected.thumbnail_url}
                alt={selected.name}
                width={48}
                height={48}
                className="h-12 w-12 cursor-pointer rounded-lg border border-[#d3bb73]/20 object-cover"
              />
            }
            content={
              <Image
                src={selected.thumbnail_url}
                alt={selected.name ?? 'Wtyk'}
                width={300}
                height={300}
                className="h-auto max-h-[300px] w-[300px] rounded-lg object-contain"
              />
            }
            openOn="hover"
          />
        )}
      </div>

      <PortalDropdownMenu
        open={dropdown.isOpen}
        position={dropdown.position}
        className="max-h-80 overflow-y-auto"
        content={
          <div className="py-1">
            <div className="sticky top-0 z-10 border-b border-[#d3bb73]/10 bg-[#1c1f33] p-2">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder="Szukaj wtyku..."
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/40"
              />
            </div>

            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="flex w-full items-center gap-3 border-b border-[#d3bb73]/10 px-4 py-3 text-left text-sm text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10"
            >
              <div className="h-10 w-10 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]" />
              {placeholder}
            </button>

            {filteredConnectors.length > 0 ? (
              filteredConnectors.map((connector) => (
                <button
                  key={connector.id}
                  type="button"
                  onClick={() => handleSelect(connector)}
                  className="flex w-full items-center gap-3 border-b border-[#d3bb73]/10 px-4 py-3 text-left last:border-b-0 hover:bg-[#d3bb73]/10"
                >
                  {connector.thumbnail_url ? (
                    <Image
                      src={connector.thumbnail_url}
                      alt={connector.name}
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] text-xs text-[#e5e4e2]/30">
                      —
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[#e5e4e2]">
                      {connector.name}
                    </div>
                    {connector.common_uses && (
                      <div className="mt-0.5 line-clamp-1 text-xs text-[#e5e4e2]/45">
                        {connector.common_uses}
                      </div>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-sm text-[#e5e4e2]/40">Brak wyników</div>
            )}
          </div>
        }
      />
    </div>
  );
}
