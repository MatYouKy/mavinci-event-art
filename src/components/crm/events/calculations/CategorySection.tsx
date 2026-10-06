import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Check,
  Package,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { CATEGORY_META } from './calculations.constants';
import { CalcItem, Category } from './EventCalculationsTab';
import { WarehouseEquipment } from './calculations.types';
import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { fmt } from '../helpers/calculations/calculations.helper';
import { rowNet, rowGross } from '../helpers/calculations/calculations.helper';
import { EquipmentNameCell } from './EquipmentNameCell';
import ResponsiveActionBar from '../../ResponsiveActionBar';
import NextImage from 'next/image';

function ItemThumbnail({ item }: { item: CalcItem }) {
  const [showPopover, setShowPopover] = useState(false);
  const isWarehouse = item.source === 'warehouse' && item.power_source_ref;
  const exceeded =
    isWarehouse && item.stock_quantity != null && item.quantity > item.stock_quantity;

  if (!isWarehouse) return null;

  return (
    <div
      className="relative flex-shrink-0"
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      <div className="relative">
        {item.thumbnail_url ? (
          <NextImage
            src={item.thumbnail_url}
            alt={item.name}
            width={32}
            height={32}
            className={`h-8 w-8 rounded object-cover ${exceeded ? 'ring-2 ring-orange-400' : ''}`}
          />
        ) : (
          <div
            className={`flex h-8 w-8 items-center justify-center rounded border bg-[#0a0d1a] ${
              exceeded ? 'border-orange-400' : 'border-[#d3bb73]/20'
            }`}
          >
            <Package className="h-3.5 w-3.5 text-[#e5e4e2]/30" />
          </div>
        )}
        {exceeded && (
          <div className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-orange-500">
            <AlertTriangle className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </div>

      {showPopover && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-56 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-3 shadow-xl">
          {item.thumbnail_url && (
            <NextImage
              src={item.thumbnail_url}
              alt={item.name}
              className="mb-2 h-24 w-full rounded-md object-cover"
              width={24}
              height={24}
            />
          )}
          <div className="text-sm font-medium text-[#e5e4e2]">{item.name}</div>
          {item.stock_quantity != null && (
            <div className="mt-1 text-xs text-[#e5e4e2]/50">
              Stan magazynowy:{' '}
              <span className={exceeded ? 'font-medium text-orange-400' : 'text-emerald-400'}>
                {item.stock_quantity}
              </span>
            </div>
          )}
          {exceeded && (
            <div className="mt-1 flex items-center gap-1 text-xs text-orange-400">
              <AlertTriangle className="h-3 w-3" />
              Przekroczono stan ({item.quantity} / {item.stock_quantity})
            </div>
          )}
          {item.power_watts != null && item.power_watts > 0 && (
            <div className="mt-1 text-xs text-amber-400/70">Pobor: {item.power_watts}W</div>
          )}
        </div>
      )}
    </div>
  );
}

export function CategorySection({
  category,
  items,
  allItems,
  onAdd,
  onUpdate,
  onRemove,
  onToggleEdit,
  onMove,
  onReorder,
  reorderingDisabled,
}: {
  category: Category;
  items: CalcItem[];
  allItems: CalcItem[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<CalcItem>) => void;
  onRemove: (index: number) => void;
  onToggleEdit: (index: number, editing: boolean) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onReorder: (category: Category, from: number, to: number) => void;
  reorderingDisabled?: boolean;
}) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const lockedCells = useRef<
    Array<{ cell: HTMLElement; width: string; minWidth: string; pixels: number }>
  >([]);
  const unlockColumns = () => {
    lockedCells.current.forEach(({ cell, width, minWidth }) => {
      cell.style.width = width;
      cell.style.minWidth = minWidth;
    });
    lockedCells.current = [];
  };
  const lockColumns = () => {
    // Read all dimensions before writing styles, avoiding repeated table layout work.
    lockedCells.current = Array.from(
      tableRef.current?.querySelectorAll<HTMLElement>('th, td') ?? [],
    ).map((cell) => ({
      cell,
      width: cell.style.width,
      minWidth: cell.style.minWidth,
      pixels: cell.getBoundingClientRect().width,
    }));
    lockedCells.current.forEach((entry) => {
      const pixels = entry.pixels;
      entry.cell.style.width = `${pixels}px`;
      entry.cell.style.minWidth = `${pixels}px`;
    });
  };
  const Icon = CATEGORY_META[category].icon;
  const indexOfAll = (item: CalcItem) => allItems.indexOf(item);

  const [warehouseList, setWarehouseList] = useState<WarehouseEquipment[]>([]);
  const [warehouseLoaded, setWarehouseLoaded] = useState(false);

  const ensureWarehouseLoaded = useCallback(async () => {
    if (warehouseLoaded) return;
    const { data } = await supabase
      .from('equipment_items')
      .select('id, name, brand, model, rental_price_per_day, power_specs')
      .order('name');
    setWarehouseList((data as WarehouseEquipment[]) ?? []);
    setWarehouseLoaded(true);
  }, [warehouseLoaded]);

  const numberInputClass =
    'w-full min-w-[40px] max-w-[60px] rounded-md border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-1 text-right tabular-nums text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none';

  const priceInputClass =
    'w-full min-w-[80px] max-w-[120px] rounded-md border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-1 text-right tabular-nums text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none';

  const categoryNetTotal = items.reduce((sum, item) => sum + rowNet(item), 0);
  const categoryGrossTotal = items.reduce((sum, item) => sum + rowGross(item), 0);
  const isTransport = category === 'transport';

  return (
    <DragDropContext
      onBeforeDragStart={lockColumns}
      onDragEnd={({ source, destination }) => {
        unlockColumns();
        if (destination && source.index !== destination.index && !reorderingDisabled) {
          onReorder(category, source.index, destination.index);
        }
      }}
      dragHandleUsageInstructions="Naciśnij spację, aby podnieść pozycję. Strzałkami wybierz miejsce, spacją zatwierdź, a Escape anuluj."
    >
      <div className="relative rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#0a0d1a] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
            <Icon className="h-4 w-4 text-[#d3bb73]" />
            {CATEGORY_META[category].label}
            <span className="text-xs text-[#e5e4e2]/50">({items.length})</span>
          </div>
          <button data-crm-action="secondary"
            onClick={onAdd}
            className="flex items-center gap-1 rounded-md border border-[#d3bb73]/30 px-2 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            <Plus className="h-3.5 w-3.5" />
            Dodaj
          </button>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[#e5e4e2]/40">Brak pozycji</div>
        ) : (
          <div className="overflow-x-auto">
            <table ref={tableRef} className="w-full text-sm">
              <thead className="bg-[#0a0d1a]/60 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                <tr>
                  <th className="w-8 px-1 py-2">
                    <span className="sr-only">Kolejność</span>
                  </th>
                  <th className="px-3 py-2">Nazwa</th>
                  <th className="px-3 py-2">Opis</th>
                  <th className="min-w-[90px] px-3 py-2">Ilość</th>
                  <th className="min-w-[80px] px-3 py-2">Jedn.</th>
                  <th className="min-w-[80px] px-3 py-2">{isTransport ? 'Km' : 'Dni'}</th>

                  <th className="min-w-[120px] px-3 py-2">
                    {isTransport ? 'Stawka' : 'Cena jedn.'}
                  </th>
                  <th className="min-w-[80px] px-3 py-2">VAT %</th>
                  <th className="w-28 px-3 py-2 text-right">Netto</th>
                  <th className="w-28 px-3 py-2 text-right">Brutto</th>
                  <th className="w-10 px-3 py-2"></th>
                </tr>
              </thead>
              <Droppable droppableId={`calculation-${category}`}>
                {(dropProvided) => (
                  <tbody
                    ref={dropProvided.innerRef}
                    {...dropProvided.droppableProps}
                    className="divide-y divide-[#d3bb73]/10"
                  >
                    {items.map((it, categoryIndex) => {
                      const idx = indexOfAll(it);
                      return (
                        <Draggable
                          key={it.id ?? `${category}-${idx}`}
                          draggableId={it.id ?? `${category}-${idx}`}
                          index={categoryIndex}
                          disableInteractiveElementBlocking
                          isDragDisabled={reorderingDisabled || !it.id}
                        >
                          {(dragProvided, snapshot) => {
                            const isEditing = !!it.editing;
                            const dragHandle = (
                              <td className="w-8 px-1 py-2">
                                <button
                                  type="button"
                                  {...dragProvided.dragHandleProps}
                                  disabled={reorderingDisabled || !it.id}
                                  title="Przeciągnij, aby zmienić kolejność"
                                  aria-label={`Przeciągnij ${it.name || 'pozycję'}`}
                                  className="cursor-grab touch-none rounded p-1 text-[#e5e4e2]/45 hover:bg-white/5 hover:text-[#d3bb73] active:cursor-grabbing disabled:opacity-25"
                                >
                                  <GripVertical className="h-4 w-4" />
                                </button>
                              </td>
                            );
                            const orderControls = (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={reorderingDisabled || categoryIndex === 0}
                                  onClick={() => onMove(idx, -1)}
                                  title="Przesuń w górę"
                                  aria-label={`Przesuń ${it.name || 'pozycję'} w górę`}
                                  className="rounded-md p-1 text-[#d3bb73] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-25"
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    reorderingDisabled || categoryIndex === items.length - 1
                                  }
                                  onClick={() => onMove(idx, 1)}
                                  title="Przesuń w dół"
                                  aria-label={`Przesuń ${it.name || 'pozycję'} w dół`}
                                  className="rounded-md p-1 text-[#d3bb73] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-25"
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </button>
                              </div>
                            );
                            if (!isEditing) {
                              return (
                                <tr
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  style={{
                                    ...dragProvided.draggableProps.style,
                                    ...(snapshot.isDragging
                                      ? {
                                          background: 'var(--brand-burgundy-800)',
                                          boxShadow: '0 8px 24px #0004',
                                        }
                                      : {}),
                                  }}
                                  className="cursor-pointer hover:bg-[#0a0d1a]/40"
                                  onDoubleClick={() => onToggleEdit(idx, true)}
                                >
                                  {dragHandle}
                                  <td className="px-3 py-2 text-[#e5e4e2]">
                                    <div className="flex items-center gap-2">
                                      <ItemThumbnail item={it} />
                                      <span className="truncate">
                                        {it.name || <span className="text-[#e5e4e2]/40">—</span>}
                                      </span>
                                    </div>
                                    {it.source === 'vehicle' && it.source_label && <p className="mt-1 text-xs text-white/40">Wewnętrznie: {it.source_label}</p>}
                                  </td>
                                  <td className="px-3 py-2 text-[#e5e4e2]/70">
                                    {it.description || <span className="text-[#e5e4e2]/30">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-[#e5e4e2]/80">{it.quantity}</td>
                                  <td className="px-3 py-2 text-[#e5e4e2]/80">{it.unit}</td>
                                  <td className="px-3 py-2 text-[#e5e4e2]/80">
                                    {isTransport ? `${it.days} km` : it.days}
                                  </td>
                                  <td className="px-3 py-2 text-[#e5e4e2]/80">
                                    {isTransport ? fmt(it.unit_price) : fmt(it.unit_price)}
                                  </td>
                                  <td className="px-3 py-2 text-[#e5e4e2]/80">{it.vat_rate}%</td>
                                  <td className="px-3 py-2 text-right text-[#e5e4e2]">
                                    {fmt(rowNet(it))}
                                  </td>
                                  <td className="px-3 py-2 text-right text-[#d3bb73]">
                                    {fmt(rowGross(it))}
                                  </td>
                                  <td
                                    className="relative z-20 px-3 py-2 text-right"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center justify-end gap-1">
                                      {orderControls}
                                      <ResponsiveActionBar
                                        disabledBackground
                                        mobileBreakpoint={2000}
                                        actions={[
                                          {
                                            label: 'Edytuj',
                                            onClick: () => onToggleEdit(idx, true),
                                            icon: <Pencil className="h-4 w-4" />,
                                            variant: 'default',
                                          },
                                          {
                                            label: 'Usuń',
                                            onClick: () => onRemove(idx),
                                            icon: <Trash2 className="h-4 w-4" />,
                                            variant: 'danger',
                                          },
                                        ]}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              );
                            }
                            return (
                              <tr
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                style={{
                                  ...dragProvided.draggableProps.style,
                                  ...(snapshot.isDragging
                                    ? {
                                        background: 'var(--brand-burgundy-800)',
                                        boxShadow: '0 8px 24px #0004',
                                      }
                                    : {}),
                                }}
                                className="bg-[#0a0d1a]/30"
                              >
                                {dragHandle}
                                <td className="px-3 py-2">
                                  {category === 'equipment' ? (
                                    <EquipmentNameCell
                                      item={it}
                                      warehouseList={warehouseList}
                                      onFocusLoad={ensureWarehouseLoaded}
                                      onUpdate={(patch) => onUpdate(idx, patch)}
                                    />
                                  ) : (
                                    <input
                                      value={it.name}
                                      onChange={(e) => onUpdate(idx, { name: e.target.value })}
                                      placeholder="Nazwa pozycji"
                                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:bg-[#0a0d1a] focus:outline-none"
                                    />
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={it.description}
                                    onChange={(e) => onUpdate(idx, { description: e.target.value })}
                                    placeholder="Opis"
                                    className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2]/80 focus:border-[#d3bb73]/40 focus:bg-[#0a0d1a] focus:outline-none"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={it.quantity}
                                    onChange={(e) =>
                                      onUpdate(idx, { quantity: Number(e.target.value) })
                                    }
                                    className={numberInputClass}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={it.unit}
                                    onChange={(e) => onUpdate(idx, { unit: e.target.value })}
                                    className={numberInputClass}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    step="0.5"
                                    value={it.days}
                                    onChange={(e) =>
                                      onUpdate(idx, { days: Number(e.target.value) })
                                    }
                                    className={numberInputClass}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={it.unit_price}
                                    onChange={(e) =>
                                      onUpdate(idx, { unit_price: Number(e.target.value) })
                                    }
                                    className={priceInputClass}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    step="1"
                                    value={it.vat_rate}
                                    onChange={(e) =>
                                      onUpdate(idx, { vat_rate: Number(e.target.value) })
                                    }
                                    className={numberInputClass}
                                  />
                                </td>
                                <td className="px-3 py-2 text-right text-[#e5e4e2]">
                                  {fmt(rowNet(it))}
                                </td>
                                <td className="px-3 py-2 text-right text-[#d3bb73]">
                                  {fmt(rowGross(it))}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex justify-end gap-1">
                                    {orderControls}
                                    <button
                                      onClick={() => onToggleEdit(idx, false)}
                                      className="rounded-md p-1 text-emerald-400 hover:bg-emerald-500/10"
                                      title="Zatwierdź"
                                    >
                                      <Check className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => onRemove(idx)}
                                      className="rounded-md p-1 text-red-400 hover:bg-red-500/10"
                                      title="Usuń"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }}
                        </Draggable>
                      );
                    })}
                    {dropProvided.placeholder}
                  </tbody>
                )}
              </Droppable>
              <tfoot>
                <tr className="border-t border-[#d3bb73]/20 bg-[#0a0d1a]/80">
                  <td
                    colSpan={8}
                    className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[#e5e4e2]/60"
                  >
                    Suma częściowa
                  </td>

                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-[#e5e4e2]">
                    {fmt(categoryNetTotal)}
                  </td>

                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-[#d3bb73]">
                    {fmt(categoryGrossTotal)}
                  </td>

                  <td className="px-3 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </DragDropContext>
  );
}
