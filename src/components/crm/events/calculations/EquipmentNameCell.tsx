import { PortalDropdownMenu } from '@/components/UI/PortalDropdownMenu/PortalDropdownMenu';
import { CalcItem } from './EventCalculationsTab';
import { WarehouseEquipment } from './calculations.types';
import { useMemo, useState, useEffect, useRef } from 'react';
import { usePortalDropdown } from '@/hooks/usePortalDropdown';

export function EquipmentNameCell({
  item,
  warehouseList,
  onFocusLoad,
  onUpdate,
}: {
  item: CalcItem;
  warehouseList: WarehouseEquipment[];
  onFocusLoad: () => void;
  onUpdate: (patch: Partial<CalcItem>) => void;
}) {
  const fromWarehouse = item.source === 'warehouse';
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const equipmentMenu = usePortalDropdown({
    align: 'left',
    width: 'trigger',
    offsetY: 4,
    closeOnScroll: false,
  });

  useEffect(() => {
    if (fromWarehouse) onFocusLoad();
  }, [fromWarehouse, onFocusLoad]);

  const toggleWarehouse = (checked: boolean) => {
    if (checked) {
      onFocusLoad();
      onUpdate({ source: 'warehouse', source_ref: null, name: '' });
    } else {
      onUpdate({ source: 'manual', source_ref: null });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return warehouseList.slice(0, 30);
    return warehouseList
      .filter((e) => {
        const full = `${e.name} ${e.brand ?? ''} ${e.model ?? ''}`.toLowerCase();
        return full.includes(q);
      })
      .slice(0, 30);
  }, [warehouseList, search]);

  const selectEquipment = (eq: WarehouseEquipment) => {
    const full = [eq.brand, eq.model, eq.name].filter(Boolean).join(' ') || eq.name;
    const patch: Partial<CalcItem> = {
      source: 'warehouse',
      source_ref: eq.id,
      name: full,
    };
    const rental = Number(eq.rental_price_per_day ?? 0);
    if (eq.rental_price_per_day != null && rental > 0) {
      patch.unit_price = rental;
    }
    onUpdate(patch);
    setSearch('');
    setOpen(false);
  };

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/60">
        <input
          type="checkbox"
          checked={fromWarehouse}
          onChange={(e) => toggleWarehouse(e.target.checked)}
          className="h-3 w-3 rounded border-[#d3bb73]/40 bg-[#0a0d1a] text-[#d3bb73]"
        />
        z magazynu
      </label>

      {fromWarehouse ? (
        <div className="relative">
          {item.source_ref && item.name ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-[#d3bb73]/30 bg-[#0a0d1a] px-2 py-1">
              <span className="truncate text-[#e5e4e2]">{item.name}</span>
              <button
                type="button"
                onClick={() => onUpdate({ source_ref: null, name: '' })}
                className="text-xs text-[#d3bb73] hover:underline"
              >
                Zmień
              </button>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                value={search}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(true);
                  equipmentMenu.open('equipment-search', e.currentTarget);
                }}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOpen(true);
                  equipmentMenu.open('equipment-search', e.currentTarget);
                }}
                onFocus={(e) => {
                  setOpen(true);
                  equipmentMenu.open('equipment-search', e.currentTarget);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setOpen(false);
                    equipmentMenu.close();
                  }, 150);
                }}
                placeholder="Szukaj sprzętu w magazynie..."
                className="w-full rounded-md border border-[#d3bb73]/30 bg-[#0a0d1a] px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
              {open && filtered.length > 0 && (
                <PortalDropdownMenu
                  open={open && filtered.length > 0}
                  position={equipmentMenu.position}
                  className="max-h-60 overflow-y-auto"
                  content={
                    <>
                      {filtered.map((eq) => (
                        <button
                          key={eq.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectEquipment(eq);
                            setOpen(false);
                            equipmentMenu.close();
                          }}
                          className="block w-full px-3 py-1.5 text-left text-sm text-[#e5e4e2] hover:bg-[#0a0d1a]"
                        >
                          <div className="font-medium">
                            {[eq.brand, eq.model].filter(Boolean).join(' ') || eq.name}
                          </div>

                          {(eq.brand || eq.model) && (
                            <div className="text-xs text-[#e5e4e2]/50">{eq.name}</div>
                          )}
                        </button>
                      ))}
                    </>
                  }
                />
              )}
              {open && search && filtered.length === 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2]/60">
                  Brak wyników
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <input
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Nazwa pozycji"
          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:bg-[#0a0d1a] focus:outline-none"
        />
      )}
    </div>
  );
}