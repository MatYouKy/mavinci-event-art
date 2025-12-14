import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Package, Plus, Trash2 } from 'lucide-react';
import { AddEquipmentModal } from '../Modals/AddEquipmentModal';
import { useEventEquipment } from '../../../hooks';
import { useEvent } from '../../../hooks/useEvent';
import { useSnackbar } from '@/contexts/SnackbarContext';
import type { AvailabilityUI } from '@/app/crm/events/hooks/useEventEquipment';

type SelectedItem = { id: string; quantity: number; notes: string; type: 'item' | 'kit' };
type ItemType = 'item' | 'kit';
type AvailKey = `${ItemType}-${string}`;

const keyOf = (type: ItemType, id: string) => `${type}-${id}` as AvailKey;

const num = (v: any, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function mergeSameSelections(selected: SelectedItem[]) {
  const map = new Map<string, SelectedItem>();
  for (const s of selected) {
    const k = keyOf(s.type, s.id);
    const prev = map.get(k);
    if (!prev) map.set(k, { ...s });
    else map.set(k, { ...prev, quantity: prev.quantity + s.quantity });
  }
  return [...map.values()];
}

function buildExistingMap(equipmentRows: any[]) {
  const map = new Map<string, any>();
  for (const row of equipmentRows || []) {
    const eqId = row?.equipment_id ?? row?.equipment?.id ?? row?.equipment?.equipment_id;
    const kitId = row?.kit_id ?? row?.kit?.id ?? row?.kit?.kit_id;

    if (eqId) map.set(keyOf('item', eqId), row);
    if (kitId) map.set(keyOf('kit', kitId), row);
  }
  return map;
}

function getKeyForEventRow(row: any): AvailKey | null {
  const eqId = row?.equipment_id ?? row?.equipment?.id ?? row?.equipment?.equipment_id;
  if (eqId) return keyOf('item', eqId);

  const kitId = row?.kit_id ?? row?.kit?.id ?? row?.kit?.kit_id;
  if (kitId) return keyOf('kit', kitId);

  return null;
}

function getUiLimits(avail?: AvailabilityUI | null) {
  if (!avail) {
    return {
      used: 0,
      availableInTerm: 0,
      maxAdd: 0,
      maxSet: 0,
      total: 0,
      reserved: 0,
    };
  }

  const used = num((avail as any).used_by_this_event, 0);
  const availableInTerm = num(
    (avail as any).available_in_term,
    num((avail as any).available_quantity, 0),
  );
  const maxAdd = num((avail as any).max_add, Math.max(0, availableInTerm - used));
  const maxSet = num((avail as any).max_set, used + maxAdd);

  return {
    used,
    availableInTerm,
    maxAdd, // ile jeszcze możesz DOŁOŻYĆ
    maxSet, // max ile możesz ustawić w evencie
    total: num((avail as any).total_quantity, 0),
    reserved: num((avail as any).reserved_quantity, 0),
  };
}

function normalizeStatus(s?: string) {
  return String(s || '')
    .toLowerCase()
    .trim();
}

function getStatusBadge(statusRaw?: string) {
  const status = normalizeStatus(statusRaw);

  // ✅ “draft powinien rezerwować” – więc pokazujemy to wyraźnie
  if (status === 'draft') {
    return {
      label: 'DRAFT (rezerwuje)',
      cls: 'bg-[#d3bb73]/15 text-[#d3bb73] border-[#d3bb73]/30',
    };
  }
  if (status === 'reserved') {
    return {
      label: 'ZAREZERWOWANE',
      cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    };
  }
  if (status === 'in_use') {
    return { label: 'W UŻYCIU', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/20' };
  }
  if (status === 'released') {
    return { label: 'ZWOLNIONE', cls: 'bg-[#e5e4e2]/10 text-[#e5e4e2]/60 border-[#e5e4e2]/15' };
  }
  if (status === 'cancelled') {
    return { label: 'ANULOWANE', cls: 'bg-red-500/10 text-red-300 border-red-500/20' };
  }

  // fallback
  return {
    label: statusRaw ? statusRaw : '—',
    cls: 'bg-[#e5e4e2]/10 text-[#e5e4e2]/60 border-[#e5e4e2]/15',
  };
}

export const EventEquipmentTab = () => {
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);

  const [editingQuantityId, setEditingQuantityId] = useState<string | null>(null);
  const [draftQuantity, setDraftQuantity] = useState<number>(1);

  const { showSnackbar } = useSnackbar();
  const { event } = useEvent();

  const {
    equipment,
    availableEquipment,
    availableKits,
    availabilityByKey,
    fetchAvailableEquipment,
    addEquipment,
    updateEquipment,
    removeEquipment,
    refetch,
  } = useEventEquipment(event.id, {
    id: event.id,
    event_date: event.event_date,
    event_end_date: event.event_end_date,
  });

  useEffect(() => {
    if (!event?.id) return;
    fetchAvailableEquipment();
  }, [event?.id, event?.event_date, event?.event_end_date, fetchAvailableEquipment]);

  const handleRemoveEquipment = async (row: any) => {
    const isAuto = !!row?.auto_added;

    // ✅ AUTO: "usuń z eventu" = oznacz jako removed_from_offer + quantity=0
    if (isAuto) {
      if (!confirm('Usunąć tę pozycję z eventu (pochodzi z oferty)?')) return;

      const ok = await updateEquipment(row.id, {
        removed_from_offer: true,
        is_overridden: true,
        quantity: 0,
      });

      if (ok) {
        await refetch();
        await fetchAvailableEquipment();
      }
      return;
    }

    // ✅ MANUAL: normalny delete
    if (!confirm('Czy na pewno chcesz usunąć ten sprzęt z eventu?')) return;

    const ok = await removeEquipment(row.id);
    if (ok) {
      await refetch();
      await fetchAvailableEquipment();
    }
  };

  const handleRestoreAutoRow = async (row: any) => {
    if (!confirm('Przywrócić tę pozycję z oferty do eventu?')) return;

    // wracamy do stanu auto (nieusuniętego)
    // quantity: jeśli masz gdzieś "oryginalną" ilość z oferty – tu ją ustaw.
    // Jeśli nie masz, przyjmij 1 albo zostaw aktualną (ale przy removed było 0).
    const ok = await updateEquipment(row.id, {
      removed_from_offer: false,
      // jeśli chcesz, żeby nadal było "auto" i nie override:
      is_overridden: false,
      quantity: Math.max(1, Number(row.quantity || 1)),
    });

    if (ok) {
      await refetch();
      await fetchAvailableEquipment();
    }
  };

  const handleUpdateQuantity = async (rowId: string, newQty: number, maxSet: number) => {
    const safe = Math.max(1, Math.min(newQty, maxSet || 1));

    if (safe !== newQty) {
      showSnackbar(`Maksymalnie możesz ustawić: ${maxSet} szt.`, 'error');
      return;
    }

    const ok = await updateEquipment(rowId, { quantity: safe });
    if (ok) {
      setEditingQuantityId(null);
      await refetch();
      await fetchAvailableEquipment(); // ✅ po update: prawda z backendu
    }
  };

  const handleAddEquipment = async (selectedItems: SelectedItem[]) => {
    if (!event?.id) return;

    const merged = mergeSameSelections(selectedItems);
    const existingMap = buildExistingMap(equipment);

    const toInsert: SelectedItem[] = [];
    const toUpdate: Array<{ rowId: string; newQty: number }> = [];

    for (const s of merged) {
      const k = keyOf(s.type, s.id);
      const existingRow = existingMap.get(k);

      const avail = (availabilityByKey as Record<string, AvailabilityUI> | undefined)?.[k];
      const { used, maxAdd, maxSet } = getUiLimits(avail);

      const currentQty = existingRow?.quantity ?? used ?? 0;
      const finalQty = currentQty + s.quantity;

      if (maxSet > 0 && finalQty > maxSet) {
        showSnackbar(
          `Brak dostępności: max ${maxSet} szt. (do dodania zostało ${maxAdd}).`,
          'error',
        );
        return;
      }

      if (!existingRow) toInsert.push(s);
      else toUpdate.push({ rowId: existingRow.id, newQty: finalQty });
    }

    if (toInsert.length) {
      const ok = await addEquipment(toInsert);
      if (!ok) return;
    }

    for (const u of toUpdate) {
      await updateEquipment(u.rowId, { quantity: u.newQty });
    }

    if (toUpdate.length) showSnackbar('Pozycje były już na liście — zwiększono ilości.', 'info');

    await refetch();
    await fetchAvailableEquipment();
  };

  const manualRows = useMemo(
    () => (equipment || []).filter((r: any) => !r.auto_added),
    [equipment],
  );
  const autoRows = useMemo(() => (equipment || []).filter((r: any) => r.auto_added), [equipment]);

  const renderRow = (row: any, editable: boolean) => {
    const isExpanded = expandedKits.has(row.id);
    const isKit = !!row.kit;

    const aKey = getKeyForEventRow(row);
    const avail = aKey ? (availabilityByKey as any)?.[aKey] : undefined;

    const { maxAdd, maxSet, reserved, total } = getUiLimits(avail);
    const availableToAdd = maxAdd;

    const badge = getStatusBadge(row?.status);

    const isAuto = !!row.auto_added;
    const isOverridden = !!row.is_overridden;
    const isRemovedFromOffer = !!row.removed_from_offer;

    return (
      <div key={row.id}>
        <div
          className={`flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20 ${
            isRemovedFromOffer ? 'opacity-50' : ''
          }`}
        >
          {isKit && (
            <button
              onClick={() => {
                const next = new Set(expandedKits);
                if (isExpanded) next.delete(row.id);
                else next.add(row.id);
                setExpandedKits(next);
              }}
              className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}

          <div className="flex min-w-0 flex-1 items-center gap-3">
            {isKit ? (
              <span className="text-base">🎁</span>
            ) : row.equipment?.thumbnail_url ? (
              <img
                src={row.equipment.thumbnail_url}
                alt={row.equipment.name}
                className="h-10 w-10 rounded border border-[#d3bb73]/20 object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                <Package className="h-5 w-5 text-[#e5e4e2]/30" />
              </div>
            )}

            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-[#e5e4e2]">
                  {row.kit ? row.kit.name : row.equipment?.name || 'Nieznany'}
                </span>

                {/* ✅ STATUS rezerwacji */}
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>

              {!isKit && row.equipment && (
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
            {!isKit && row.equipment?.category && (
              <span className="hidden md:inline">{row.equipment.category.name}</span>
            )}

            {/* ✅ zawsze z availability */}
            {aKey && (
              <div className="hidden flex-col items-end text-xs lg:flex">
                <span className="text-[#d3bb73]">{availableToAdd} dostępne do dodania</span>
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
                    onClick={() => handleUpdateQuantity(row.id, draftQuantity, maxSet)}
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

          {/* ✅ usuwanie tylko manual (auto ma być synchronizowane przez ofertę) */}
          {/* akcje */}
          {!isRemovedFromOffer ? (
            <button
              onClick={() => handleRemoveEquipment(row)}
              className="text-red-400/60 transition-colors hover:text-red-400"
              title={isAuto ? 'Usuń z eventu (z oferty)' : 'Usuń z eventu'}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => handleRestoreAutoRow(row)}
              className="rounded border border-[#d3bb73]/30 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
              title="Przywróć z oferty"
            >
              Przywróć
            </button>
          )}
        </div>

        {isKit && isExpanded && row.kit?.items && (
          <div className="ml-9 mt-1 space-y-1">
            {row.kit.items.map((kitItem: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center gap-3 rounded border border-[#d3bb73]/5 bg-[#0f1119]/50 px-4 py-2 text-sm"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[#e5e4e2]/80">{kitItem.equipment.name}</span>
                  <span className="text-xs text-[#e5e4e2]/45">
                    {kitItem.equipment.category?.name}
                  </span>
                </div>

                <span className="font-medium text-[#e5e4e2]/60">
                  {kitItem.quantity * row.quantity} szt.
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Sprzęt</h2>

        <button
          onClick={() => setShowAddEquipmentModal(true)}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj sprzęt
        </button>
      </div>

      {(equipment || []).length === 0 ? (
        <div className="py-12 text-center">
          <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
        </div>
      ) : (
        <div className="space-y-4">
          {manualRows.length > 0 && (
            <div className="space-y-2">{manualRows.map((r: any) => renderRow(r, true))}</div>
          )}

          {manualRows.length > 0 && autoRows.length > 0 && (
            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-[#d3bb73]/10" />
              <span className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                Z produktów oferty
              </span>
              <div className="h-px flex-1 bg-[#d3bb73]/10" />
            </div>
          )}

          {autoRows.length > 0 && (
            <div className="space-y-2">{autoRows.map((r: any) => renderRow(r, true))}</div>
          )}
        </div>
      )}

      {showAddEquipmentModal && (
        <AddEquipmentModal
          isOpen={showAddEquipmentModal}
          onClose={() => setShowAddEquipmentModal(false)}
          onAdd={handleAddEquipment}
          availableEquipment={availableEquipment}
          availableKits={availableKits}
          availabilityByKey={availabilityByKey}
        />
      )}
    </div>
  );
};
