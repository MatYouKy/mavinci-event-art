'use client';
import { EquipmentChecklistNotes } from '@/components/crm/EquipmentChecklistNotes';
import EquipmentChecklistBar from '@/components/crm/events/equipment/EquipmentChecklistBar';
import { useEquipmentChecklist } from '@/components/crm/events/equipment/useEquipmentChecklist';
import {
  EquipmentRowBadges,
  EquipmentRowNote,
  EquipmentRowQtyChip,
  EquipmentRowTick,
  isEquipmentRowDone,
} from '@/components/crm/events/equipment/EquipmentRowChecklist';
import { equipmentRowTint, type EquipmentRowChecklist } from '@/components/crm/events/equipment/equipmentChecklistUi';
import { equipmentDefaultStage, type EquipmentStageKey } from '@/lib/events/equipment/equipmentChecklist';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Package,
  Plus,
  Printer,
  AlertTriangle,
  Calculator,
  Search,
  Download,
  ArrowRightLeft,
  FileText,
  Check,
  X,
} from 'lucide-react';
import { AddEquipmentModal } from '../Modals/AddEquipmentModal';
import { ChevronDown, Package as PackageIcon, Trash2 } from 'lucide-react';
import { useEventEquipment } from '../../../hooks';
import { compareEquipmentOrder, equipmentRowOrderKey } from '@/lib/events/equipment/equipmentChecklist';
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
import SelectRentalEquipmentModal from '@/components/crm/SelectRentalEquipmentModal';
import NextImage from 'next/image';
import { RequiredComponentsWarning } from '@/components/crm/RequiredComponentsWarning';

// Warehouse checklists always use MAVINCI branding, independently of the event's sales brand.
const CHECKLIST_COMPANY_ID = 'd4474f90-5e61-4ba4-928e-c25c0f0659b5';

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
              <NextImage
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
            <NextImage
              src={thumb}
              alt={name}
              width={500}
              height={500}
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

type ItemType = 'item' | 'kit' | 'cable';
type AvailKey = `${ItemType}-${string}`;

