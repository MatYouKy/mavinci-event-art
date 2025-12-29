'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Package, Plus, Printer } from 'lucide-react';
import { AddEquipmentModal } from '../Modals/AddEquipmentModal';
import { ChevronDown, Package as PackageIcon, Trash2 } from 'lucide-react';
import { useEventEquipment } from '../../../hooks';
import { useEvent } from '../../../hooks/useEvent';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import type { AvailabilityUI } from '@/app/crm/events/hooks/useEventEquipment';
import { getKeyForEventRow, keyOf } from '../../helpers/getKeyForEventRow';
import { buildExistingMap } from '../../helpers/buildExistingMap';
import { mergeSameSelections } from '../../helpers/mergeSameSelections';
import type { SelectedItem } from '../../../type';
import { EventEquipmentRow } from '../../../UI/RenderRowItem';
import { buildEquipmentChecklistHtml } from '../../helpers/buildEquipmentChecklistPdf';
import { supabase } from '@/lib/supabase';

import type {
  UUID,
  EquipmentItemDTO,
  EquipmentKitDTO,
} from '@/app/crm/equipment/types/equipment.types';
import ResponsiveActionBar, { type Action } from '@/components/crm/ResponsiveActionBar';
import { extractKitItemsFromRow, isKitRow } from '../../helpers/extractKitItemsFromRow';
import Popover from '@/components/UI/Tooltip';
import { useDialog } from '@/contexts/DialogContext';

