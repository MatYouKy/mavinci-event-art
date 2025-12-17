import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Package, Plus, Trash2, Printer } from 'lucide-react';
import { AddEquipmentModal } from '../Modals/AddEquipmentModal';
import { useEventEquipment } from '../../../hooks';
import { useEvent } from '../../../hooks/useEvent';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import type { AvailabilityUI } from '@/app/crm/events/hooks/useEventEquipment';
import { getKeyForEventRow, keyOf } from '../../helpers/getKeyForEventRow';
import { buildExistingMap } from '../../helpers/buildExistingMap';
import { mergeSameSelections } from '../../helpers/mergeSameSelections';
import { SelectedItem } from '../../../type';
import { EventEquipmentRow } from '../../../UI/RenderRowItem';
import { buildEquipmentChecklistHtml } from '../../helpers/buildEquipmentChecklistPdf';
import { supabase } from '@/lib/supabase';

type ItemType = 'item' | 'kit';
type AvailKey = `${ItemType}-${string}`;

const num = (v: any, fallback = 0) => {
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
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [editingQuantityId, setEditingQuantityId] = useState<string | null>(null);
  const [draftQuantity, setDraftQuantity] = useState<number>(1);

  const { showSnackbar } = useSnackbar();
  const { event } = useEvent();
  const { employee } = useCurrentEmployee();

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

  const handleGenerateChecklist = async () => {
    if (!event?.id || !equipment || equipment.length === 0) {
      showSnackbar('Brak sprzętu do wygenerowania checklisty', 'error');
      return;
    }

    try {
      setGeneratingPdf(true);

      const equipmentData = equipment
        .filter((item: any) => !item.removed_from_offer)
        .map((item: any) => {
          const baseData = {
            name: item.equipment_items?.name || item.equipment_kits?.name || item.cables?.name || 'Nieznany',
            model: item.equipment_items?.model || item.equipment_kits?.description || '',
            quantity: item.quantity || 1,
            category: item.equipment_items?.equipment_categories?.name || '',
            cable_length: item.cables?.length,
            is_kit: !!item.kit_id,
            kit_items: [] as any[],
          };

          if (item.kit_id && item.equipment_kits?.equipment_kit_items) {
            baseData.kit_items = item.equipment_kits.equipment_kit_items.map((ki: any) => ({
              name: ki.equipment_items?.name || 'Nieznany',
              model: ki.equipment_items?.model || '',
              quantity: ki.quantity || 1,
            }));
          }

          return baseData;
        });

      const locationName = event.locations?.name || event.location || 'Nieokreślona';
      const eventDateFormatted = event.event_date
        ? new Date(event.event_date).toLocaleDateString('pl-PL')
        : '-';

      const html = buildEquipmentChecklistHtml({
        eventName: event.name || 'Wydarzenie',
        eventDate: eventDateFormatted,
        location: locationName,
        equipmentItems: equipmentData,
        authorName: employee?.name || '-',
        authorNumber: employee?.phone_number || '-',
      });

      const { default: html2pdf } = await import('html2pdf.js');
      const html2pdfFn: any = (html2pdf as any) || html2pdf;

      const element = document.createElement('div');
      element.innerHTML = html;

      const opt: any = {
        margin: [10, 10, 20, 10],
        filename: `checklista-${event.name?.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      };

      const worker = html2pdfFn().from(element).set(opt).toPdf();
      const pdfBlob: Blob = await worker.output('blob');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const fileName = `checklista-sprzetu-${event.name?.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${timestamp}.pdf`;
      const storagePath = `${event.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('event-files')
        .upload(storagePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        showSnackbar('Błąd podczas zapisywania pliku', 'error');
      } else {
        const { data: folderId } = await supabase.rpc('get_or_create_documents_subfolder', {
          p_event_id: event.id,
          p_subfolder_name: 'Checklisty sprzętu',
          p_required_permission: null,
          p_created_by: employee?.id,
        });

        await supabase.from('event_files').insert([
          {
            event_id: event.id,
            folder_id: folderId,
            name: fileName,
            original_name: fileName,
            file_path: storagePath,
            file_size: pdfBlob.size,
            mime_type: 'application/pdf',
            document_type: 'equipment_checklist',
            thumbnail_url: null,
            uploaded_by: employee?.id,
          },
        ]);

        showSnackbar('Checklista sprzętu została wygenerowana i zapisana', 'success');

        worker.save();
      }
    } catch (error) {
      console.error('Error generating checklist:', error);
      showSnackbar('Błąd podczas generowania checklisty', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const manualRows = useMemo(
    () => (equipment || []).filter((r: any) => !r.auto_added),
    [equipment],
  );
  const autoRows = useMemo(() => (equipment || []).filter((r: any) => r.auto_added), [equipment]);

  const renderRow = (row: any, editable: boolean) => {
    return (
      <EventEquipmentRow
        key={row.id}
        row={row}
        editable={editable}
        expanded={expandedKits.has(row.id)}
        onToggleExpand={(id) => {
          const next = new Set(expandedKits);
          next.has(id) ? next.delete(id) : next.add(id);
          setExpandedKits(next);
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
      />
    );
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Sprzęt</h2>

        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerateChecklist}
            disabled={generatingPdf || !equipment || equipment.length === 0}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            {generatingPdf ? 'Generowanie...' : 'Drukuj checklistę'}
          </button>
          <button
            onClick={() => setShowAddEquipmentModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj sprzęt
          </button>
        </div>
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
