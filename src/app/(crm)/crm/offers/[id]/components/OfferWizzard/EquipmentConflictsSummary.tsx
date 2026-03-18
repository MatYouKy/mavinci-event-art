'use client';

import React, { useState } from 'react';
import { AlertTriangle, Check, MoreVertical } from 'lucide-react';
import SelectRentalEquipmentModal from '@/components/crm/SelectRentalEquipmentModal';

type EquipmentConflictRow = {
  item_type: 'item' | 'kit';
  item_id: string;
  item_name: string;
  required_qty: number;
  total_qty: number;
  reserved_qty: number;
  available_qty: number;
  shortage_qty: number;
  conflict_until: string | null;
  conflicts: any[];
  warehouse_category_id?: string;
  alternatives: Array<{
    item_type: 'item' | 'kit';
    item_id: string;
    item_name: string;
    total_qty: number;
    reserved_qty: number;
    available_qty: number;
    warehouse_category_id?: string;
  }>;
};

type SelectedAlt = Record<string, { item_id: string; qty: number; is_rental?: boolean; rental_equipment_id?: string; subcontractor_id?: string }>;

interface EquipmentConflictsSummaryProps {
  conflicts: EquipmentConflictRow[];
  selectedAlt: SelectedAlt;
  checkingConflicts?: boolean;
  className?: string;
  onRentalSelect?: (
    conflictKey: string,
    rentalEquipmentId: string,
    subcontractorId: string,
    quantity: number,
  ) => void;
}

export default function EquipmentConflictsSummary({
  conflicts,
  selectedAlt,
  checkingConflicts = false,
  className = '',
  onRentalSelect,
}: EquipmentConflictsSummaryProps) {
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [rentalModalOpen, setRentalModalOpen] = useState(false);
  const [currentConflict, setCurrentConflict] = useState<EquipmentConflictRow | null>(null);

  const isResolved = (c: EquipmentConflictRow) => {
    const key = `${c.item_type}|${c.item_id}`;
    const picked = selectedAlt[key];
    if (!picked) return false;
    return (picked.qty || 0) >= (c.shortage_qty || 0);
  };

  const handleRentalClick = (conflict: EquipmentConflictRow) => {
    setCurrentConflict(conflict);
    setRentalModalOpen(true);
    setOpenMenuKey(null);
  };

  const handleRentalSelect = (
    subcontractorId: string,
    equipmentId: string,
    equipmentName: string,
    subcontractorName: string,
  ) => {
    if (currentConflict && onRentalSelect) {
      const key = `${currentConflict.item_type}|${currentConflict.item_id}`;
      onRentalSelect(key, equipmentId, subcontractorId, currentConflict.shortage_qty);
    }
    setRentalModalOpen(false);
    setCurrentConflict(null);
  };

  const unresolved = (conflicts || []).filter((c) => !isResolved(c));
  const resolved = (conflicts || []).filter((c) => isResolved(c));

  if (unresolved.length === 0 && resolved.length === 0) return null;

  return (
    <div className={className}>
      {/* ❌ Nierozwiązane konflikty */}
      {unresolved.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <div className="flex items-center gap-2 text-red-300">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">
              Braki sprzętu w terminie ({unresolved.length})
            </span>
            {checkingConflicts && <span className="text-xs opacity-70">Sprawdzam...</span>}
          </div>

          <div className="mt-3 space-y-2">
            {unresolved.map((c) => {
              const conflictKey = `${c.item_type}|${c.item_id}`;
              return (
                <div
                  key={conflictKey}
                  className="flex items-center justify-between rounded border border-red-500/10 bg-red-500/5 p-2 text-sm text-[#e5e4e2]/80"
                >
                  <div className="flex-1">
                    <b className="text-[#e5e4e2]">{c.item_name}</b> — brakuje{' '}
                    <b className="text-red-300">{c.shortage_qty}</b> szt.
                    <span className="text-xs text-[#e5e4e2]/50">
                      {' '}
                      (wymagane: {c.required_qty}, dostępne: {c.available_qty}, zarezerw.:{' '}
                      {c.reserved_qty}, magazyn: {c.total_qty})
                    </span>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setOpenMenuKey(openMenuKey === conflictKey ? null : conflictKey)
                      }
                      className="rounded p-1 hover:bg-[#1c1f33]"
                    >
                      <MoreVertical className="h-4 w-4 text-[#e5e4e2]/60" />
                    </button>
                    {openMenuKey === conflictKey && (
                      <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-1 shadow-xl">
                        <button
                          onClick={() => handleRentalClick(c)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:bg-[#252837]"
                        >
                          Wybierz sprzęt z rentalu
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ✅ Rozwiązane przez zamianę */}
      {resolved.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-4">
          <div className="flex items-center gap-2 text-[#d3bb73]">
            <Check className="h-4 w-4" />
            <span className="text-sm font-medium">
              Zamiany zastosowane ({resolved.length})
            </span>
          </div>

          <div className="mt-3 space-y-2 text-sm text-[#e5e4e2]/80">
            {resolved.map((c) => {
              const key = `${c.item_type}|${c.item_id}`;
              const pick = selectedAlt[key];
              const alt = c.alternatives?.find((x) => x.item_id === pick?.item_id);

              return (
                <div key={key}>
                  Zastosowano zamianę: <b>{c.item_name}</b> →{' '}
                  <b>{alt?.item_name ?? 'alternatywa'}</b> • ilość: <b>{pick?.qty}</b>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal wyboru rental equipment */}
      {currentConflict && (
        <SelectRentalEquipmentModal
          isOpen={rentalModalOpen}
          onClose={() => {
            setRentalModalOpen(false);
            setCurrentConflict(null);
          }}
          onSelect={handleRentalSelect}
          currentEquipmentName={currentConflict.item_name}
          warehouseCategoryId={currentConflict.warehouse_category_id || null}
        />
      )}
    </div>
  );
}