const KitItemRow = ({
  thumb,
  name,
  meta,
  qtyText,
  brand,
  model,
  expandInPrint,
}: {
  thumb?: string;
  name: string;
  meta?: string;
  qtyText: string;
  brand: string;
  model: string;
  expandInPrint: boolean;
}) => {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5">
      {thumb ? (
        <Popover
          trigger={
            <div className="relative h-10 w-10">
              <img
                src={thumb}
                alt={name}
                className="h-9 w-9 rounded border border-[#d3bb73]/20 object-cover"
              />
              {expandInPrint && (<div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
                <Printer className="h-3 w-3 text-[#1c1f33]" />
              </div>
            )}
            </div>
          }
          content={
            <img
              src={thumb}
              alt={name}
              className="h-auto cursor-pointer rounded-lg object-contain transition-all"
            />
          }
          openOn="hover"
        />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
          <PackageIcon className="h-4 w-4 text-[#e5e4e2]/40" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[#e5e4e2]">{name}</div>
        {meta && <div className="truncate text-xs text-[#e5e4e2]/50">{meta}</div>}
        
        <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
          {brand && <div className="truncate text-xs text-[#e5e4e2]/50">{brand}</div>}
          {model && <div className="truncate text-xs text-[#e5e4e2]/50">{model}</div>}
        </div>
      </div>

      <div className="text-right text-xs text-[#e5e4e2]/70">
        <div className="font-medium text-[#e5e4e2]">{qtyText}</div>
        <div className="text-[11px] text-[#e5e4e2]/35">razem</div>
      </div>
    </div>
  );
};

type ItemType = 'item' | 'kit';
type AvailKey = `${ItemType}-${string}`;

/** --- helpers --- */
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

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
    maxAdd,
    maxSet,
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

  return {
    label: statusRaw ? statusRaw : '—',
    cls: 'bg-[#e5e4e2]/10 text-[#e5e4e2]/60 border-[#e5e4e2]/15',
  };
}

function getEventEquipmentDisplay(row: any): {
  name: string;
  brand: string; // jak chcesz string – damy '' gdy brak
  model: string;
  categoryName: string;
  isKit: boolean;
  cableLength?: number | null;
  kitItems: Array<{ name: string; brand: string; model: string; quantity: number }>;
} {
  const equipment: EquipmentItemDTO | null | undefined = row?.equipment;
  const kit: EquipmentKitDTO | null | undefined = row?.kit;

  const equipment_items = row?.equipment_items;
  const equipment_kits = row?.equipment_kits;
  const cables = row?.cables;

  const isKit = !!row?.kit_id || !!kit || !!equipment_kits;

  const name =
    equipment?.name ||
    kit?.name ||
    equipment_items?.name ||
    equipment_kits?.name ||
    cables?.name ||
    'Nieznany';

  const brand = equipment?.brand || equipment_items?.brand || ''; // ✅ kluczowe

  const model =
    equipment?.model ||
    equipment_items?.model ||
    kit?.description ||
    equipment_kits?.description ||
    '';

  const categoryName =
    equipment?.category?.name ||
    equipment_items?.equipment_categories?.name ||
    kit?.category?.name ||
    '';

  const cableLength = cables?.length ?? null;

  const kitItems: Array<{ name: string; brand: string; model: string; quantity: number }> = [];

  const kitItemsOld = equipment_kits?.equipment_kit_items;
  if (isKit && Array.isArray(kitItemsOld)) {
    for (const ki of kitItemsOld) {
      kitItems.push({
        name: ki?.equipment_items?.name || 'Nieznany',
        brand: ki?.equipment_items?.brand || '', // ✅
        model: ki?.equipment_items?.model || '',
        quantity: Number(ki?.quantity || 1),
      });
    }
  }

  return { name, brand, model, categoryName, isKit, cableLength, kitItems };
}

export const EventEquipmentTab: React.FC = () => {
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [editingQuantityId, setEditingQuantityId] = useState<string | null>(null);
  const [draftQuantity, setDraftQuantity] = useState<number>(1);

  const { showSnackbar } = useSnackbar();
  const { event } = useEvent();
  const { employee } = useCurrentEmployee();
  const { showConfirm } = useDialog();
  const eventId = (event?.id || '') as UUID;

  // ✅ guard na start: hook może być wywołany, ale wewnątrz i tak nie robimy fetchy bez ID
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
  } = useEventEquipment(eventId, {
    id: eventId,
    event_date: event?.event_date,
    event_end_date: event?.event_end_date,
  });

  console.log('equipment', equipment);

  useEffect(() => {
    if (!eventId) return;
    fetchAvailableEquipment();
  }, [eventId, event?.event_date, event?.event_end_date, fetchAvailableEquipment]);

  const handleRemoveEquipment = async (row: any) => {
    const isAuto = !!row?.auto_added;

    if (isAuto) {
      if (!showConfirm('Usunąć tę pozycję z eventu (pochodzi z oferty)?')) return;

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

    if (!showConfirm('Czy na pewno chcesz usunąć ten sprzęt z eventu?')) return;

    const ok = await removeEquipment(row.id);
    if (ok) {
      await refetch();
      await fetchAvailableEquipment();
    }
  };

  const handleRestoreAutoRow = async (row: any) => {
    if (!confirm('Przywrócić tę pozycję z oferty do eventu?')) return;

    const ok = await updateEquipment(row.id, {
      removed_from_offer: false,
      is_overridden: false,
      quantity: Math.max(1, Number(row.offer_quantity ?? row.auto_quantity ?? 1)),
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
      await fetchAvailableEquipment();
    }
  };

  const handleToggleExpandInChecklist = async (rowId: string, expand: boolean) => {
    const ok = await updateEquipment(rowId, { expand_kit_in_checklist: expand });
    if (ok) {
      await refetch();
    }
  };

  const handleAddEquipment = async (selectedItems: SelectedItem[]) => {
    if (!eventId) return;

    const merged = mergeSameSelections(selectedItems);
    const existingMap = buildExistingMap(equipment);

    const toInsert: SelectedItem[] = [];
    const toUpdate: Array<{ rowId: string; newQty: number }> = [];

    for (const s of merged) {
      const k = keyOf(s.type as ItemType, s.id) as AvailKey;
      const existingRow = existingMap.get(k);

      const avail = (availabilityByKey as Record<string, AvailabilityUI> | undefined)?.[k];
      const { used, maxAdd, maxSet } = getUiLimits(avail);

      const currentQty = Number(existingRow?.quantity ?? used ?? 0);
      const finalQty = currentQty + Number(s.quantity || 0);

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

  const handleGenerateChecklist = async () => {
    if (!eventId || !equipment || equipment.length === 0) {
      showSnackbar('Brak sprzętu do wygenerowania checklisty', 'error');
      return;
    }

    try {
      setGeneratingPdf(true);

      const equipmentData = (equipment as any[])
        .filter((row) => !row?.removed_from_offer)
        .map((row) => {
          const d = getEventEquipmentDisplay(row);

          // ✅ klucz: zawartość kitu tylko gdy expand_kit_in_checklist
          const expand = !!row?.expand_kit_in_checklist;
          const kitItems = expand ? extractKitItemsFromRow(row) : [];

          return {
            name: d.name,
            brand: d.brand,
            model: d.model,
            quantity: Number(row?.quantity || 1),
            category: d.categoryName,
            cable_length: d.cableLength,
            is_kit: d.isKit,
            expand_kit_in_checklist: expand,
            kit_items: kitItems,
          };
        });

      const eventDateFormatted = event?.event_date
        ? new Date(event.event_date).toLocaleDateString('pl-PL')
        : '-';

      const html = buildEquipmentChecklistHtml({
        eventName: event?.name || 'Wydarzenie',
        eventDate: eventDateFormatted,
        location: (event as any)?.location || '-',
        equipmentItems: equipmentData,
        authorName: employee?.name + ' ' + employee?.surname || '-',
        authorNumber: (employee as any)?.phone_number || '-',
      });

      const { default: html2pdf } = await import('html2pdf.js');
      const html2pdfFn: any = (html2pdf as any) || html2pdf;

      // ✅ ważne: w html2pdf najlepiej przekazać element, nie “div wrapper”
      const element = document.createElement('div');
      element.innerHTML = html;

      const opt: any = {
        margin: [10, 10, 1, 10],
        filename: `checklista-${event.name?.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },

        // ✅ to jest kluczowe przy “nie tnij wierszy”
        pagebreak: { mode: ['css', 'legacy'] },
      };

      const worker = html2pdfFn().from(element).set(opt).toPdf();
      const pdfBlob: Blob = await worker.output('blob');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const safeEventName = String(event?.name || 'event')
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();

      const fileName = `checklista-sprzetu-${safeEventName}-${timestamp}.pdf`;
      const storagePath = `${eventId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('event-files')
        .upload(storagePath, pdfBlob, { contentType: 'application/pdf', upsert: false });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        showSnackbar('Błąd podczas zapisywania pliku', 'error');
        return;
      }

      const { data: folderId } = await supabase.rpc('get_or_create_documents_subfolder', {
        p_event_id: eventId,
        p_required_permission: null,
        p_created_by: employee?.id ?? null,
      });

      await supabase.from('event_files').insert([
        {
          event_id: eventId,
          folder_id: folderId,
          name: fileName,
          original_name: fileName,
          file_path: storagePath,
          file_size: pdfBlob.size,
          mime_type: 'application/pdf',
          document_type: 'equipment_checklist',
          thumbnail_url: null,
          uploaded_by: employee?.id ?? null,
        },
      ]);

      showSnackbar('Checklista sprzętu została wygenerowana i zapisana', 'success');

      worker.save();
    } catch (error) {
      console.error('Error generating checklist:', error);
      showSnackbar('Błąd podczas generowania checklisty', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const manualKitRows = useMemo(
    () => (equipment || []).filter((r: any) => !r.auto_added && isKitRow(r)),
    [equipment],
  );
  const autoKitRows = useMemo(
    () => (equipment || []).filter((r: any) => r.auto_added && isKitRow(r)),
    [equipment],
  );
  console.log('autoKitRows', autoKitRows);

  const manualItemRows = useMemo(
    () => (equipment || []).filter((r: any) => !r.auto_added && !isKitRow(r)),
    [equipment],
  );
  const autoItemRows = useMemo(
    () => (equipment || []).filter((r: any) => r.auto_added && !isKitRow(r)),
    [equipment],
  );

  const renderKitRow = (row: any, editable: boolean) => {
    console.log('row', row);
    const isExpanded = expandedKits.has(row.id);

    const kitName = row?.kit?.name || row?.equipment_kits?.name || row?.name || 'Zestaw';

    const kitThumb = row?.kit?.thumbnail_url || row?.equipment_kits?.thumbnail_url || '';

    const key = getKeyForEventRow(row); // "kit-<id>"
    const limits = getUiLimits((availabilityByKey as any)?.[key]);
    const qty = Number(row?.quantity || 1);
    const badge = getStatusBadge(row?.status);

    const expandInPrint = !!row?.expand_kit_in_checklist;

    const kitItemsRaw =
      row?.kit?.items ||
      row?.equipment_kits?.equipment_kit_items ||
      row?.equipment_kits?.equipment_kit_items || // zależnie od joinów
      [];
    const toggleExpand = () => {
      setExpandedKits((prev) => {
        const next = new Set(prev);
        next.has(row.id) ? next.delete(row.id) : next.add(row.id);
        return next;
      });
    };

    return (
      <div key={row.id}>
        {/* GŁÓWNY WIERSZ – 1:1 jak ProductEquipmentRow */}
        <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20">
          {/* chevron */}
          <button
            onClick={toggleExpand}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
            aria-label="Rozwiń zestaw"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/* THUMB + KIT BADGE */}
            {kitThumb ? (
              <Popover
                trigger={
                  <div className="relative h-10 w-10">
                    <img
                      src={kitThumb}
                      alt={kitName}
                      className="h-10 w-10 cursor-pointer rounded border border-[#d3bb73]/20 object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
                    />
                    <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
                      <PackageIcon className="h-3 w-3 text-[#1c1f33]" />
                    </div>
                  </div>
                }
                content={
                  <img
                    src={kitThumb}
                    alt={kitName}
                    className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                  />
                }
                openOn="hover"
              />
            ) : (
              <div className="relative flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                <PackageIcon className="h-5 w-5 text-[#e5e4e2]/40" />
                <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
                  <PackageIcon className="h-3 w-3 text-[#1c1f33]" />
                </div>
              </div>
            )}

            {/* NAZWA + status */}
            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-[#e5e4e2]">{kitName}</span>

                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#e5e4e2]/50">
                <span>
                  możesz dodać jeszcze <span className="text-[#d3bb73]">{limits.maxAdd}</span>
                </span>
                <span>•</span>
                <span>
                  max ustawienia <span className="text-[#d3bb73]">{limits.maxSet}</span>
                </span>
              </div>
            </div>
          </div>

          {/* ilość + checkbox print */}
          <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/40">
            {editingQuantityId === row.id ? (
              <span className="inline-flex items-center gap-2">
                <button
                  className="rounded bg-[#d3bb73] px-2 py-0.5 text-black hover:bg-[#e5c97a]"
                  onClick={() => handleUpdateQuantity(row.id, draftQuantity, limits.maxSet)}
                  title="Zapisz"
                >
                  ✓
                </button>

                <button
                  className="rounded border border-[#d3bb73]/30 px-2 py-0.5 text-[#e5e4e2]/70 hover:text-red-400"
                  onClick={() => {
                    setDraftQuantity(qty);
                    setEditingQuantityId(null);
                  }}
                  title="Anuluj"
                >
                  ✕
                </button>

                <input
                  type="number"
                  min={1}
                  max={limits.maxSet || 1}
                  value={draftQuantity}
                  onChange={(e) => setDraftQuantity(Number(e.target.value || 1))}
                  className="w-16 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-0.5 text-sm text-[#e5e4e2]"
                  autoFocus
                />

                <span className="text-[#e5e4e2]/60">szt.</span>
              </span>
            ) : (
              <span
                className={`text-[#e5e4e2] ${editable ? 'cursor-pointer hover:text-[#d3bb73]' : ''}`}
                onClick={() => {
                  if (!editable) return;
                  setEditingQuantityId(row.id);
                  setDraftQuantity(qty);
                }}
              >
                {qty} <span className="text-[#e5e4e2]/60">szt.</span>
              </span>
            )}

            {/* ilość + print toggle */}
            <div className="flex items-center gap-3 text-sm text-[#e5e4e2]/40">
              {/* ilość (zostaje jak masz) */}
              {editingQuantityId === row.id ? (
                /* ... Twoja edycja qty bez zmian ... */
                <span className="inline-flex items-center gap-2">{/* ... */}</span>
              ) : (
                <span
                  className={`text-[#e5e4e2] ${editable ? 'cursor-pointer hover:text-[#d3bb73]' : ''}`}
                  onClick={() => {
                    if (!editable) return;
                    setEditingQuantityId(row.id);
                    setDraftQuantity(qty);
                  }}
                >
                  {qty} <span className="text-[#e5e4e2]/60">szt.</span>
                </span>
              )}
            </div>
          </div>

          {/* trash */}
          {editable && (
            <div className="flex items-center gap-2 rounded-lg p-2 pt-2 text-red-400/60 transition-colors hover:bg-red-400/10 hover:text-red-400">
              <ResponsiveActionBar
                disabledBackground
                actions={[
                  {
                    label: 'Usuń zestaw',
                    onClick: () => handleRemoveEquipment(row),
                    icon: <Trash2 className="h-4 w-4" />,
                    variant: 'danger',
                  },
                  {
                    label:  expandInPrint ? 'ukryj zawartość' : 'drukuj zawartość',
                    onClick: () => handleToggleExpandInChecklist(row.id, !expandInPrint),
                    icon: expandInPrint ? (
                      <Printer className="h-4 w-4" />
                    ) : (
                      <Printer className="h-4 w-4" />
                    ),
                    variant: 'default',
                  },
                ]}
              />
            </div>
          )}
        </div>

        {/* ROZWINIĘTA ZAWARTOŚĆ – “pod-wiersze” */}
        {isExpanded && (
          <div className="ml-4 mt-2 space-y-2 md:ml-9">
            {/* reszta: zawartość */}
            {kitItemsRaw.length === 0 ? (
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-sm text-[#e5e4e2]/50">
                Brak danych o zawartości zestawu.
              </div>
            ) : (
              kitItemsRaw.map((it: any, idx: number) => {
                const eq = it?.equipment || it?.equipment_items || it?.equipment_item || null;

                const itemThumb = eq?.thumbnail_url || eq?.image_url || it?.thumbnail_url || '';
                const itemId = eq?.id || it?.equipment_item_id || it?.equipment_id;
                const name = eq?.name || it?.name;
                const brand = eq?.brand || it?.brand || '';
                const model = eq?.model || it?.model || '';
                const perKit = Number(it?.quantity || 1);
                console.log('it', it);

                const meta = [it.brand, it.model].filter(Boolean).join(' • ');
                const total = perKit * qty;

                return (
                  <KitItemRow
                    key={`${itemId}-${idx}`}
                    thumb={itemThumb}
                    name={name}
                    meta={meta}
                    qtyText={`${perKit}×${qty} = ${total}`}
                    brand={brand}
                    model={model}
                    expandInPrint={expandInPrint}
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  const renderRow = (row: any, editable: boolean) => {
    return (
      <EventEquipmentRow
        key={row.id}
        row={row}
        editable={editable}
        expanded={expandedKits.has(row.id)}
        onToggleExpand={(id: string) => {
          setExpandedKits((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          });
        }}
        availabilityByKey={availabilityByKey}
        getKeyForEventRow={getKeyForEventRow}
        getUiLimits={getUiLimits}
        getStatusBadge={getStatusBadge}
        editingQuantityId={editingQuantityId}
        draftQuantity={draftQuantity}
        setEditingQuantityId={setEditingQuantityId}
        setDraftQuantity={setDraftQuantity}
        onUpdateQuantity={handleUpdateQuantity}
        onRemove={handleRemoveEquipment}
        onRestore={handleRestoreAutoRow}
        onToggleExpandInChecklist={handleToggleExpandInChecklist}
      />
    );
  };

  const actions = useMemo<Action[]>(() => {
    return [
      {
        label: 'Dodaj sprzęt',
        onClick: () => setShowAddEquipmentModal(true),
        icon: <Plus className="h-4 w-4" />,
        variant: 'primary',
      },
      {
        label: 'Drukuj checklistę',
        onClick: handleGenerateChecklist,
        icon: <Printer className="h-4 w-4" />,
        variant: 'default',
      },
    ];
  }, [setShowAddEquipmentModal, handleGenerateChecklist]);

  const getRowEquipmentId = (r: any) =>
    (r?.equipment_id ||
      r?.equipment_item_id ||
      r?.equipment?.id ||
      r?.equipment_items?.id ||
      null) as string | null;

  const getRowKitId = (r: any) =>
    (r?.kit_id || r?.equipment_kit_id || r?.kit?.id || r?.equipment_kits?.id || null) as
      | string
      | null;

  const existingItemIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of equipment ?? []) {
      if (r?.removed_from_offer) continue; // jeśli ukryte/wyłączone z eventu — nie blokuj wyboru
      const id = getRowEquipmentId(r);
      if (id) set.add(id);
    }
    return set;
  }, [equipment]);

  const existingKitIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of equipment ?? []) {
      if (r?.removed_from_offer) continue;
      const id = getRowKitId(r);
      if (id) set.add(id);
    }
    return set;
  }, [equipment]);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-light text-[#e5e4e2]">Sprzęt</h2>
          <div className="text-sm text-[#e5e4e2]/60">
            <span className="font-medium">Event Zawiera {equipment?.length} Pozycji</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ResponsiveActionBar actions={actions} />
        </div>
      </div>

      {(equipment || []).length === 0 ? (
        <div className="py-12 text-center">
          <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* MANUAL: KITY */}
          {manualKitRows.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">Zestawy</div>
              {manualKitRows.map((r: any) => renderKitRow(r, true))}
            </div>
          )}

          {/* MANUAL: ITEMY (stary EventEquipmentRow) */}
          {manualItemRows.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">Sprzęt</div>
              {manualItemRows.map((r: any) => renderRow(r, true))}
            </div>
          )}

          {manualKitRows.length + manualItemRows.length > 0 &&
            autoKitRows.length + autoItemRows.length > 0 && (
              <div className="my-6 flex items-center gap-4">
                <div className="h-px flex-1 bg-[#d3bb73]/10" />
                <span className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                  Z produktów oferty
                </span>
                <div className="h-px flex-1 bg-[#d3bb73]/10" />
              </div>
            )}

          {/* AUTO: KITY */}
          {autoKitRows.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">Zestawy</div>
              {autoKitRows.map((r: any) => renderKitRow(r, true))}
            </div>
          )}

          {/* AUTO: ITEMY */}
          {autoItemRows.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">Sprzęt</div>
              {autoItemRows.map((r: any) => renderRow(r, true))}
            </div>
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
