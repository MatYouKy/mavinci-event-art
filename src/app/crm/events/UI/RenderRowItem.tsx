'use client';

import React from 'react';
import { ChevronDown, Package, Trash2 } from 'lucide-react';
import Popover from '@/components/UI/Tooltip';

type StatusBadge = { label: string; cls: string };

type Props = {
  row: any;
  editable: boolean;

  expanded: boolean;
  onToggleExpand?: (rowId: string) => void;

  availabilityByKey?: Record<string, any>;
  getKeyForEventRow: (row: any) => string | null;
  getUiLimits: (avail: any) => { maxAdd: number; maxSet: number; reserved: number; total: number };
  getStatusBadge: (status?: string) => StatusBadge;

  // quantity editing
  editingQuantityId: string | null;
  draftQuantity: number;
  setEditingQuantityId: (id: string | null) => void;
  setDraftQuantity: (n: number) => void;
  onUpdateQuantity: (rowId: string, quantity: number, maxSet: number) => void;

  // remove/restore
  onRemove: (row: any) => void;
  onRestore: (row: any) => void;
};

export function EventEquipmentRow({
  row,
  editable,

  expanded,
  onToggleExpand,

  availabilityByKey,
  getKeyForEventRow,
  getUiLimits,
  getStatusBadge,

  editingQuantityId,
  draftQuantity,
  setEditingQuantityId,
  setDraftQuantity,
  onUpdateQuantity,

  onRemove,
  onRestore,
}: Props) {
  const isKit = !!row?.kit;

  const aKey = getKeyForEventRow(row);
  const avail = aKey ? availabilityByKey?.[aKey] : undefined;

  const { maxAdd, maxSet, reserved, total } = getUiLimits(avail);
  const badge = getStatusBadge(row?.status);

  const isAuto = !!row?.auto_added;
  const isRemovedFromOffer = !!row?.removed_from_offer;

  return (
    <div>
      <div
        className={`flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20 ${
          isRemovedFromOffer ? 'opacity-50' : ''
        }`}
      >
        {isKit && (
          <button
            onClick={() => onToggleExpand?.(row.id)}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {isKit ? (
            <span className="text-base">🎁</span>
          ) : row?.equipment?.thumbnail_url ? (

            <Popover
              trigger={
                <img
                src={row.equipment.thumbnail_url}
                alt={row.equipment.name}
                className="h-10 w-10 rounded border border-[#d3bb73]/20 object-cover"
              />
              }
              content={
                <img
                  src={row.equipment.thumbnail_url}
                  alt={row.equipment.name}
                  className="h-auto rounded-lg object-contain cursor-pointer transition-all"
                />
              }
              openOn="hover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
              <Package className="h-5 w-5 text-[#e5e4e2]/30" />
            </div>
          )}

          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-[#e5e4e2]">
                {row?.kit ? row.kit.name : row?.equipment?.name || 'Nieznany'}
              </span>

              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase ${badge.cls}`}>
                {badge.label}
              </span>
            </div>

            {!isKit && row?.equipment && (
              <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                {row.equipment.brand && <span>{row.equipment.brand}</span>}
                {row.equipment.model && (
                  <>
                    {row.equipment.brand && <span>•</span>}
                    <span>{row.equipment.model}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {isRemovedFromOffer && (
          <span className="shrink-0 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] uppercase text-red-300">
            USUNIĘTE Z OFERTY
          </span>
        )}

        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
          {!isKit && row?.equipment?.category && <span className="hidden md:inline">{row.equipment.category.name}</span>}

          {aKey && (
            <div className="hidden flex-col items-end text-xs lg:flex">
              <span className="text-[#d3bb73]">{maxAdd} dostępne do dodania</span>
              <span className="text-[#e5e4e2]/45">
                max: {maxSet} • zarezerw.: {reserved} • magazyn: {total}
              </span>
            </div>
          )}

          {/* ilość */}
          {editable && !isKit ? (
            editingQuantityId === row.id ? (
              <span className="inline-flex items-center gap-2">
                <button
                  className="rounded bg-[#d3bb73] px-2 py-0.5 text-black hover:bg-[#e5c97a]"
                  onClick={() => onUpdateQuantity(row.id, draftQuantity, maxSet)}
                  title="Zapisz"
                >
                  ✓
                </button>

                <button
                  className="rounded border border-[#d3bb73]/30 px-2 py-0.5 text-[#e5e4e2]/70 hover:text-red-400"
                  onClick={() => {
                    setEditingQuantityId(null);
                    setDraftQuantity(row.quantity);
                  }}
                  title="Anuluj"
                >
                  ✕
                </button>

                <input
                  type="number"
                  min={1}
                  max={maxSet || 1}
                  value={draftQuantity}
                  onChange={(e) => setDraftQuantity(Number(e.target.value))}
                  className="w-16 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-0.5 text-sm text-[#e5e4e2]"
                  autoFocus
                />

                <span className="text-[#e5e4e2]/60">szt.</span>
                <span className="text-[#e5e4e2]/40">max {maxSet || 1}</span>
              </span>
            ) : (
              <span
                className="cursor-pointer text-[#e5e4e2] hover:text-[#d3bb73]"
                onClick={() => {
                  setEditingQuantityId(row.id);
                  setDraftQuantity(row.quantity);
                }}
              >
                {row.quantity} <span className="text-[#e5e4e2]/60">szt.</span>
              </span>
            )
          ) : (
            <span className="text-[#e5e4e2]">
              {row.quantity} <span className="text-[#e5e4e2]/60">szt.</span>
            </span>
          )}
        </div>

        {/* akcje */}
        {!isRemovedFromOffer ? (
          <button
            onClick={() => onRemove(row)}
            className="text-red-400/60 transition-colors hover:text-red-400"
            title={isAuto ? 'Usuń z eventu (z oferty)' : 'Usuń z eventu'}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={() => onRestore(row)}
            className="rounded border border-[#d3bb73]/30 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
            title="Przywróć z oferty"
          >
            Przywróć
          </button>
        )}
      </div>

      {isKit && expanded && row?.kit?.items && (
        <div className="ml-9 mt-1 space-y-1">
          {row.kit.items.map((kitItem: any, idx: number) => (
            <div
              key={idx}
              className="flex items-center gap-3 rounded border border-[#d3bb73]/5 bg-[#0f1119]/50 px-4 py-2 text-sm"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[#e5e4e2]/80">{kitItem?.equipment?.name}</span>
                <span className="text-xs text-[#e5e4e2]/45">{kitItem?.equipment?.category?.name}</span>
              </div>

              <span className="font-medium text-[#e5e4e2]/60">
                {Number(kitItem.quantity || 0) * Number(row.quantity || 0)} szt.
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}