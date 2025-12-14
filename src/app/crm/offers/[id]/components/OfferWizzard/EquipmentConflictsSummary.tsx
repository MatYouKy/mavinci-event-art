'use client';

import React from 'react';
import { AlertTriangle, Check } from 'lucide-react';

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

type SelectedAlt = Record<string, { item_id: string; qty: number }>;

interface EquipmentConflictsSummaryProps {
  conflicts: EquipmentConflictRow[];
  selectedAlt: SelectedAlt;
  checkingConflicts?: boolean;
  className?: string;
}

export default function EquipmentConflictsSummary({
  conflicts,
  selectedAlt,
  checkingConflicts = false,
  className = '',
}: EquipmentConflictsSummaryProps) {
  const isResolved = (c: EquipmentConflictRow) => {
    const key = `${c.item_type}|${c.item_id}`;
    const picked = selectedAlt[key];
    if (!picked) return false;
    return (picked.qty || 0) >= (c.shortage_qty || 0);
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
            {unresolved.map((c) => (
              <div
                key={`${c.item_type}|${c.item_id}`}
                className="text-sm text-[#e5e4e2]/80"
              >
                <b className="text-[#e5e4e2]">{c.item_name}</b> — brakuje{' '}
                <b className="text-red-300">{c.shortage_qty}</b> szt.
                <span className="text-xs text-[#e5e4e2]/50">
                  {' '}
                  (wymagane: {c.required_qty}, dostępne: {c.available_qty}, zarezerw.:{' '}
                  {c.reserved_qty}, magazyn: {c.total_qty})
                </span>
              </div>
            ))}
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
    </div>
  );
}