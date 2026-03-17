'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Package, Plus, Printer, AlertTriangle } from 'lucide-react';
import { AddEquipmentModal } from '../Modals/AddEquipmentModal';
import { ChevronDown, Package as PackageIcon, Trash2 } from 'lucide-react';
import { useEventEquipment } from '../../../hooks';
import { useEvent } from '../../../hooks/useEvent';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useRouter } from 'next/navigation';
import type { AvailabilityUI } from '@/app/(crm)/crm/events/hooks/useEventEquipment';
import { getKeyForEventRow, keyOf } from '../../helpers/getKeyForEventRow';
import { buildExistingMap } from '../../helpers/buildExistingMap';
import { mergeSameSelections } from '../../helpers/mergeSameSelections';
import type { IEvent, SelectedItem } from '../../../type';
import { EventEquipmentRow } from '../../../UI/RenderRowItem';
import { buildEquipmentChecklistHtml } from '../../helpers/buildEquipmentChecklistPdf';
import { supabase } from '@/lib/supabase/browser';
import Image from 'next/image';
import type {
  UUID,
  EquipmentItemDTO,
  EquipmentKitDTO,
} from '@/app/(crm)/crm/equipment/types/equipment.types';
import ResponsiveActionBar, { type Action } from '@/components/crm/ResponsiveActionBar';
import { extractKitItemsFromRow, isKitRow } from '../../helpers/extractKitItemsFromRow';
import Popover from '@/components/UI/Tooltip';
import { useDialog } from '@/contexts/DialogContext';
import { ISimpleContact } from '../../EventDetailPageClient';

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
              <Image
                src={thumb ?? ''}
                alt={name}
                width={36}
                height={36}
                className="h-9 w-9 rounded border border-[#d3bb73]/20 object-cover"
              />
              {expandInPrint && (
                <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
                  <Printer className="h-3 w-3 text-[#1c1f33]" />
                </div>
              )}
            </div>
          }
          content={
            <Image
              src={thumb}
              alt={name}
              width={100}
              height={100}
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

function getStatusBadge(statusRaw?: string, hasConflict?: boolean) {
  // Jeśli sprzęt ma konflikt (niedostępny)
  if (hasConflict) {
    return {
      label: 'NIEDOSTĘPNY',
      cls: 'bg-red-500/15 text-red-400 border-red-500/30',
    };
  }

  const status = normalizeStatus(statusRaw);

  if (status === 'draft') {
    return {
      label: 'DRAFT (rezerwuje)',
      cls: 'bg-[#d3bb73]/15 text-[#d3bb73] border-[#d3bb73]/30',
    };
  }
  if (status === 'rental') {
    return {
      label: 'RENTAL',
      cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
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

export const EventEquipmentTab: React.FC<{
  eventId: string;
  contact: ISimpleContact;
  eventDate: string;
  location: string;
  eventEndDate: string;
  initialEvent?: IEvent;
}> = ({ eventId, contact, eventDate, location, eventEndDate, initialEvent }) => {
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [editingQuantityId, setEditingQuantityId] = useState<string | null>(null);
  const [showAlternativesModal, setShowAlternativesModal] = useState(false);
  const [alternatives, setAlternatives] = useState<any[]>([]);
  const [currentItemForReplacement, setCurrentItemForReplacement] = useState<any>(null);
  const [draftQuantity, setDraftQuantity] = useState<number>(1);

  const { showSnackbar } = useSnackbar();
  const { event, refetch: refetchEvent } = useEvent(initialEvent);
  const { employee } = useCurrentEmployee();
  const { showConfirm } = useDialog();
  const router = useRouter();

  // Sprawdzenie czy są nierozwiązane konflikty
  const [hasUnresolvedConflicts, setHasUnresolvedConflicts] = useState(false);

  useEffect(() => {
    const checkConflicts = async () => {
      if (!eventId) return;

      try {
        // Najpierw pobierz oferty dla eventu
        const { data: offers, error: offersError } = await supabase
          .from('offers')
          .select('id')
          .eq('event_id', eventId);

        if (offersError) throw offersError;

        if (!offers || offers.length === 0) {
          setHasUnresolvedConflicts(false);
          return;
        }

        const offerIds = offers.map((o) => o.id);

        // Sprawdź czy są nierozwiązane konflikty
        const { data: conflicts, error: conflictsError } = await supabase
          .from('offer_equipment_conflicts')
          .select('id')
          .eq('status', 'unresolved')
          .in('offer_id', offerIds)
          .limit(1);

        if (conflictsError) throw conflictsError;
        setHasUnresolvedConflicts((conflicts?.length || 0) > 0);
      } catch (err) {
        console.error('Error checking conflicts:', err);
      }
    };

    checkConflicts();
  }, [eventId]);

  // Tracking PDF checklisty
  const checklistPdfPath = event?.equipment_checklist_pdf_path || null;
  const checklistModified = event?.equipment_checklist_modified || false;

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
    event_date: eventDate,
    event_end_date: eventEndDate,
  });


  useEffect(() => {
    if (!eventId) return;
    fetchAvailableEquipment();
  }, [eventId, eventDate, event?.event_end_date, fetchAvailableEquipment]);

  const handleRemoveEquipment = async (row: any) => {


    const isAuto = !!row?.auto_added;

    const confirmedRemove = await showConfirm('Usunąć tę pozycję z eventu (pochodzi z oferty)?');
    if (!confirmedRemove) return;

    if (isAuto) {
      const result = await updateEquipment(row.id, {
        removed_from_offer: true,
        is_overridden: true,
        quantity: 0,
      });

      if (result) {
        await refetch();
        await fetchAvailableEquipment();
      }
      return;
    }

    const result = await removeEquipment(row.id);

    if (result) {
      await refetch();
      await fetchAvailableEquipment();
    } else {
      showSnackbar('Nie udało się usunąć pozycji', 'error');
    }
  };

  const handleRestoreAutoRow = async (row: any) => {
    const confirmedRestore = await showConfirm('Przywrócić tę pozycję z oferty do eventu?');
    if (!confirmedRestore) return;

    const result = await updateEquipment(row.id, {
      removed_from_offer: false,
      is_overridden: false,
      quantity: Math.max(1, Number(row.offer_quantity ?? row.auto_quantity ?? 1)),
    });

    if (result) {
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

      // 0. Usuń poprzedni PDF jeśli istnieje
      if (checklistPdfPath) {
        try {
          // Usuń z storage
          await supabase.storage.from('event-files').remove([checklistPdfPath]);

          // Usuń z event_files
          await supabase.from('event_files').delete().eq('file_path', checklistPdfPath);
        } catch (deleteError) {
          console.warn('Błąd podczas usuwania poprzedniego PDF checklisty:', deleteError);
        }
      }

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

      const eventDateFormatted = new Date(eventDate).toLocaleDateString('pl-PL');

      // ✅ Pobierz dane kontaktu w zależności od typu klienta
      let contactName = contact?.full_name || '-';
      let contactPhone = contact?.phone || '-';

      const html = buildEquipmentChecklistHtml({
        eventName: event?.name || 'Wydarzenie',
        eventDate: eventDateFormatted,
        location: location,
        equipmentItems: equipmentData,
        authorName: employee?.name + ' ' + employee?.surname || '-',
        authorNumber: (employee as any)?.phone_number || '-',
        contactName,
        contactPhone,
      });

      const { default: html2pdf } = await import('html2pdf.js');
      const html2pdfFn: any = (html2pdf as any) || html2pdf;

      // ✅ ważne: w html2pdf najlepiej przekazać element, nie “div wrapper”
      const element = document.createElement('div');
      element.innerHTML = html;

      const opt: any = {
        margin: [10, 10, 1, 10],
        filename: `checklista-${String(event?.name || 'event')
          .replace(/[^a-z0-9]/gi, '-')
          .toLowerCase()}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },

        // ✅ to jest kluczowe przy "nie tnij wierszy"
        pagebreak: { mode: ['css', 'legacy'] },
      };

      const worker = html2pdfFn().from(element).set(opt).toPdf();
      const pdfBlob: Blob = await worker.output('blob');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const safeEventName = String(event?.name || 'event')
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();

      const fileName = `checklista-sprzetu-${safeEventName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${timestamp}.pdf`;
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

      // Zapisz ścieżkę PDF w tabeli events
      await supabase
        .from('events')
        .update({
          equipment_checklist_pdf_path: storagePath,
          equipment_checklist_pdf_at: new Date().toISOString(),
          equipment_checklist_modified: false,
        })
        .eq('id', eventId);

      // Odśwież dane wydarzenia
      await refetchEvent();

      showSnackbar('Checklista sprzętu została wygenerowana i zapisana w zakładce Pliki', 'success');

      worker.save();
    } catch (error) {
      console.error('Error generating checklist:', error);
      showSnackbar('Błąd podczas generowania checklisty', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleShowChecklistPdf = async () => {
    if (!checklistPdfPath) return;

    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(checklistPdfPath, 3600);

      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (err) {
      console.error('Error showing PDF:', err);
      showSnackbar('Błąd podczas otwierania PDF', 'error');
    }
  };

  const handleDownloadChecklistPdf = async () => {
    if (!checklistPdfPath) return;

    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(checklistPdfPath, 3600);

      if (data?.signedUrl) {
        const response = await fetch(data.signedUrl);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = checklistPdfPath.split('/').pop() || 'checklista.pdf';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        }, 100);
      }
    } catch (err) {
      console.error('Error downloading PDF:', err);
      showSnackbar('Błąd podczas pobierania PDF', 'error');
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

  const manualItemRows = useMemo(
    () => (equipment || []).filter((r: any) => !r.auto_added && !isKitRow(r)),
    [equipment],
  );
  const autoItemRows = useMemo(
    () => (equipment || []).filter((r: any) => r.auto_added && !isKitRow(r)),
    [equipment],
  );

  const renderKitRow = (row: any, editable: boolean) => {
    const isExpanded = expandedKits.has(row.id);

    const kitName = row?.kit?.name || row?.equipment_kits?.name || row?.name || 'Zestaw';

    const kitThumb = row?.kit?.thumbnail_url || row?.equipment_kits?.thumbnail_url || '';

    const key = getKeyForEventRow(row); // "kit-<id>"
    const avail = (availabilityByKey as any)?.[key];
    const limits = getUiLimits(avail);
    const qty = Number(row?.quantity || 1);
    const hasConflict = avail && avail.max_add < 0;
    const badge = getStatusBadge(row?.status, hasConflict);

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
                    <Image
                      src={kitThumb}
                      alt={kitName}
                      width={40}
                      height={40}
                      className="h-10 w-10 cursor-pointer rounded border border-[#d3bb73]/20 object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
                    />
                    <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
                      <PackageIcon className="h-3 w-3 text-[#1c1f33]" />
                    </div>
                  </div>
                }
                content={
                  <Image
                    src={kitThumb ?? ''}
                    alt={kitName}
                    width={100}
                    height={100}
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
                    label: expandInPrint ? 'ukryj zawartość' : 'drukuj zawartość',
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

  const handleMarkAsRental = async (row: any) => {
    try {
      const equipmentName =
        row?.equipment?.name ||
        row?.equipment_items?.name ||
        row?.kit?.name ||
        row?.item_name ||
        'Nieznany sprzęt';

      // Update event_equipment
      const { error: eventEqError } = await supabase
        .from('event_equipment')
        .update({
          use_external_rental: true,
          status: 'rental',
          is_optional: false,
          auto_added: false,
          notes: `Wynajem zewnętrzny - ${equipmentName}`
        })
        .eq('id', row.id);

      if (eventEqError) throw eventEqError;

      // If there's a conflict ID, also update the conflict
      const conflictId = row?.conflict_id;
      if (conflictId) {
        const { error: conflictError } = await supabase
          .from('offer_equipment_conflicts')
          .update({
            use_external_rental: true,
          })
          .eq('id', conflictId);

        if (conflictError) {
          console.warn('Could not update conflict:', conflictError);
        }
      }

      // Create subcontractor task
      if (eventId) {
        const { error: noteError } = await supabase
          .from('subcontractor_tasks')
          .insert({
            event_id: eventId,
            task_name: `Wynajem: ${equipmentName}`,
            description: `Potrzebny wynajem zewnętrzny - ${equipmentName} (${row.quantity || row.required_qty || 1} szt.)`,
            status: 'planned',
            payment_type: 'fixed',
            notes: 'Utworzone automatycznie z zakładki Sprzęt',
          });

        if (noteError) {
          console.warn('Nie udało się utworzyć zadania dla podwykonawcy:', noteError);
        }
      }

      showSnackbar('Sprzęt oznaczony jako wynajem zewnętrzny. Dodano zadanie w zakładce Podwykonawcy.', 'success');
      await refetch();
    } catch (err: any) {
      console.error('Error marking as rental:', err);
      showSnackbar(err.message || 'Błąd podczas oznaczania jako rental', 'error');
    }
  };

  const handleReplaceEquipment = async (alternativeId: string) => {
    try {
      if (!currentItemForReplacement) return;
  
      const oldName =
        currentItemForReplacement?.equipment?.name ||
        currentItemForReplacement?.equipment_items?.name ||
        currentItemForReplacement?.item_name ||
        'Nieznany';
  
      const { data: newEquipment, error: fetchError } = await supabase
        .from('equipment_items')
        .select('name')
        .eq('id', alternativeId)
        .single();
  
      if (fetchError) throw fetchError;
  
      const { error: updateError } = await supabase
        .from('event_equipment')
        .update({
          equipment_id: alternativeId,
          kit_id: null,
          status: 'reserved',
          is_optional: false,
          auto_added: false,
          notes: `Zamieniono z: ${oldName} → ${newEquipment?.name || alternativeId}`,
        })
        .eq('id', currentItemForReplacement.id);
  
      if (updateError) throw updateError;
  
      showSnackbar(`Sprzęt zamieniony: ${oldName} → ${newEquipment?.name}`, 'success');
      setShowAlternativesModal(false);
      setAlternatives([]);
      setCurrentItemForReplacement(null);
      await refetch();
    } catch (err: any) {
      console.error('Error replacing equipment:', err);
      showSnackbar(err.message || 'Błąd podczas zamiany sprzętu', 'error');
    }
  };

  const handleSuggestAlternative = async (row: any) => {
    try {
      console.log('[handleSuggestAlternative] row:', row);
  
      let currentEquipmentId =
        row?.equipment?.id ||
        row?.equipment_id ||
        row?.item_id ||
        null;
  
      let warehouseCategoryId =
        row?.equipment?.warehouse_category_id ||
        row?.warehouse_category_id ||
        null;
  
      // Jeśli to kit, na razie nie obsługujemy alternatyw
      const rowItemType =
        row?.item_type ||
        (row?.kit_id ? 'kit' : 'item');
  
      if (rowItemType === 'kit') {
        showSnackbar('Alternatywy dla zestawów nie są jeszcze obsługiwane', 'info');
        return;
      }
  
      // Dociągnij kategorię z equipment_items, jeśli nie przyszła w row
      if (!warehouseCategoryId && currentEquipmentId) {
        const { data: equipmentItem, error: equipmentError } = await supabase
          .from('equipment_items')
          .select('id, name, warehouse_category_id')
          .eq('id', currentEquipmentId)
          .single();
  
        if (equipmentError) throw equipmentError;
  
        warehouseCategoryId = equipmentItem?.warehouse_category_id ?? null;
        currentEquipmentId = equipmentItem?.id ?? currentEquipmentId;
      }
  
      console.log('[handleSuggestAlternative] currentEquipmentId:', currentEquipmentId);
      console.log('[handleSuggestAlternative] warehouseCategoryId:', warehouseCategoryId);
  
      if (!warehouseCategoryId) {
        showSnackbar('Nie można znaleźć kategorii sprzętu', 'error');
        return;
      }
  
      // Pobierz informacje o kategorii
      const { data: category, error: categoryError } = await supabase
        .from('warehouse_categories')
        .select('id, name, parent_id, level')
        .eq('id', warehouseCategoryId)
        .single();
  
      if (categoryError) throw categoryError;
  
      // Szukaj w tej samej kategorii
      let { data: alternatives, error } = await supabase
        .from('equipment_items')
        .select('id, name, brand, model, thumbnail_url, warehouse_category_id')
        .eq('warehouse_category_id', warehouseCategoryId)
        .neq('id', currentEquipmentId || '')
        .limit(20);
  
      if (error) throw error;
  
      let searchLevel = 'subcategory';
      let parentCategoryName = '';
  
      // Jeśli nie znaleziono alternatyw w podkategorii, szukaj w głównej kategorii
      if ((!alternatives || alternatives.length === 0) && category.parent_id) {
        searchLevel = 'main_category';
  
        const { data: parentCategory } = await supabase
          .from('warehouse_categories')
          .select('id, name')
          .eq('id', category.parent_id)
          .single();
  
        if (parentCategory) {
          parentCategoryName = parentCategory.name;
  
          const { data: subcategories } = await supabase
            .from('warehouse_categories')
            .select('id')
            .eq('parent_id', category.parent_id);
  
          if (subcategories && subcategories.length > 0) {
            const subcategoryIds = subcategories.map((s) => s.id);
  
            const { data: mainCategoryAlternatives, error: mainError } = await supabase
              .from('equipment_items')
              .select('id, name, brand, model, thumbnail_url, warehouse_category_id')
              .in('warehouse_category_id', subcategoryIds)
              .neq('id', currentEquipmentId || '')
              .limit(20);
  
            if (mainError) throw mainError;
  
            if (mainCategoryAlternatives) {
              alternatives = mainCategoryAlternatives;
            }
          }
        }
      }
  
      if (!alternatives || alternatives.length === 0) {
        showSnackbar('Brak dostępnych alternatyw', 'info');
        return;
      }
  
      const enrichedAlternatives = await Promise.all(
        alternatives.map(async (alt) => {
          const { count: totalQty, error: totalError } = await supabase
            .from('equipment_units')
            .select('*', { count: 'exact', head: true })
            .eq('equipment_id', alt.id);
  
          if (totalError) throw totalError;
  
          const { count: availableQty, error: availableError } = await supabase
            .from('equipment_units')
            .select('*', { count: 'exact', head: true })
            .eq('equipment_id', alt.id)
            .eq('status', 'available');
  
          if (availableError) throw availableError;
  
          return {
            ...alt,
            total_qty: totalQty || 0,
            available_qty: availableQty || 0,
            reserved_qty: Math.max((totalQty || 0) - (availableQty || 0), 0),
          };
        })
      );
  
      const message =
        searchLevel === 'main_category'
          ? `Znaleziono ${enrichedAlternatives.length} alternatyw z kategorii: ${parentCategoryName}`
          : `Znaleziono ${enrichedAlternatives.length} alternatyw`;
  
      showSnackbar(message, 'info');
  
      setAlternatives(enrichedAlternatives);
      setCurrentItemForReplacement(row);
      setShowAlternativesModal(true);
    } catch (err: any) {
      console.error('Error suggesting alternatives:', err);
      showSnackbar(err.message || 'Błąd podczas szukania alternatyw', 'error');
    }
  };

  const renderRow = (row: any, editable: boolean) => {
    // Sprawdź czy sprzęt ma konflikt (niedostępny)
    const aKey = getKeyForEventRow(row);
    const avail = aKey ? availabilityByKey?.[aKey] : undefined;
    const hasConflict = avail && avail.max_add < 0;

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
        getStatusBadge={(status) => getStatusBadge(status, hasConflict)}
        editingQuantityId={editingQuantityId}
        draftQuantity={draftQuantity}
        setEditingQuantityId={setEditingQuantityId}
        setDraftQuantity={setDraftQuantity}
        onUpdateQuantity={handleUpdateQuantity}
        onRemove={handleRemoveEquipment}
        onRestore={handleRestoreAutoRow}
        onMarkAsRental={handleMarkAsRental}
        onSuggestAlternative={handleSuggestAlternative}
        onToggleExpandInChecklist={handleToggleExpandInChecklist}
        eventId={eventId}
        offerId={row?.offer_id}
        onComponentsAdded={() => {
          refetch();
          refetchEvent();
        }}
      />
    );
  };

  const actions = useMemo<Action[]>(() => {
    const result: Action[] = [
      {
        label: 'Dodaj sprzęt',
        onClick: () => setShowAddEquipmentModal(true),
        icon: <Plus className="h-4 w-4" />,
        variant: 'primary',
      },
    ];

    // Logika dla PDF checklisty
    if (!checklistPdfPath || checklistModified) {
      // Brak PDF lub są zmiany - pokaż przycisk generuj/regeneruj
      result.push({
        label: generatingPdf
          ? 'Generowanie...'
          : checklistModified
            ? 'Regeneruj checklistę'
            : 'Generuj checklistę',
        onClick: handleGenerateChecklist,
        icon: <Printer className="h-4 w-4" />,
        variant: 'default',
        disabled: generatingPdf,
      });
    } else {
      // PDF istnieje i nie ma zmian - pokaż przyciski pokaż i pobierz
      result.push(
        {
          label: 'Pokaż checklistę',
          onClick: handleShowChecklistPdf,
          icon: <Printer className="h-4 w-4" />,
          variant: 'default',
        },
        {
          label: 'Pobierz checklistę',
          onClick: handleDownloadChecklistPdf,
          icon: <Printer className="h-4 w-4" />,
          variant: 'default',
        },
      );
    }

    return result;
  }, [
    setShowAddEquipmentModal,
    checklistPdfPath,
    checklistModified,
    generatingPdf,
    handleGenerateChecklist,
    handleShowChecklistPdf,
    handleDownloadChecklistPdf,
  ]);

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

      {event?.has_equipment_shortage && hasUnresolvedConflicts && (
        <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" />
            <div>
              <h3 className="mb-1 font-medium text-red-300">Braki sprzętowe</h3>
              <p className="text-sm text-red-300/80">
                Event ma braki sprzętowe w terminie. Część sprzętu z oferty nie została dodana do eventu, ponieważ nie jest dostępna.
              </p>
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                // Znajdź pierwszą ofertę z konfliktem
                const { data: offers, error } = await supabase
                  .from('offers')
                  .select('id')
                  .eq('event_id', eventId)
                  .order('created_at', { ascending: false })
                  .limit(1);

                if (error) throw error;

                if (offers && offers.length > 0) {
                  // Przekieruj do oferty
                  router.push(`/crm/offers/${offers[0].id}`);
                } else {
                  showSnackbar('Brak ofert dla tego eventu', 'error');
                }
              } catch (err: any) {
                console.error('Error finding offer:', err);
                showSnackbar(err.message || 'Błąd podczas szukania oferty', 'error');
              }
            }}
            className="flex-shrink-0 rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/30"
          >
            Rozwiąż konflikty
          </button>
        </div>
      )}

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

      {showAlternativesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-3xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium text-[#e5e4e2]">
                Wybierz alternatywny sprzęt
              </h3>
              <button
                onClick={() => {
                  setShowAlternativesModal(false);
                  setAlternatives([]);
                  setCurrentItemForReplacement(null);
                }}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                ✕
              </button>
            </div>

            {currentItemForReplacement && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <div className="text-sm text-[#e5e4e2]/70">
                  <span className="text-[#e5e4e2]/50">Zastępujesz: </span>
                  <span className="font-medium text-[#e5e4e2]">
                    {currentItemForReplacement?.equipment?.name || 'Nieznany'}
                  </span>
                </div>
              </div>
            )}

            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {alternatives.map((alt) => (
                <div
                  key={alt.id}
                  className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:border-[#d3bb73]/30"
                >
                  <div className="flex items-center gap-3">
                    {alt.thumbnail_url ? (
                      <img
                        src={alt.thumbnail_url}
                        alt={alt.name}
                        className="h-12 w-12 rounded border border-[#d3bb73]/20 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                        <Package className="h-6 w-6 text-[#e5e4e2]/30" />
                      </div>
                    )}

                    <div>
                      <div className="font-medium text-[#e5e4e2]">{alt.name}</div>
                      <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                        {alt.brand && <span>{alt.brand}</span>}
                        {alt.model && (
                          <>
                            {alt.brand && <span>•</span>}
                            <span>{alt.model}</span>
                          </>
                        )}
                        {alt.warehouse_categories && (
                          <>
                            <span>•</span>
                            <span>{alt.warehouse_categories.name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleReplaceEquipment(alt.id)}
                    className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    Wybierz
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