const isCableRow = (row: any) => !!(row?.cable_id || row?.cable || row?.cables);

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

  // reserved_quantity to rezerwacje z INNYCH eventów
  // used_by_this_event to rezerwacje w BIEŻĄCYM evencie
  // SUMA = łączna liczba zarezerwowanych jednostek
  const reservedFromOtherEvents = num((avail as any).reserved_quantity, 0);
  const totalReserved = reservedFromOtherEvents + used;

  return {
    used,
    availableInTerm,
    maxAdd,
    maxSet,
    total: num((avail as any).total_quantity, 0),
    reserved: totalReserved,
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
  if (status === 'returned') {
    return { label: 'ZWRÓCONE', cls: 'bg-[#e5e4e2]/10 text-[#e5e4e2]/60 border-[#e5e4e2]/15' };
  }
  if (status === 'planned') {
    return { label: 'PLANOWANE', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/20' };
  }
  if (status === 'reserved_pending') {
    return { label: 'REZERWACJA WSTĘPNA', cls: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' };
  }
  if (status === 'reserved_confirmed') {
    return { label: 'ZAREZERWOWANE', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' };
  }

  return {
    label: '—',
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
  // Wiersze `getEventEquipment` mają kabel pod `cable` — bez tego checklista PDF pokazywała przewody jako „Nieznany”.
  const cables = row?.cables || row?.cable;

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

  const cableLength = cables?.length ?? cables?.length_meters ?? null;

  const kitItems: Array<{ name: string; brand: string; model: string; quantity: number }> = [];

  const kitItemsOld = equipment_kits?.equipment_kit_items;
  if (isKit && Array.isArray(kitItemsOld)) {
    for (const ki of kitItemsOld) {
      kitItems.push({
        name: ki?.equipment_items?.name || 'Nieznany',
        brand: ki?.equipment_items?.brand || '', // ✅
        model: ki?.equipment_items?.model || '',
        quantity: Number(ki?.quantity),
      });
    }
  }

  return { name, brand, model, categoryName, isKit, cableLength, kitItems };
}


type CalculationEquipmentItem = {
  id: string;
  calculation_id: string;
  category: string;
  name: string;
  description: string | null;
  unit: string | null;
  quantity: number | null;
  days: number | null;
  source: string | null;
  source_ref: string | null;
  position: number | null;
};

/**
 * Pozycje sprzętowe zaakceptowanej kalkulacji bez cen (RPC get_event_calculation_equipment, obszar „realizacja”).
 * Bezpośredni odczyt event_calculation_items wymaga obszaru „kwoty” — zostaje tylko, gdy RPC nie jest jeszcze wdrożone.
 */
async function loadCalculationEquipment(
  eventId: string,
): Promise<{ calculationId: string | null; items: CalculationEquipmentItem[] | null }> {
  const { data, error } = await supabase.rpc('get_event_calculation_equipment', { p_event_id: eventId });
  if (!error) {
    const result = (data ?? {}) as { calculation_id?: string | null; items?: CalculationEquipmentItem[] | null };
    return {
      calculationId: result.calculation_id ?? null,
      items: Array.isArray(result.items) ? result.items : [],
    };
  }
  if (!['42883', 'PGRST202'].includes(error.code ?? '')) throw error;

  const { data: eventData, error: eventError } = await supabase
    .from('events')
    .select('accepted_calculation_id, financial_source')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!eventData?.accepted_calculation_id || eventData.financial_source !== 'calculation') {
    return { calculationId: null, items: [] };
  }
  const { data: items, error: itemsError } = await supabase
    .from('event_calculation_items')
    .select('id, calculation_id, category, name, description, unit, quantity, days, source, source_ref, position')
    .eq('calculation_id', eventData.accepted_calculation_id)
    .eq('category', 'equipment')
    .order('position');
  if (itemsError) throw itemsError;
  return { calculationId: eventData.accepted_calculation_id, items: (items ?? []) as CalculationEquipmentItem[] };
}

export const EventEquipmentTab: React.FC<{
  eventId: string;
  contact: ISimpleContact;
  eventDate: string;
  location: string;
  eventEndDate: string;
  initialEvent?: IEvent;
}> = ({ eventId, contact, eventDate, location, eventEndDate, initialEvent }) => {
  const [equipmentSearch, setEquipmentSearch] = useState('');
  useEffect(() => { setEquipmentSearch(''); }, [eventId]);
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [editingQuantityId, setEditingQuantityId] = useState<string | null>(null);
  const [showAlternativesModal, setShowAlternativesModal] = useState(false);
  const [alternatives, setAlternatives] = useState<any[]>([]);
  const [currentItemForReplacement, setCurrentItemForReplacement] = useState<any>(null);
  const [replacingConflictIdx, setReplacingConflictIdx] = useState<number | null>(null);
  const [alternativeQuantity, setAlternativeQuantity] = useState<number>(1);
  const [draftQuantity, setDraftQuantity] = useState<number>(1);
  const [showRentalModal, setShowRentalModal] = useState(false);
  const [currentRowForRental, setCurrentRowForRental] = useState<any>(null);
  const [checklistNotesDirty, setChecklistNotesDirty] = useState(false);
  const [localChecklistModified, setLocalChecklistModified] = useState(false);
  const [acceptedCalcId, setAcceptedCalcId] = useState<string | null>(null);
  const [externalItems, setExternalItems] = useState<
    Array<{ name: string; quantity: number; unit: string; description: string }>
  >([]);
  const [resolvedExternalIndices, setResolvedExternalIndices] = useState<Set<number>>(new Set());
  const [importingFromCalc, setImportingFromCalc] = useState(false);
  const [replacingExternalIdx, setReplacingExternalIdx] = useState<number | null>(null);

  const [importConflicts, setImportConflicts] = useState<
    Array<{
      name: string;
      quantity: number;
      available: number;
      equipmentId: string;
      type: 'item' | 'kit';
    }>
  >([]);
  const [resolvedConflictIndices, setResolvedConflictIndices] = useState<Set<number>>(new Set());
  const [componentReviewQueue, setComponentReviewQueue] = useState<
    Array<{ reviewId?: string; equipmentId: string; name: string; source: 'manual' | 'import' }>
  >([]);

  const { showSnackbar } = useSnackbar();
  const { event, refetch: refetchEvent } = useEvent(initialEvent);
  const { employee, isAdmin } = useCurrentEmployee();
  const { showConfirm } = useDialog();
  const router = useRouter();

  // Checklista sprzętu: ta sama lista pozycji, filtrowana etapem (Wydanie · Po wydarzeniu · Zwrot).
  const checklistState = useEquipmentChecklist(eventId);
  const { checklist, status: checklistStatus, busyKeys: checklistBusy, run: runChecklist } = checklistState;
  const [checklistPick, setChecklistPick] = useState<EquipmentStageKey | null>(null);
  const checklistStageRef = useRef<string | null>(null);
  useEffect(() => {
    setChecklistPick(null);
    checklistStageRef.current = null;
  }, [eventId]);
  // Etap wydarzenia się zmienił (zatwierdzenie tu albo na innym urządzeniu) → pokaż bieżący etap.
  useEffect(() => {
    const current = checklist?.stage ?? null;
    if (checklistStageRef.current && current && current !== checklistStageRef.current) setChecklistPick(null);
    checklistStageRef.current = current;
  }, [checklist?.stage]);
  const checklistStage: EquipmentStageKey | null =
    checklist && checklist.stage !== 'empty' ? checklistPick ?? equipmentDefaultStage(checklist) : null;
  const checklistLines = useMemo(() => new Map((checklist?.lines ?? []).map((line) => [line.id, line])), [checklist]);
  // Po potwierdzeniu wydania lista jest zablokowana (baza odrzuca zmiany ilości i usuwanie wydanych pozycji).
  const checklistLocked = Boolean(checklist?.dispatch.confirmed_at);
  const showLegacyLoaded = !checklist && (checklistStatus === 'missing' || checklistStatus === 'error');
  const shippedOnly = checklistStage === 'loadback' || checklistStage === 'return';

  const checklistRowFor = (row: any): EquipmentRowChecklist | undefined => {
    if (!checklist || !checklistStage || !row?.id) return undefined;
    const line = checklistLines.get(row.id);
    if (!line || (checklistStage !== 'dispatch' && line.shipped_qty <= 0)) return undefined;
    const can = checklist.can;
    return {
      line,
      stage: checklistStage,
      editable: checklistStage === 'dispatch' ? can.pack : checklistStage === 'loadback' ? can.loadback : can.return,
      busy: checklistBusy.has(`line:${line.id}`),
      people: checklist.people,
      eventId,
      save: (fn, params) => runChecklist(`line:${line.id}`, fn, params),
    };
  };

  const fetchComponentReviewQueue = useCallback(async () => {
    if (!eventId) return;
    const { data, error } = await supabase
      .from('event_equipment_component_reviews')
      .select('id, equipment_id, source, equipment:equipment_items(name)')
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .order('created_at');
    if (error) {
      console.error('Error fetching component review queue:', error);
      return;
    }
    setComponentReviewQueue((data || []).map((row: any) => ({
      reviewId: row.id,
      equipmentId: row.equipment_id,
      name: (Array.isArray(row.equipment) ? row.equipment[0]?.name : row.equipment?.name) || 'Sprzęt',
      source: row.source,
    })));
  }, [eventId]);

  useEffect(() => {
    fetchComponentReviewQueue();
  }, [fetchComponentReviewQueue]);

  // Sprawdzenie czy są nierozwiązane konflikty
  const [hasUnresolvedConflicts, setHasUnresolvedConflicts] = useState(false);

  const markChecklistAsModified = async () => {
    setLocalChecklistModified(true);

    if (!eventId) return;

    try {
      await supabase
        .from('events')
        .update({ equipment_checklist_modified: true })
        .eq('id', eventId);
    } catch (err) {
      console.error('Error marking checklist as modified:', err);
    }
  };

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

  // Sprawdź czy jest zaakceptowana kalkulacja i pobierz elementy spoza magazynu
  // (pozycje sprzętowe bez cen przez get_event_calculation_equipment — także dla magazynu bez obszaru „kwoty”).
  const fetchAcceptedCalculation = useCallback(async () => {
    if (!eventId) return;

    try {
      const { calculationId, items } = await loadCalculationEquipment(eventId);

      if (!calculationId) {
        setAcceptedCalcId(null);
        setExternalItems([]);
        return;
      }

      setAcceptedCalcId(calculationId);

      if (!items) return;

      // Elementy spoza magazynu: source !== 'warehouse' i brak source_ref do equipment
      const external = items.filter((item: any) => item.source !== 'warehouse' && !item.source_ref);

      setExternalItems(
        external.map((item: any) => ({
          name: item.name,
          quantity: item.quantity,
          unit: item.unit || 'szt.',
          description: item.description || '',
        })),
      );
    } catch (err) {
      console.error('Error fetching accepted calculation:', err);
    }
  }, [eventId]);

  useEffect(() => {
    fetchAcceptedCalculation();
  }, [fetchAcceptedCalculation]);

  // Tracking PDF checklisty
  const checklistPdfPath = event?.equipment_checklist_pdf_path || null;
  const checklistModified = Boolean(event?.equipment_checklist_modified || localChecklistModified);

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

  const equipmentRevision = useMemo(
    () =>
      (equipment || [])
        .map((row: any) =>
          [
            row.id,
            row.equipment_id,
            row.kit_id,
            row.cable_id,
            Number(row.quantity || 0),
            row.status || '',
            row.removed_from_offer ? 'removed' : 'active',
          ].join(':'),
        )
        .sort()
        .join('|'),
    [equipment],
  );

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
        await markChecklistAsModified();
      }
      return;
    }

    // Błąd (np. pozycja już wydana z magazynu) pokazuje removeEquipment komunikatem z bazy.
    const result = await removeEquipment(row.id);

    if (result) {
      await refetch();
      await fetchAvailableEquipment();
      await markChecklistAsModified();
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
      await markChecklistAsModified();
    }
  };

  const handleUpdateQuantity = async (rowId: string, newQty: number, maxSet: number) => {
    const safe = Math.max(1, Math.min(newQty, maxSet));

    if (!Number.isInteger(newQty) || newQty < 1 || newQty > maxSet || safe !== newQty) {
      showSnackbar(`Maksymalnie możesz ustawić: ${maxSet} szt.`, 'error');
      return;
    }

    const ok = await updateEquipment(rowId, { quantity: safe });
    if (ok) {
      setEditingQuantityId(null);
      await refetch();
      await fetchAvailableEquipment();
      await markChecklistAsModified();
    }
  };

  const handleToggleExpandInChecklist = async (rowId: string, expand: boolean) => {
    const ok = await updateEquipment(rowId, { expand_kit_in_checklist: expand });
    if (ok) {
      await refetch();
      await markChecklistAsModified();
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

      if (!avail || finalQty > maxSet) {
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
    await markChecklistAsModified();
  };

  const enqueueComponentReviews = (
    selectedItems: SelectedItem[],
    source: 'manual' | 'import',
  ) => {
    const items = selectedItems
      .filter((item) => item.type === 'item')
      .map((item) => ({
        equipmentId: item.id,
        name: availableEquipment.find((equipmentItem: any) => equipmentItem.id === item.id)?.name ||
          'Sprzęt',
        source,
      }));

    setComponentReviewQueue((current) => {
      const existing = new Set(current.map((item) => item.equipmentId));
      return [...current, ...items.filter((item) => !existing.has(item.equipmentId))];
    });
  };

  const handleManualAddEquipment = async (selectedItems: SelectedItem[]) => {
    await handleAddEquipment(selectedItems);
    enqueueComponentReviews(selectedItems, 'manual');
    await fetchComponentReviewQueue();
  };

  const handleImportFromCalculation = async () => {
    if (!eventId || !acceptedCalcId) return;

    try {
      setImportingFromCalc(true);

      const { items } = await loadCalculationEquipment(eventId);

      if (!items || items.length === 0) {
        showSnackbar('Brak pozycji sprzętowych w kalkulacji', 'info');
        return;
      }

      const warehouseItems = items.filter(
        (item: any) => item.source === 'warehouse' && item.source_ref,
      );

      if (warehouseItems.length === 0) {
        showSnackbar('Kalkulacja nie zawiera pozycji z magazynu do zaimportowania', 'info');
        return;
      }

      const equipmentIds = warehouseItems.map((item: any) => item.source_ref).filter(Boolean);

      const { data: equipmentCheck } = await supabase
        .from('equipment_items')
        .select('id, name')
        .in('id', equipmentIds);

      const { data: kitCheck } = await supabase
        .from('equipment_kits')
        .select('id, name')
        .in('id', equipmentIds);

      const validItems = new Map((equipmentCheck ?? []).map((e: any) => [e.id, e.name]));
      const validKits = new Map((kitCheck ?? []).map((k: any) => [k.id, k.name]));

      const toAdd: SelectedItem[] = [];

      for (const calcItem of warehouseItems) {
        const ref = calcItem.source_ref;
        if (!ref) continue;

        if (validItems.has(ref)) {
          toAdd.push({
            id: ref,
            type: 'item',
            quantity: Number(calcItem.quantity) || 1,
            notes: '',
          });
        } else if (validKits.has(ref)) {
          toAdd.push({ id: ref, type: 'kit', quantity: Number(calcItem.quantity) || 1, notes: '' });
        }
      }

      if (toAdd.length === 0) {
        showSnackbar('Nie znaleziono sprzętu z magazynu do dodania', 'info');
        return;
      }

      const merged = mergeSameSelections(toAdd);

      const existingMap = buildExistingMap(equipment);
      const toInsert: SelectedItem[] = [];
      const toUpdate: Array<{ rowId: string; newQty: number }> = [];
      const conflicts: Array<{
        name: string;
        quantity: number;
        available: number;
        equipmentId: string;
        type: 'item' | 'kit';
      }> = [];
      let alreadyUpToDate = 0;

      for (const s of merged) {
        const k = keyOf(s.type as ItemType, s.id) as AvailKey;
        const existingRow = existingMap.get(k);
        const avail = (availabilityByKey as Record<string, AvailabilityUI> | undefined)?.[k];
        const { maxSet } = getUiLimits(avail);

        const currentQty = Number(existingRow?.quantity ?? 0);
        const targetQty = s.quantity;

        const itemName =
          (s.type === 'item' ? validItems.get(s.id) : validKits.get(s.id)) || 'Nieznany';

        if (existingRow && currentQty >= targetQty) {
          alreadyUpToDate++;
          continue;
        }

        if (avail && maxSet > 0 && targetQty > maxSet) {
          const availableQty = Math.max(0, maxSet);
          conflicts.push({
            name: itemName,
            quantity: targetQty,
            available: availableQty,
            equipmentId: s.id,
            type: s.type as 'item' | 'kit',
          });

          if (availableQty > currentQty) {
            if (!existingRow) {
              toInsert.push({ ...s, quantity: availableQty });
            } else {
              toUpdate.push({ rowId: existingRow.id, newQty: availableQty });
            }
          }
        } else {
          if (!existingRow) {
            toInsert.push(s);
          } else {
            toUpdate.push({ rowId: existingRow.id, newQty: targetQty });
          }
        }
      }

      let addedCount = 0;

      if (toInsert.length === 0 && toUpdate.length === 0 && conflicts.length === 0) {
        showSnackbar(
          `Sprzęt jest już zsynchronizowany z kalkulacją (${alreadyUpToDate} pozycji aktualnych)`,
          'info',
        );
        return;
      }

      if (toInsert.length) {
        const ok = await addEquipment(toInsert);
        if (!ok) {
          showSnackbar('Błąd podczas dodawania sprzętu z kalkulacji', 'error');
          return;
        }
        addedCount += toInsert.length;
      }

      for (const u of toUpdate) {
        await updateEquipment(u.rowId, { quantity: u.newQty });
        addedCount++;
      }

      await refetch();
      await fetchAvailableEquipment();
      await markChecklistAsModified();

      enqueueComponentReviews(merged, 'import');
      const importedEquipmentIds = merged
        .filter((item) => item.type === 'item')
        .map((item) => item.id);
      if (importedEquipmentIds.length > 0) {
        await supabase
          .from('event_equipment_component_reviews')
          .update({ source: 'import', updated_at: new Date().toISOString() })
          .eq('event_id', eventId)
          .in('equipment_id', importedEquipmentIds)
          .eq('status', 'pending');
      }
      await fetchComponentReviewQueue();

      if (conflicts.length > 0) {
        setImportConflicts(conflicts);
        setResolvedConflictIndices(new Set());
        showSnackbar(
          `Zsynchronizowano ${addedCount} pozycji, ale ${conflicts.length} ma niewystarczający stan magazynowy`,
          'warning',
        );
      } else {
        const parts: string[] = [];
        if (toInsert.length) parts.push(`${toInsert.length} dodano`);
        if (toUpdate.length) parts.push(`${toUpdate.length} zaktualizowano`);
        if (alreadyUpToDate) parts.push(`${alreadyUpToDate} bez zmian`);
        showSnackbar(`Zsynchronizowano z kalkulacją: ${parts.join(', ')}`, 'success');
      }
    } catch (err: any) {
      console.error('Error importing from calculation:', err);
      showSnackbar(err.message || 'Błąd podczas importu z kalkulacji', 'error');
    } finally {
      setImportingFromCalc(false);
    }
  };

  const handleReplaceExternalItem = (idx: number) => {
    setReplacingExternalIdx(idx);
    setShowAddEquipmentModal(true);
  };

  const handleAddEquipmentWithExternalResolve = async (selectedItems: SelectedItem[]) => {
    await handleAddEquipment(selectedItems);

    if (replacingExternalIdx !== null) {
      setResolvedExternalIndices((prev) => {
        const next = new Set(prev);
        next.add(replacingExternalIdx);
        return next;
      });
      setReplacingExternalIdx(null);
    }
  };

  const handleMarkExternalAsUwagi = (idx: number) => {
    setResolvedExternalIndices((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    showSnackbar('Pozycja zostanie dodana do uwag w checkliście', 'info');
  };

  const unresolvedExternalItems = useMemo(
    () => externalItems.filter((_, idx) => !resolvedExternalIndices.has(idx)),
    [externalItems, resolvedExternalIndices],
  );

  const handleResolveConflictWithAlternative = (idx: number) => {
    const conflict = importConflicts[idx];
    if (!conflict) return;

    setReplacingConflictIdx(idx);
    const deficit = Math.max(1, conflict.quantity - conflict.available);
    setAlternativeQuantity(deficit);
    const row = {
      equipment_id: conflict.type === 'item' ? conflict.equipmentId : null,
      kit_id: conflict.type === 'kit' ? conflict.equipmentId : null,
      equipment:
        conflict.type === 'item' ? { id: conflict.equipmentId, name: conflict.name } : null,
      kit: conflict.type === 'kit' ? { id: conflict.equipmentId, name: conflict.name } : null,
      _conflictDeficit: deficit,
    };
    setCurrentItemForReplacement(row);
    handleSuggestAlternative(row);
  };

  const handleResolveConflictWithRental = (idx: number) => {
    const conflict = importConflicts[idx];
    if (!conflict) return;

    const row = {
      id: conflict.equipmentId,
      equipment_id: conflict.type === 'item' ? conflict.equipmentId : null,
      kit_id: conflict.type === 'kit' ? conflict.equipmentId : null,
      equipment:
        conflict.type === 'item' ? { id: conflict.equipmentId, name: conflict.name } : null,
      kit: conflict.type === 'kit' ? { id: conflict.equipmentId, name: conflict.name } : null,
      item_name: conflict.name,
      quantity: conflict.quantity,
    };
    handleMarkAsRental(row);
    setResolvedConflictIndices((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };

  const handleDismissConflict = (idx: number) => {
    setResolvedConflictIndices((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    showSnackbar('Konflikt oznaczony jako rozwiązany', 'info');
  };

  // Wydanie, po wydarzeniu i zwrot: EquipmentChecklistBar + stan w wierszach (RPC checklisty — pól events.loading_* nie zapisuje się
  // bezpośrednio, strażnik a_guard_event_loading_fields). is_loaded = pozycja spakowana w całości (PDF, dawna lista).
  const loadedCount = equipment.filter((r: any) => r.is_loaded && !r.removed_from_offer).length;
  const totalCount = equipment.filter((r: any) => !r.removed_from_offer).length;

  const checklistFileName = (suffix = '') => {
    const name = String(event?.name || 'wydarzenie').normalize('NFC')
      .replace(/[^\p{L}\p{N}._ -]/gu, '-')
      .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[. -]+|[. -]+$/g, '')
      .slice(0, 100) || 'wydarzenie';
    return `checklista-sprzętu-${name}${suffix ? `-${suffix}` : ''}.pdf`;
  };

  const handleGenerateChecklist = async () => {
    if (checklistNotesDirty) {
      showSnackbar('Zapisz notatki przed wygenerowaniem checklisty.', 'warning');
      return;
    }
    if (generatingPdf) return;
    if (!eventId || !equipment || equipment.length === 0) {
      showSnackbar('Brak sprzętu do wygenerowania checklisty', 'error');
      return;
    }

    try {
      setGeneratingPdf(true);

      // Keep the saved PDF until its replacement is successfully stored.

      // Read loading marks at generation time, including changes made on a phone.
      const { data: loadingRows, error: loadingError } = await supabase
        .from('event_equipment').select('id,is_loaded').eq('event_id', eventId);
      if (loadingError) throw new Error('Nie udało się pobrać aktualnego stanu załadunku.');
      const loadedById = new Map((loadingRows || []).map((row) => [row.id, row.is_loaded === true]));
      const equipmentData = (equipment as any[])
        .filter((row) => !row?.removed_from_offer)
        .map((row) => {
          const d = getEventEquipmentDisplay(row);

          // ✅ klucz: zawartość kitu tylko gdy expand_kit_in_checklist
          const expand = !!row?.expand_kit_in_checklist;
          const kitItems = expand ? extractKitItemsFromRow(row) : [];

          return {
            order: equipmentRowOrderKey(row),
            data: {
              is_loaded: loadedById.get(row.id) === true,
              name: d.name,
              brand: d.brand,
              model: d.model,
              quantity: Number(row?.quantity),
              category: d.categoryName,
              cable_length: d.cableLength,
              is_kit: d.isKit,
              expand_kit_in_checklist: expand,
              kit_items: kitItems,
            },
          };
        })
        .sort((a, b) => compareEquipmentOrder(a.order, b.order))
        .map((item) => item.data);

      const eventDateFormatted = new Date(eventDate).toLocaleDateString('pl-PL');

      const resolveChecklistCompanyLogo = async (): Promise<string | null> => {
        const { data: company, error: companyError } = await supabase
          .from('my_companies')
          .select('id, name')
          .eq('id', CHECKLIST_COMPANY_ID)
          .maybeSingle();
        if (companyError) throw new Error('Nie udało się odczytać brandbooka Mavinci. Odśwież stronę i spróbuj ponownie.');
        if (!company) throw new Error('Brak dostępu do firmowych ustawień Mavinci wymaganych do wydruku checklisty.');

        const { data: logos, error: logosError } = await supabase
          .from('company_brandbook_logos')
          .select('url, label, variant, is_default, order_index')
          .eq('company_id', company.id)
          .order('is_default', { ascending: false })
          .order('order_index', { ascending: true });
        if (logosError) throw new Error('Nie udało się pobrać logotypów Mavinci. Sprawdź dostęp do brandbooka i ponów wydruk.');

        const normalizeLogoKey = (value: string | null | undefined) =>
          (value || '').trim().toLowerCase().replace(/\.(svg|png|webp|jpe?g)$/i, '')
            .replace(/[\s_]+/g, '-');
        // The default logo may be white/gold and is unsuitable for white paper.
        const printLogo = logos?.find((logo) => normalizeLogoKey(logo.label) === 'logo-horizontal-black')
          || logos?.find((logo) => normalizeLogoKey(logo.variant) === 'logo-horizontal-black');
        const rawLogo = printLogo?.url;
        if (!rawLogo) {
          throw new Error('W brandbooku Mavinci dodaj logo o nazwie logo-horizontal-black. Checklista zawsze używa marki Mavinci, niezależnie od marki wydarzenia.');
        }

        const publicUrl = /^https?:\/\//i.test(rawLogo) || rawLogo.startsWith('data:')
          ? rawLogo
          : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${rawLogo.replace(/^\/+/, '')}`;

        if (publicUrl.startsWith('data:')) return publicUrl;

        try {
          const response = await fetch(publicUrl);
          if (!response.ok) return publicUrl;
          if (!response.ok) throw new Error('Nie udało się pobrać pliku checklisty');
        const blob = await response.blob();
          const buffer = await blob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buffer).reduce(
              (result, byte) => result + String.fromCharCode(byte),
              '',
            ),
          );
          return `data:${blob.type || 'image/png'};base64,${base64}`;
        } catch {
          return publicUrl;
        }
      };

      const companyLogoUrl = await resolveChecklistCompanyLogo();

      // ✅ Pobierz dane kontaktu w zależności od typu klienta
      let contactName = contact?.full_name || '-';
      let contactPhone = contact?.phone || '-';

      const { data: checklistNotesRow, error: checklistNotesError } = await supabase
        .from('events').select('equipment_checklist_notes,equipment_checklist_note_items').eq('id', eventId).single();
      if (checklistNotesError) throw new Error('Nie udało się pobrać notatek do checklisty.');
      const html = buildEquipmentChecklistHtml({
        checklistNotes: checklistNotesRow?.equipment_checklist_notes,
        checklistNoteItems: checklistNotesRow?.equipment_checklist_note_items,
        eventName: event?.name || 'Wydarzenie',
        eventDate: eventDateFormatted,
        location: location,
        equipmentItems: equipmentData,
        authorName: employee?.name + ' ' + employee?.surname || '-',
        authorNumber: (employee as any)?.phone_number || '-',
        contactName,
        contactPhone,
        companyLogoUrl,
        externalItems: unresolvedExternalItems.length > 0 ? unresolvedExternalItems : undefined,
      });

      const { default: html2pdf } = await import('html2pdf.js');
      const html2pdfFn: any = (html2pdf as any) || html2pdf;

      // ✅ ważne: w html2pdf najlepiej przekazać element, nie “div wrapper”
      const printDocument = new DOMParser().parseFromString(html, 'text/html');
      const printRoot = printDocument.getElementById('equipment-checklist-print');
      const printStyles = printDocument.querySelector('style[data-equipment-checklist-styles]');
      if (!printRoot || !printStyles) throw new Error('Nie udało się przygotować wyglądu checklisty.');
      const element = document.importNode(printRoot, true);
      element.prepend(document.importNode(printStyles, true));

      const opt: any = {
        margin: [10, 10, 15, 10],
        filename: checklistFileName(),
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          onclone: async (clonedDocument: Document) => {
            // Only the disposable html2canvas clone is changed, never the CRM page.
            clonedDocument.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
              if (!node.hasAttribute('data-equipment-checklist-styles')) node.remove();
            });
            clonedDocument.documentElement.removeAttribute('class');
            clonedDocument.body.removeAttribute('class');
            clonedDocument.body.style.background = '#ffffff';
            clonedDocument.body.style.color = '#111827';
            await clonedDocument.fonts.ready;
            const logos = Array.from(clonedDocument.querySelectorAll<HTMLImageElement>(
              '#equipment-checklist-print img',
            ));
            await Promise.all(logos.map((logo) => logo.decode().catch(() => {
              throw new Error('Nie udało się wczytać logo logo-horizontal-black. Spróbuj ponownie.');
            })));
          },
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },

        // ✅ to jest kluczowe przy "nie tnij wierszy"
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr.row', '.checklist-note-record', '.signatures', '.notes-acknowledgement'] },
      };

      const worker = html2pdfFn().from(element).set(opt).toPdf();
      // Number actual PDF pages after natural pagination, including overflow notes.
      const pdf = await worker.get('pdf');
      const pageCount = pdf.internal.getNumberOfPages();
      for (let page = 1; page <= pageCount; page++) {
        pdf.setPage(page);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(70, 70, 70);
        pdf.text(`Strona ${page} / ${pageCount}`, 200, 290, { align: 'right' });
      }
      const pdfBlob: Blob = await worker.output('blob');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const fileName = checklistFileName(timestamp);
      // Storage keys remain ASCII; the displayed and downloaded name preserves Unicode.
      const storagePath = `${eventId}/checklista-${timestamp}-${crypto.randomUUID()}.pdf`;

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

      const { error: fileRecordError } = await supabase.from('event_files').insert([
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

      if (fileRecordError) throw fileRecordError;

      // Zapisz ścieżkę PDF w tabeli events
      const { error: eventUpdateError } = await supabase
        .from('events')
        .update({
          equipment_checklist_pdf_path: storagePath,
          equipment_checklist_pdf_at: new Date().toISOString(),
          equipment_checklist_modified: false,
        })
        .eq('id', eventId);

      if (eventUpdateError) throw eventUpdateError;

      // Remove the previous version only after the new file and event link are saved.
      if (checklistPdfPath && checklistPdfPath !== storagePath) {
        try {
          const { error: removeError } = await supabase.storage.from('event-files').remove([checklistPdfPath]);
          if (removeError) throw removeError;
          const { error: recordError } = await supabase.from('event_files')
            .delete().eq('event_id', eventId).eq('file_path', checklistPdfPath);
          if (recordError) throw recordError;
        } catch (error) {
          console.warn('Nie udało się usunąć poprzedniej wersji checklisty:', error);
        }
      }

      // Odśwież dane wydarzenia
      await refetchEvent();

      showSnackbar(
        'Checklista sprzętu została wygenerowana i zapisana w zakładce Pliki',
        'success',
      );

      await worker.save();
    } catch (error) {
      console.error('Error generating checklist:', error);
      showSnackbar(error instanceof Error ? error.message : 'Błąd podczas generowania checklisty', 'error');
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
        setPdfPreviewUrl(data.signedUrl);
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
        const { data: fileRecord, error: nameError } = await supabase.from('event_files')
          .select('name,original_name').eq('event_id', eventId).eq('file_path', checklistPdfPath).maybeSingle();
        if (nameError) console.warn('Nie udało się pobrać nazwy checklisty:', nameError);
        link.download = fileRecord?.original_name || fileRecord?.name || checklistFileName();
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

  // Po wydarzeniu i Zwrot: tylko pozycje wydane z magazynu.
  // Jedna kolejność wszędzie (CRM, Mac, telefon, PDF): zestawy, sprzęt, przewody; kategoria, nazwa.
  const stageEquipment = useMemo(
    () => [...(shippedOnly ? (equipment || []).filter((row: any) => (checklistLines.get(row.id)?.shipped_qty ?? 0) > 0) : equipment || [])]
      .sort((a: any, b: any) => compareEquipmentOrder(equipmentRowOrderKey(a), equipmentRowOrderKey(b))),
    [equipment, shippedOnly, checklistLines],
  );
  const notShippedCount = shippedOnly ? (checklist?.lines ?? []).filter((line) => line.shipped_qty <= 0).length : 0;

  const visibleEquipment = useMemo(() => {
    const normalize = (value: string) => value.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
    const terms = normalize(equipmentSearch).trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return stageEquipment;
    return stageEquipment.filter((row: any) => {
      const asset = row.equipment || row.equipment_items || row.cable || row.cables || row;
      const kit = row.kit || row.equipment_kits;
      const text = normalize([
        asset.name, asset.brand, asset.manufacturer, asset.model, kit?.name,
        ...extractKitItemsFromRow(row).flatMap(item => [item.name, item.brand, item.model]),
      ].filter(value => typeof value === 'string').join(' '));
      return terms.every(term => text.includes(term));
    });
  }, [stageEquipment, equipmentSearch]);

  const manualKitRows = useMemo(
    () => visibleEquipment.filter((r: any) => !r.auto_added && isKitRow(r)),
    [visibleEquipment],
  );
  const autoKitRows = useMemo(
    () => visibleEquipment.filter((r: any) => r.auto_added && isKitRow(r)),
    [visibleEquipment],
  );

  const manualItemRows = useMemo(
    () =>
      visibleEquipment.filter(
        (r: any) => !r.auto_added && !isKitRow(r) && !isCableRow(r),
      ),
    [visibleEquipment],
  );
  const autoItemRows = useMemo(
    () =>
      visibleEquipment.filter(
        (r: any) => r.auto_added && !isKitRow(r) && !isCableRow(r),
      ),
    [visibleEquipment],
  );
  const manualCableRows = useMemo(
    () => visibleEquipment.filter((r: any) => !r.auto_added && isCableRow(r)),
    [visibleEquipment],
  );
  const autoCableRows = useMemo(
    () => visibleEquipment.filter((r: any) => r.auto_added && isCableRow(r)),
    [visibleEquipment],
  );

  const renderKitRow = (row: any, editable: boolean) => {
    const isExpanded = expandedKits.has(row.id);

    const kitName = row?.kit?.name || row?.equipment_kits?.name || row?.name || 'Zestaw';

    const kitThumb = row?.kit?.thumbnail_url || row?.equipment_kits?.thumbnail_url || '';

    const key = getKeyForEventRow(row); // "kit-<id>"
    const avail = (availabilityByKey as any)?.[key as AvailKey];
    const limits = getUiLimits(avail);
    const qty = Number(row?.quantity);
    const hasConflict = avail && avail.max_add < 0;
    const badge = getStatusBadge(row?.status, hasConflict);

    const expandInPrint = !!row?.expand_kit_in_checklist;
    const kitChecklist = checklistRowFor(row);
    const kitDone = isEquipmentRowDone(kitChecklist);
    const kitTint = kitChecklist ? equipmentRowTint(kitChecklist.line, kitChecklist.stage) : '';

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
        <div className={`flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 ${kitTint || 'bg-[#0f1119]'} px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20`}>
          {kitChecklist && <EquipmentRowTick {...kitChecklist} />}
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
                    <NextImage
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
                  <NextImage
                    src={kitThumb ?? ''}
                    alt={kitName}
                    width={400}
                    height={400}
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
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={`truncate font-medium ${kitDone ? 'text-[#e5e4e2]/50 line-through decoration-[#e5e4e2]/40' : 'text-[#e5e4e2]'}`}
                >
                  {kitName}
                </span>

                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${badge.cls}`}
                >
                  {badge.label}
                </span>
                {kitChecklist && <EquipmentRowBadges {...kitChecklist} />}
              </div>

              {editable && <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#e5e4e2]/50">
                <span>
                  możesz dodać jeszcze <span className="text-[#d3bb73]">{limits.maxAdd}</span>
                </span>
                <span>•</span>
                <span>
                  max ustawienia <span className="text-[#d3bb73]">{limits.maxSet}</span>
                </span>
              </div>}
              {kitChecklist && <EquipmentRowNote {...kitChecklist} />}
            </div>
          </div>

          {/* ilość (+ ilość z checklisty etapu) */}
          <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/40">
            {kitChecklist && <EquipmentRowQtyChip {...kitChecklist} />}
            {editable && editingQuantityId === row.id ? (
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
                  max={limits.maxSet}
                  value={draftQuantity}
                  onChange={(e) => setDraftQuantity(Number(e.target.value))}
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
          </div>

          {/* trash (po wydaniu lista jest zablokowana — zostaje tylko wydruk zawartości) */}
          <div className="flex items-center gap-2 rounded-lg p-2 pt-2 text-red-400/60 transition-colors hover:bg-red-400/10 hover:text-red-400">
              <ResponsiveActionBar
                disabledBackground
                actions={[
                  ...(editable
                    ? [
                        {
                          label: 'Usuń zestaw',
                          onClick: () => handleRemoveEquipment(row),
                          icon: <Trash2 className="h-4 w-4" />,
                          variant: 'danger' as const,
                        },
                      ]
                    : []),
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
                const perKit = Number(it?.quantity);

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
    setCurrentRowForRental(row);
    setShowRentalModal(true);
  };

  const handleSelectRentalEquipment = async (
    subcontractorId: string,
    equipmentId: string,
    equipmentName: string,
    subcontractorName: string,
  ) => {
    if (!currentRowForRental) return;

    try {
      const row = currentRowForRental;

      // Update event_equipment with rental info
      const { error: eventEqError } = await supabase
        .from('event_equipment')
        .update({
          use_external_rental: true,
          status: 'rental',
          is_optional: false,
          auto_added: false,
          rental_subcontractor_id: subcontractorId,
          rental_equipment_id: equipmentId,
          notes: `Wynajem od: ${subcontractorName} - ${equipmentName}`,
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

      // Create subcontractor task with rental equipment reference
      if (eventId) {
        const { error: taskError } = await supabase.from('subcontractor_tasks').insert({
          event_id: eventId,
          subcontractor_id: subcontractorId,
          event_equipment_id: row.id,
          rental_equipment_id: equipmentId,
          task_type: 'equipment_rental',
          task_name: `Wynajem: ${equipmentName}`,
          description: `Wynajem od ${subcontractorName} - ${equipmentName} (${row.quantity || row.required_qty} szt.)`,
          status: 'planned',
          payment_type: 'fixed',
          fixed_price: 0,
          notes: 'Utworzone automatycznie z zakładki Sprzęt',
        });

        if (taskError) {
          console.warn('Nie udało się utworzyć zadania dla podwykonawcy:', taskError);
        }
      }

      showSnackbar(`Sprzęt oznaczony jako wynajem od ${subcontractorName}`, 'success');
      await refetch();
    } catch (err: any) {
      console.error('Error marking as rental:', err);
      showSnackbar(err.message || 'Błąd podczas oznaczania jako rental', 'error');
    }
  };

  const handleReplaceEquipment = async (alternativeId: string, qty?: number) => {
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

      const finalQty = qty || alternativeQuantity || 1;

      if (currentItemForReplacement.id) {
        const { error: updateError } = await supabase
          .from('event_equipment')
          .update({
            equipment_id: alternativeId,
            kit_id: null,
            status: 'reserved',
            is_optional: false,
            auto_added: false,
            quantity: finalQty,
            notes: `Zamieniono z: ${oldName} → ${newEquipment?.name || alternativeId}`,
          })
          .eq('id', currentItemForReplacement.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from('event_equipment').insert({
          event_id: eventId,
          equipment_id: alternativeId,
          kit_id: null,
          quantity: finalQty,
          status: 'reserved',
          is_optional: false,
          auto_added: false,
          notes: `Alternatywa dla: ${oldName} → ${newEquipment?.name || alternativeId}`,
        });

        if (insertError) throw insertError;
      }

      showSnackbar(
        `Sprzęt zamieniony: ${oldName} → ${newEquipment?.name} (${finalQty} szt.)`,
        'success',
      );
      setShowAlternativesModal(false);
      setAlternatives([]);
      setCurrentItemForReplacement(null);
      if (replacingConflictIdx !== null) {
        setResolvedConflictIndices((prev) => {
          const next = new Set(prev);
          next.add(replacingConflictIdx);
          return next;
        });
        setReplacingConflictIdx(null);
      }
      await refetch();
    } catch (err: any) {
      console.error('Error replacing equipment:', err);
      showSnackbar(err.message || 'Błąd podczas zamiany sprzętu', 'error');
    }
  };

  const handleSuggestAlternative = async (row: any) => {
    try {
      let currentEquipmentId = row?.equipment?.id || row?.equipment_id || row?.item_id || null;

      let warehouseCategoryId =
        row?.equipment?.warehouse_category_id || row?.warehouse_category_id || null;

      // Jeśli to kit, na razie nie obsługujemy alternatyw
      const rowItemType = row?.item_type || (row?.kit_id ? 'kit' : 'item');

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

          const avKey = `item-${alt.id}` as const;
          const avail = (availabilityByKey as Record<string, any>)?.[avKey];

          return {
            ...alt,
            total_qty: totalQty || 0,
            available_qty: availableQty || 0,
            reserved_qty: Math.max((totalQty || 0) - (availableQty || 0), 0),
            available_in_term: avail?.available_in_term ?? availableQty ?? 0,
            max_add: avail?.max_add ?? availableQty ?? 0,
          };
        }),
      );

      const message =
        searchLevel === 'main_category'
          ? `Znaleziono ${enrichedAlternatives.length} alternatyw z kategorii: ${parentCategoryName}`
          : `Znaleziono ${enrichedAlternatives.length} alternatyw`;

      showSnackbar(message, 'info');

      setAlternatives(enrichedAlternatives);
      setCurrentItemForReplacement(row);
      if (!row._conflictDeficit) {
        setAlternativeQuantity(Number(row.quantity) || 1);
      }
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
        equipmentRevision={equipmentRevision}
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
        canVerifyInventory={isAdmin}
        onComponentsAdded={async () => {
          await refetch();
          await fetchAvailableEquipment();
          await refetchEvent();
        }}
        checklist={checklistRowFor(row)}
        legacyLoadedBadge={showLegacyLoaded}
      />
    );
  };

  const actions = useMemo<Action[]>(() => {
    // Po zatwierdzeniu wydania lista jest zablokowana (zmiany tylko po cofnięciu etapu).
    const result: Action[] = checklistLocked
      ? []
      : [
          {
            label: 'Dodaj sprzęt',
            onClick: () => setShowAddEquipmentModal(true),
            icon: <Plus className="h-4 w-4" />,
            variant: 'primary',
          },
        ];

    if (acceptedCalcId && !checklistLocked) {
      result.push({
        label: importingFromCalc ? 'Importowanie...' : 'Importuj z kalkulacji',
        onClick: handleImportFromCalculation,
        icon: <Calculator className="h-4 w-4" />,
        variant: 'default',
        disabled: importingFromCalc,
      });
    }

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
      // Allow regeneration after changes to print styling or the brandbook too.
      result.push(
        {
          label: generatingPdf ? 'Generowanie...' : 'Regeneruj checklistę',
          onClick: handleGenerateChecklist,
          icon: <Printer className="h-4 w-4" />,
          variant: 'default',
          disabled: generatingPdf,
        },
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
    checklistLocked,
    setShowAddEquipmentModal,
    acceptedCalcId,
    importingFromCalc,
    handleImportFromCalculation,
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-light text-[#e5e4e2]">Sprzęt</h2>
          <div className="text-sm text-[#e5e4e2]/60">
            <span className="font-medium">Event Zawiera {equipment?.length} Pozycji</span>
          </div>
        </div>

        <div className="relative min-w-[220px] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
          <input
            type="search"
            aria-label="Wyszukaj sprzęt dodany do wydarzenia"
            placeholder="Szukaj sprzętu: nazwa, model, producent…"
            value={equipmentSearch}
            onChange={event => setEquipmentSearch(event.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-black/15 py-2 pl-9 pr-3 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:bg-black/20 focus:outline-none"
          />
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
                Event ma braki sprzętowe w terminie. Część sprzętu z oferty nie została dodana do
                eventu, ponieważ nie jest dostępna.
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

      {componentReviewQueue.length > 0 && (
        <div className="mb-6 rounded-lg border border-sky-500/20 bg-sky-500/5 p-4">
          <div className="mb-3 flex items-start gap-3">
            <Package className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
            <div>
              <h3 className="text-sm font-medium text-sky-300">
                Kolejka weryfikacji zestawów ({componentReviewQueue.length})
              </h3>
              <p className="mt-1 text-xs text-sky-300/70">
                Sprawdź elementy wymagane, rekomendowane i opcjonalne oraz ich dostępność przed zamknięciem
                listy sprzętu.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-sky-500/10 bg-[#0f1119]/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-[#e5e4e2]">
                {componentReviewQueue[0].name}
              </span>
              <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">
                {componentReviewQueue[0].source === 'manual' ? 'Dodano ręcznie' : 'Import'}
              </span>
            </div>
            <RequiredComponentsWarning
              equipmentId={componentReviewQueue[0].equipmentId}
              eventId={eventId}
              availabilityByKey={availabilityByKey}
              equipmentRevision={equipmentRevision}
              autoOpen={componentReviewQueue[0].source === 'manual'}
              canVerifyInventory={isAdmin}
              onComponentsAdded={async () => {
                await refetch();
                await fetchAvailableEquipment();
                await markChecklistAsModified();
              }}
              onReviewFinished={async (status) => {
                const review = componentReviewQueue[0];
                if (review.reviewId) {
                  await supabase
                    .from('event_equipment_component_reviews')
                    .update({
                      status,
                      reviewed_by: employee?.id || null,
                      reviewed_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', review.reviewId);
                }
                setComponentReviewQueue((queue) => queue.slice(1));
              }}
            />
          </div>
        </div>
      )}

      {externalItems.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Download className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-medium text-amber-300">
              Elementy spoza magazynu (z kalkulacji)
            </h3>
            {resolvedExternalIndices.size > 0 && (
              <span className="text-xs text-emerald-400">
                ({resolvedExternalIndices.size}/{externalItems.length} rozwiązane)
              </span>
            )}
          </div>
          <p className="mb-3 text-xs text-amber-300/70">
            Poniższe pozycje z zaakceptowanej kalkulacji nie pochodzą z magazynu. Zamień na sprzęt z
            magazynu lub oznacz jako uwagę w checkliście.
          </p>
          <div className="space-y-1.5">
            {externalItems.map((item, idx) => {
              const isResolved = resolvedExternalIndices.has(idx);

              return (
                <div
                  key={idx}
                  className={`flex items-center gap-2 rounded border px-3 py-2 ${
                    isResolved
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-amber-500/10 bg-[#1c1f33]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span
                      className={`text-sm ${isResolved ? 'text-[#e5e4e2]/50 line-through' : 'text-[#e5e4e2]'}`}
                    >
                      {item.name}
                    </span>
                    {item.description && (
                      <span className="ml-2 text-xs text-[#e5e4e2]/40">{item.description}</span>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-sm font-medium ${isResolved ? 'text-emerald-400' : 'text-amber-300'}`}
                  >
                    {item.quantity} {item.unit}
                  </span>
                  {isResolved ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <ResponsiveActionBar
                      disabledBackground
                      mobileBreakpoint={4000}
                      actions={[
                        {
                          label: 'Zamień na magazyn',
                          onClick: () => handleReplaceExternalItem(idx),
                          icon: <ArrowRightLeft className="h-4 w-4" />,
                          variant: 'primary',
                        },
                        {
                          label: 'Dodaj do uwag',
                          onClick: () => handleMarkExternalAsUwagi(idx),
                          icon: <FileText className="h-4 w-4" />,
                          variant: 'default',
                        },
                      ]}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {importConflicts.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <h3 className="text-sm font-medium text-red-300">
              Braki magazynowe (z importu kalkulacji)
            </h3>
            {resolvedConflictIndices.size > 0 && (
              <span className="text-xs text-emerald-400">
                ({resolvedConflictIndices.size}/{importConflicts.length} rozwiązane)
              </span>
            )}
          </div>
          <p className="mb-3 text-xs text-red-300/70">
            Poniższe pozycje z kalkulacji przekraczają dostępny stan magazynowy w wybranym terminie.
            Zaimportowano maksymalną dostępną ilość.
          </p>
          <div className="space-y-1.5">
            {importConflicts.map((conflict, idx) => {
              const isResolved = resolvedConflictIndices.has(idx);
              const deficit = conflict.quantity - conflict.available;

              return (
                <div
                  key={idx}
                  className={`flex items-center gap-2 rounded border px-3 py-2 ${
                    isResolved
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-red-500/10 bg-[#1c1f33]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span
                      className={`text-sm ${isResolved ? 'text-[#e5e4e2]/50 line-through' : 'text-[#e5e4e2]'}`}
                    >
                      {conflict.name}
                    </span>
                    {!isResolved && (
                      <span className="ml-2 text-xs text-red-300/70">
                        brakuje {deficit} szt. (potrzeba: {conflict.quantity}, dostępne:{' '}
                        {conflict.available})
                      </span>
                    )}
                  </div>
                  {isResolved ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <ResponsiveActionBar
                      disabledBackground
                      mobileBreakpoint={4000}
                      actions={[
                        {
                          label: 'Szukaj alternatywy',
                          onClick: () => handleResolveConflictWithAlternative(idx),
                          icon: <ArrowRightLeft className="h-4 w-4" />,
                          variant: 'primary',
                        },
                        {
                          label: 'Oznacz jako rental',
                          onClick: () => handleResolveConflictWithRental(idx),
                          icon: <Package className="h-4 w-4" />,
                          variant: 'default',
                        },
                        {
                          label: 'Zamknij',
                          onClick: () => handleDismissConflict(idx),
                          icon: <Check className="h-4 w-4" />,
                          variant: 'default',
                        },
                      ]}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === CHECKLISTA SPRZĘTU: etapy filtrują listę poniżej (wydanie → po wydarzeniu → zwrot) === */}
      <EquipmentChecklistBar
        eventId={eventId}
        state={checklistState}
        stage={checklistStage}
        onStageChange={setChecklistPick}
        legacy={{
          loaded: loadedCount,
          total: totalCount,
          confirmed: Boolean(event?.loading_confirmed),
          confirmedAt: event?.loading_confirmed_at ?? null,
        }}
      />

      {(equipment || []).length === 0 ? (
        <p className="text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
      ) : (
        <div className="space-y-5">
          {shippedOnly && (
            <p role="status" className="text-xs text-[#e5e4e2]/55">
              Pokazano {stageEquipment.length} wydanych pozycji · {notShippedCount} nie wydano
            </p>
          )}
          {equipmentSearch.trim() && (
            <p role="status" className="text-sm text-[#e5e4e2]/60">
              {visibleEquipment.length ? `Znaleziono pozycji: ${visibleEquipment.length} z ${stageEquipment.length}` : 'Brak sprzętu pasującego do wyszukiwania.'}
            </p>
          )}
          {manualItemRows.length + autoItemRows.length > 0 && (
            <section className="space-y-3 rounded-xl border border-[#d3bb73]/10 bg-[#0f1119]/25 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-[#e5e4e2]">Pojedynczy sprzęt</h3>
                  <p className="mt-0.5 text-xs text-[#e5e4e2]/45">
                    Samodzielne urządzenia rezerwowane na wydarzenie
                  </p>
                </div>
                <span className="rounded-full bg-[#e5e4e2]/5 px-2.5 py-1 text-xs text-[#e5e4e2]/50">
                  {manualItemRows.length + autoItemRows.length}
                </span>
              </div>

              {manualItemRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-[#e5e4e2]/35">
                    Dodane bezpośrednio
                  </div>
                  {manualItemRows.map((row: any) => renderRow(row, !checklistLocked))}
                </div>
              )}
              {autoItemRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-[#d3bb73]/55">
                    Z oferty / importu
                  </div>
                  {autoItemRows.map((row: any) => renderRow(row, !checklistLocked))}
                </div>
              )}
            </section>
          )}

          {manualKitRows.length + autoKitRows.length > 0 && (
            <section className="space-y-3 rounded-xl border border-sky-500/15 bg-sky-500/[0.025] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-[#e5e4e2]">Zestawy sprzętowe</h3>
                  <p className="mt-0.5 text-xs text-[#e5e4e2]/45">
                    Gotowe komplety z możliwością rozwinięcia zawartości
                  </p>
                </div>
                <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-xs text-sky-300/70">
                  {manualKitRows.length + autoKitRows.length}
                </span>
              </div>

              {manualKitRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-[#e5e4e2]/35">
                    Dodane bezpośrednio
                  </div>
                  {manualKitRows.map((row: any) => renderKitRow(row, !checklistLocked))}
                </div>
              )}
              {autoKitRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-sky-300/50">
                    Z oferty / importu
                  </div>
                  {autoKitRows.map((row: any) => renderKitRow(row, !checklistLocked))}
                </div>
              )}
            </section>
          )}

          {manualCableRows.length + autoCableRows.length > 0 && (
            <section className="space-y-3 rounded-xl border border-violet-500/15 bg-violet-500/[0.025] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-[#e5e4e2]">Przewody i okablowanie</h3>
                  <p className="mt-0.5 text-xs text-[#e5e4e2]/45">
                    Pozycje magazynowe rozliczane w sztukach lub metrach
                  </p>
                </div>
                <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs text-violet-300/70">
                  {manualCableRows.length + autoCableRows.length}
                </span>
              </div>

              {manualCableRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-[#e5e4e2]/35">
                    Dodane bezpośrednio
                  </div>
                  {manualCableRows.map((row: any) => renderRow(row, !checklistLocked))}
                </div>
              )}
              {autoCableRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-violet-300/50">
                    Z oferty / importu
                  </div>
                  {autoCableRows.map((row: any) => renderRow(row, !checklistLocked))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <div className="mt-6">
      <EquipmentChecklistNotes key={eventId} eventId={eventId} onDirtyChange={setChecklistNotesDirty}
        onSaved={() => { setLocalChecklistModified(true); void refetchEvent(); showSnackbar('Notatki do checklisty zapisane', 'success'); }} />
      </div>

      {showAddEquipmentModal && (
        <AddEquipmentModal
          isOpen={showAddEquipmentModal}
          onClose={() => {
            setShowAddEquipmentModal(false);
            setReplacingExternalIdx(null);
          }}
          onAdd={
            replacingExternalIdx !== null
              ? handleAddEquipmentWithExternalResolve
              : handleManualAddEquipment
          }
          availableEquipment={availableEquipment}
          availableKits={availableKits}
          availabilityByKey={availabilityByKey}
        />
      )}

      {showAlternativesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-3xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium text-[#e5e4e2]">Wybierz alternatywny sprzęt</h3>
              <button
                onClick={() => {
                  setShowAlternativesModal(false);
                  setAlternatives([]);
                  setCurrentItemForReplacement(null);
                  setReplacingConflictIdx(null);
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
                  {currentItemForReplacement?._conflictDeficit && (
                    <span className="ml-2 text-[#e5e4e2]/50">
                      (brakuje {currentItemForReplacement._conflictDeficit} szt.)
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mb-3 flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
              <span className="text-sm text-[#e5e4e2]/60">Ilość:</span>
              <input
                type="number"
                min={1}
                value={alternativeQuantity}
                onChange={(e) => setAlternativeQuantity(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 rounded-md border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1.5 text-center text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50"
              />
              <span className="text-xs text-[#e5e4e2]/40">szt.</span>
            </div>

            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {alternatives.map((alt) => {
                const termAvail = alt.available_in_term ?? alt.available_qty ?? 0;
                const isAvailable = termAvail >= alternativeQuantity;
                return (
                  <div
                    key={alt.id}
                    className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                      isAvailable
                        ? 'border-[#d3bb73]/10 bg-[#0f1119] hover:border-[#d3bb73]/30'
                        : 'border-red-500/20 bg-red-500/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {alt.thumbnail_url ? (
                        <NextImage
                          src={alt.thumbnail_url}
                          alt={alt.name}
                          className="h-12 w-12 rounded border border-[#d3bb73]/20 object-cover"
                          width={400}
                          height={400}
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
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span className={termAvail > 0 ? 'text-green-400' : 'text-red-400'}>
                            Dostępne w terminie: {termAvail} szt.
                          </span>
                          <span className="text-[#e5e4e2]/30">•</span>
                          <span className="text-[#e5e4e2]/40">Ogółem: {alt.total_qty} szt.</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleReplaceEquipment(alt.id, alternativeQuantity)}
                      disabled={!isAvailable}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        isAvailable
                          ? 'bg-[#d3bb73] text-[#1c1f33] hover:bg-[#d3bb73]/90'
                          : 'cursor-not-allowed bg-[#e5e4e2]/10 text-[#e5e4e2]/30'
                      }`}
                    >
                      {isAvailable ? 'Wybierz' : 'Niedostępne'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal wyboru rentalu */}
      <SelectRentalEquipmentModal
        isOpen={showRentalModal}
        onClose={() => {
          setShowRentalModal(false);
          setCurrentRowForRental(null);
        }}
        onSelect={handleSelectRentalEquipment}
        currentEquipmentName={
          currentRowForRental?.equipment?.name ||
          currentRowForRental?.equipment_items?.name ||
          currentRowForRental?.kit?.name ||
          currentRowForRental?.item_name
        }
        warehouseCategoryId={
          currentRowForRental?.equipment?.warehouse_category_id ||
          currentRowForRental?.equipment_items?.warehouse_category_id ||
          null
        }
      />

      {pdfPreviewUrl && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/80 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#0f1119] px-6 py-4">
            <h3 className="text-lg font-light text-[#e5e4e2]">Podgląd checklisty PDF</h3>
            <div className="flex items-center gap-3">
              <a
                href={pdfPreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-[#d3bb73]/30 px-3 py-1.5 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
              >
                Otwórz w nowej karcie
              </a>
              <button
                onClick={() => setPdfPreviewUrl(null)}
                className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 p-4">
            <iframe
              src={pdfPreviewUrl}
              title="Checklista sprzętu PDF"
              className="h-full w-full rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
};
