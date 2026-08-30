'use client';

import { useState, useEffect } from 'react';
import {
  Package,
  AlertTriangle,
  X,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  CalendarClock,
  MinusCircle,
  Minus,
  Plus,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import Image from 'next/image';

interface RequiredComponent {
  id: string;
  compatible_equipment_id: string | null;
  compatible_kit_id: string | null;
  compatible_cable_id: string | null;
  compatibility_type: string;
  compatibility_group: string | null;
  quantity: number;
  quantity_mode: 'per_item' | 'fixed';
  existing_quantity?: number;
  compatible_equipment?: {
    id: string;
    name: string;
    model?: string;
    brand?: string;
    thumbnail_url?: string | null;
  };
  compatible_kit?: {
    id: string;
    name: string;
    description?: string;
    thumbnail_url?: string | null;
  };
  compatible_cable?: {
    id: string;
    name: string;
    description?: string;
    length_meters?: number;
    stock_unit?: 'piece' | 'meter';
    thumbnail_url?: string | null;
  };
}

interface ComponentGroup {
  groupName: string | null;
  components: RequiredComponent[];
  isGroupSatisfied: boolean;
  isRequired: boolean;
}

type EquipmentConflict = {
  reservationId: string;
  eventId: string;
  eventName: string;
  start: string;
  end: string;
  quantity: number;
  source: 'direct' | 'kit';
};

interface RequiredComponentsWarningProps {
  equipmentId: string;
  eventId: string;
  offerId?: string;
  onComponentsAdded?: () => void | Promise<void>;
  availabilityByKey?: Record<string, any>;
  equipmentRevision?: string;
  autoOpen?: boolean;
  canVerifyInventory?: boolean;
  onReviewFinished?: (status: 'reviewed' | 'skipped' | 'not_applicable') => void;
}

export function RequiredComponentsWarning({
  equipmentId,
  eventId,
  offerId,
  onComponentsAdded,
  availabilityByKey,
  equipmentRevision = '',
  autoOpen = false,
  canVerifyInventory = false,
  onReviewFinished,
}: RequiredComponentsWarningProps) {
  const [componentGroups, setComponentGroups] = useState<ComponentGroup[]>([]);
  const [selectedAlternatives, setSelectedAlternatives] = useState<Record<string, string>>({});
  const [componentQuantities, setComponentQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sourceEquipmentQuantity, setSourceEquipmentQuantity] = useState(1);
  const [expandedConflictKey, setExpandedConflictKey] = useState<string | null>(null);
  const [loadingConflictKey, setLoadingConflictKey] = useState<string | null>(null);
  const [conflictsByKey, setConflictsByKey] = useState<Record<string, EquipmentConflict[]>>({});
  const [dismissedComponentIds, setDismissedComponentIds] = useState<Set<string>>(new Set());
  const [verifiedAvailabilityByKey, setVerifiedAvailabilityByKey] = useState<Record<string, any>>({});
  const { showSnackbar } = useSnackbar();

  const getRequiredQuantity = (component: RequiredComponent, sourceQuantity = sourceEquipmentQuantity) => {
    const baseQuantity = Math.max(1, Number(component.quantity ?? 1));
    return component.quantity_mode === 'fixed'
      ? baseQuantity
      : baseQuantity * Math.max(1, sourceQuantity);
  };

  const getMissingQuantity = (component: RequiredComponent) =>
    Math.max(0, getRequiredQuantity(component) - Number(component.existing_quantity ?? 0));

  useEffect(() => {
    void checkRequiredComponents();
  }, [equipmentId, eventId, canVerifyInventory, equipmentRevision]);

  const getAvailability = (component: RequiredComponent) => {
    const key = getComponentKey(component);
    const availability = key
      ? verifiedAvailabilityByKey[key] || availabilityByKey?.[key]
      : null;
    if (!key || !availability) return null;
    const available = Number(availability.max_add ?? availability.available_in_term ?? 0);
    const required = getMissingQuantity(component);
    return {
      available,
      required,
      addable: Math.min(required, available),
      isAvailable: available > 0,
      isPartial: available > 0 && available < required,
    };
  };

  const getMaximumQuantityToAdd = (component: RequiredComponent) => {
    const missing = getMissingQuantity(component);
    const availability = getAvailability(component);
    return Math.max(0, availability?.addable ?? missing);
  };

  const getSelectedQuantity = (component: RequiredComponent) => {
    const maximum = getMaximumQuantityToAdd(component);
    if (maximum <= 0) return 0;
    const selected = componentQuantities[component.id];
    return Math.min(maximum, Math.max(1, Number(selected ?? maximum)));
  };

  const setSelectedQuantity = (component: RequiredComponent, quantity: number) => {
    const maximum = getMaximumQuantityToAdd(component);
    if (maximum <= 0) return;
    setComponentQuantities((current) => ({
      ...current,
      [component.id]: Math.min(maximum, Math.max(1, Number(quantity || 1))),
    }));
  };

  const getComponentKey = (component: RequiredComponent) =>
    component.compatible_equipment_id
      ? `item-${component.compatible_equipment_id}`
      : component.compatible_kit_id
        ? `kit-${component.compatible_kit_id}`
        : component.compatible_cable_id
          ? `cable-${component.compatible_cable_id}`
          : null;

  const formatConflictDate = (value: string) =>
    new Date(value).toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const verifyAdminInventory = async (component: RequiredComponent, key: string) => {
    if (!canVerifyInventory || !component.compatible_equipment_id) return;
    const [{ data: item, error: itemError }, { data: units, error: unitsError }] = await Promise.all([
      supabase
        .from('equipment_items')
        .select('total_quantity')
        .eq('id', component.compatible_equipment_id)
        .single(),
      supabase
        .from('equipment_units')
        .select('id,status')
        .eq('equipment_id', component.compatible_equipment_id),
    ]);
    if (itemError || unitsError) return;
    const activeUnitCount = (units || []).filter((unit: any) =>
      ['available', 'reserved', 'in_use'].includes(String(unit.status)),
    ).length;
    const total = (units || []).length > 0
      ? activeUnitCount
      : Math.max(0, Number(item?.total_quantity || 0));
    const available = Math.max(0, total - Number(component.existing_quantity || 0));
    setVerifiedAvailabilityByKey((current) => ({
      ...current,
      [key]: {
        total_quantity: total,
        reserved_quantity: 0,
        used_by_this_event: Number(component.existing_quantity || 0),
        available_in_term: available,
        max_add: available,
        max_set: total,
      },
    }));
  };

  const loadConflicts = async (component: RequiredComponent, expand = true) => {
    const key = getComponentKey(component);
    if (!key) return;
    if (expand && expandedConflictKey === key) {
      setExpandedConflictKey(null);
      return;
    }
    if (expand) setExpandedConflictKey(key);
    if (conflictsByKey[key]) {
      if (canVerifyInventory && conflictsByKey[key].length === 0) {
        await verifyAdminInventory(component, key);
      }
      return;
    }

    try {
      setLoadingConflictKey(key);
      const { data: currentEvent, error: currentEventError } = await supabase
        .from('events')
        .select('event_date,event_end_date')
        .eq('id', eventId)
        .single();
      if (currentEventError) throw currentEventError;

      const start = new Date(currentEvent.event_date).getTime();
      const end = new Date(
        currentEvent.event_end_date || new Date(start + 24 * 60 * 60 * 1000).toISOString(),
      ).getTime();
      const field = component.compatible_equipment_id
        ? 'equipment_id'
        : component.compatible_kit_id
          ? 'kit_id'
          : 'cable_id';
      const itemId =
        component.compatible_equipment_id ||
        component.compatible_kit_id ||
        component.compatible_cable_id;

      const { data: directRows, error: directError } = await supabase
        .from('event_equipment')
        .select('id,event_id,quantity,status')
        .eq(field, itemId!)
        .neq('event_id', eventId);
      if (directError) throw directError;

      let kitRows: any[] = [];
      if (component.compatible_equipment_id) {
        const { data: kitItems, error: kitItemsError } = await supabase
          .from('equipment_kit_items')
          .select('kit_id')
          .eq('equipment_id', component.compatible_equipment_id);
        if (kitItemsError) throw kitItemsError;
        const kitIds = Array.from(new Set((kitItems || []).map((row) => row.kit_id)));
        if (kitIds.length > 0) {
          const { data, error } = await supabase
            .from('event_equipment')
            .select('id,event_id,quantity,status')
            .in('kit_id', kitIds)
            .neq('event_id', eventId);
          if (error) throw error;
          kitRows = data || [];
        }
      }

      const activeRows = [...(directRows || []).map((row) => ({ ...row, source: 'direct' as const })),
        ...kitRows.map((row) => ({ ...row, source: 'kit' as const }))]
        .filter((row) => !['cancelled', 'returned'].includes(String(row.status || 'reserved')));
      const relatedEventIds = Array.from(new Set(activeRows.map((row) => row.event_id).filter(Boolean)));
      if (relatedEventIds.length === 0) {
        setConflictsByKey((current) => ({ ...current, [key]: [] }));
        await verifyAdminInventory(component, key);
        return;
      }

      const { data: relatedEvents, error: eventsError } = await supabase
        .from('events')
        .select('id,name,event_date,event_end_date,status')
        .in('id', relatedEventIds);
      if (eventsError) throw eventsError;
      const eventById = new Map((relatedEvents || []).map((item) => [item.id, item]));
      const conflicts = activeRows.flatMap((row) => {
        const event = eventById.get(row.event_id) as any;
        if (!event || event.status === 'cancelled') return [];
        const conflictStart = new Date(event.event_date).getTime();
        const conflictEnd = new Date(
          event.event_end_date || new Date(conflictStart + 24 * 60 * 60 * 1000).toISOString(),
        ).getTime();
        if (conflictStart >= end || conflictEnd <= start) return [];
        return [{
          reservationId: row.id,
          eventId: row.event_id,
          eventName: event.name || 'Wydarzenie bez nazwy',
          start: event.event_date,
          end: event.event_end_date || new Date(conflictEnd).toISOString(),
          quantity: Number(row.quantity || 1),
          source: row.source,
        } satisfies EquipmentConflict];
      });
      setConflictsByKey((current) => ({ ...current, [key]: conflicts }));
      if (conflicts.length === 0) await verifyAdminInventory(component, key);
    } catch (error: any) {
      console.error('Failed to load equipment conflicts:', error);
      showSnackbar('Nie udało się pobrać szczegółów zajętości', 'error');
      setConflictsByKey((current) => ({ ...current, [key]: [] }));
    } finally {
      setLoadingConflictKey(null);
    }
  };

  const renderConflictDetails = (component: RequiredComponent) => {
    const key = getComponentKey(component);
    const availability = getAvailability(component);
    if (!key || !availability || availability.isAvailable) return null;
    const expanded = expandedConflictKey === key;
    const conflicts = conflictsByKey[key];
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void loadConflicts(component);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-red-300 hover:text-red-200"
        >
          {loadingConflictKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? 'Ukryj zajętość' : 'Gdzie jest zajęty?'}
        </button>
        {expanded && loadingConflictKey !== key && (
          <div className="mt-2 space-y-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            {conflicts?.length ? conflicts.map((conflict) => (
              <div key={`${conflict.reservationId}-${conflict.source}`} className="flex gap-2 text-xs text-[#e5e4e2]/75">
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 flex-none text-red-300" />
                <div>
                  <a
                    href={`/crm/events/${conflict.eventId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="font-medium text-[#e5e4e2] underline decoration-[#d3bb73]/40 underline-offset-2 hover:text-[#d3bb73]"
                  >
                    {conflict.eventName}
                  </a>
                  <div>{formatConflictDate(conflict.start)} – {formatConflictDate(conflict.end)}</div>
                  <div className="text-[#e5e4e2]/50">Ilość: {conflict.quantity}{conflict.source === 'kit' ? ' · element zarezerwowanego zestawu' : ''}</div>
                </div>
              </div>
            )) : (
              <div className="text-xs text-[#e5e4e2]/60">
                Brak rezerwacji nakładającej się na termin. Niedostępność wynika ze stanu lub statusu jednostki magazynowej i wymaga weryfikacji danych sprzętu.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const dismissComponentGroup = async (group: ComponentGroup) => {
    const ids = group.components.map((component) => component.id);
    const nextDismissed = new Set(Array.from(dismissedComponentIds).concat(ids));

    const { error } = await supabase
      .from('event_equipment_component_reviews')
      .update({
        dismissed_component_ids: Array.from(nextDismissed),
        updated_at: new Date().toISOString(),
      })
      .eq('event_id', eventId)
      .eq('equipment_id', equipmentId);

    if (error) {
      console.error('Failed to persist dismissed component decision:', error);
      showSnackbar('Nie udało się zapisać decyzji o pominięciu komponentu', 'error');
      return;
    }

    setDismissedComponentIds(nextDismissed);
    const nextGroups = componentGroups.filter((item) => item !== group);
    setComponentGroups(nextGroups);
    showSnackbar(
      group.isRequired
        ? 'Wymaganie zostało świadomie pominięte dla tego wydarzenia'
        : 'Rekomendacja została pominięta dla tego wydarzenia',
      'success',
    );
    if (nextGroups.length === 0) {
      setShowModal(false);
      onReviewFinished?.('reviewed');
    }
  };

  const renderThumbnail = (item: { name: string; thumbnail_url?: string | null }) => (
    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
      {item.thumbnail_url ? (
        <Image
          src={item.thumbnail_url}
          alt={item.name}
          fill
          sizes="48px"
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Package className="h-5 w-5 text-[#e5e4e2]/35" />
        </div>
      )}
    </div>
  );

  const checkRequiredComponents = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('equipment_compatible_items')
        .select(`
          id,
          compatible_equipment_id,
          compatible_kit_id,
          compatible_cable_id,
          compatibility_type,
          compatibility_group,
          quantity,
          quantity_mode,
          compatible_equipment:equipment_items!compatible_equipment_id(id, name, model, brand, thumbnail_url),
          compatible_kit:equipment_kits!compatible_kit_id(id, name, description, thumbnail_url),
          compatible_cable:cables!compatible_cable_id(id, name, description, length_meters, thumbnail_url, stock_unit)
        `)
        .eq('equipment_id', equipmentId)
        .in('compatibility_type', ['required', 'recommended']);

      if (error) throw error;

      const { data: sourceRows } = await supabase
        .from('event_equipment')
        .select('quantity')
        .eq('event_id', eventId)
        .eq('equipment_id', equipmentId)
        .or('status.is.null,status.not.in.(cancelled,returned)');
      const sourceQuantity = Math.max(
        1,
        (sourceRows || []).reduce((sum, row: any) => sum + Number(row.quantity ?? 0), 0),
      );
      setSourceEquipmentQuantity(sourceQuantity);

      const { data: reviewDecision, error: reviewDecisionError } = await supabase
        .from('event_equipment_component_reviews')
        .select('dismissed_component_ids')
        .eq('event_id', eventId)
        .eq('equipment_id', equipmentId)
        .maybeSingle();
      if (reviewDecisionError && reviewDecisionError.code !== 'PGRST204') {
        console.error('Failed to load component decisions:', reviewDecisionError);
      }
      const persistedDismissed = new Set<string>(reviewDecision?.dismissed_component_ids || []);
      setDismissedComponentIds(persistedDismissed);

      const mapped = (data || []).map((item: any) => ({
        ...item,
        compatible_equipment: Array.isArray(item.compatible_equipment)
          ? item.compatible_equipment[0]
          : item.compatible_equipment,
        compatible_kit: Array.isArray(item.compatible_kit)
          ? item.compatible_kit[0]
          : item.compatible_kit,
        compatible_cable: Array.isArray(item.compatible_cable)
          ? item.compatible_cable[0]
          : item.compatible_cable,
      })).filter((item: RequiredComponent) => !persistedDismissed.has(item.id)) as RequiredComponent[];

      if (mapped.length > 0) {
        const allEquipmentIds = mapped
          .filter((c) => c.compatible_equipment_id)
          .map((c) => c.compatible_equipment_id!);
        const allKitIds = mapped.filter((c) => c.compatible_kit_id).map((c) => c.compatible_kit_id!);
        const allCableIds = mapped.filter((c) => c.compatible_cable_id).map((c) => c.compatible_cable_id!);

        const { data: existingEquipment } =
          allEquipmentIds.length > 0
            ? await supabase
                .from('event_equipment')
                .select('equipment_id, kit_id, quantity')
                .eq('event_id', eventId)
                .or('status.is.null,status.not.in.(cancelled,returned)')
                .in('equipment_id', allEquipmentIds)
            : { data: [] };

        const { data: existingKits } =
          allKitIds.length > 0
            ? await supabase
                .from('event_equipment')
                .select('equipment_id, kit_id, cable_id, quantity')
                .eq('event_id', eventId)
                .or('status.is.null,status.not.in.(cancelled,returned)')
                .in('kit_id', allKitIds)
            : { data: [] };

        const { data: existingCables } =
          allCableIds.length > 0
            ? await supabase
                .from('event_equipment')
                .select('equipment_id, kit_id, cable_id, quantity')
                .eq('event_id', eventId)
                .or('status.is.null,status.not.in.(cancelled,returned)')
                .in('cable_id', allCableIds)
            : { data: [] };

        const sumById = (rows: any[], field: 'equipment_id' | 'kit_id' | 'cable_id') =>
          rows.reduce((map, row) => {
            const id = row[field];
            if (id) map.set(id, (map.get(id) ?? 0) + Number(row.quantity ?? 0));
            return map;
          }, new Map<string, number>());
        const existingEquipmentQuantities = sumById(existingEquipment || [], 'equipment_id');
        const existingKitQuantities = sumById(existingKits || [], 'kit_id');
        const existingCableQuantities = sumById(existingCables || [], 'cable_id');

        const isComponentSatisfied = (component: RequiredComponent) => {
          const required = getRequiredQuantity(component, sourceQuantity);
          const isRecommended = component.compatibility_type === 'recommended';
          if (component.compatible_equipment_id) {
            const existing = existingEquipmentQuantities.get(component.compatible_equipment_id) ?? 0;
            return isRecommended ? existing > 0 : existing >= required;
          }
          if (component.compatible_kit_id) {
            const existing = existingKitQuantities.get(component.compatible_kit_id) ?? 0;
            return isRecommended ? existing > 0 : existing >= required;
          }
          if (component.compatible_cable_id) {
            const existing = existingCableQuantities.get(component.compatible_cable_id) ?? 0;
            return isRecommended ? existing > 0 : existing >= required;
          }
          return false;
        };

        mapped.forEach((component) => {
          if (component.compatible_equipment_id) {
            component.existing_quantity =
              existingEquipmentQuantities.get(component.compatible_equipment_id) ?? 0;
          } else if (component.compatible_kit_id) {
            component.existing_quantity = existingKitQuantities.get(component.compatible_kit_id) ?? 0;
          } else if (component.compatible_cable_id) {
            component.existing_quantity =
              existingCableQuantities.get(component.compatible_cable_id) ?? 0;
          }
        });

        // Group by compatibility_group
        const groupedComponents: Record<string, RequiredComponent[]> = {};

        mapped.forEach((comp) => {
          const groupKey = comp.compatibility_group || `single_${comp.id}`;
          if (!groupedComponents[groupKey]) {
            groupedComponents[groupKey] = [];
          }
          groupedComponents[groupKey].push(comp);
        });

        // Check which groups are not satisfied
        const unsatisfiedGroups: ComponentGroup[] = [];

        Object.entries(groupedComponents).forEach(([groupKey, components]) => {
          const hasGroup = !!components[0].compatibility_group;

          if (hasGroup) {
            // For groups: check if AT LEAST ONE component from the group is added
            const isGroupSatisfied = components.some(isComponentSatisfied);

            if (!isGroupSatisfied) {
              unsatisfiedGroups.push({
                groupName: components[0].compatibility_group,
                components,
                isGroupSatisfied: false,
                isRequired: components.some((item) => item.compatibility_type === 'required'),
              });
            }
          } else {
            // For single components: must be added
            const comp = components[0];
            const isAdded = isComponentSatisfied(comp);

            if (!isAdded) {
              unsatisfiedGroups.push({
                groupName: null,
                components: [comp],
                isGroupSatisfied: false,
                isRequired: comp.compatibility_type === 'required',
              });
            }
          }
        });

        setComponentGroups(unsatisfiedGroups);
        if (unsatisfiedGroups.length === 0) {
          onReviewFinished?.('reviewed');
          return;
        }
        if (canVerifyInventory) {
          unsatisfiedGroups.forEach((group) => {
            group.components.forEach((component) => {
              const availability = getAvailability(component);
              if (!availability || availability.available <= 0) {
                void loadConflicts(component, false);
              }
            });
          });
        }
        if (autoOpen && unsatisfiedGroups.length > 0) setShowModal(true);
      } else {
        setComponentGroups([]);
        onReviewFinished?.((data || []).length > 0 ? 'reviewed' : 'not_applicable');
      }
    } catch (err: any) {
      console.error('Error checking required components:', err);
    } finally {
      setLoading(false);
    }
  };

  const addComponentReservation = async (payload: Record<string, unknown>) => {
    const targetField = payload.equipment_id
      ? 'equipment_id'
      : payload.kit_id
        ? 'kit_id'
        : 'cable_id';
    const targetId = payload[targetField];
    const { data: existing, error: existingError } = await supabase
      .from('event_equipment')
      .select('id,quantity')
      .eq('event_id', eventId)
      .eq(targetField, targetId)
      .or('status.is.null,status.not.in.(cancelled,returned)')
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      const { error } = await supabase
        .from('event_equipment')
        .update({ quantity: Number(existing.quantity || 0) + Number(payload.quantity || 0) })
        .eq('id', existing.id);
      if (error) throw error;
      return;
    }

    const { error } = await supabase.from('event_equipment').insert(payload);
    if (error) throw error;
  };

  const handleAddComponents = async () => {
    try {
      setAdding(true);

      // Validate that all groups have a selection
      for (const group of componentGroups) {
        if (group.groupName && group.isRequired) {
          const selected = selectedAlternatives[group.groupName];
          if (!selected) {
            showSnackbar(
              `Proszę wybrać jeden komponent z grupy "${group.groupName}"`,
              'warning'
            );
            return;
          }
        }
      }

      // Add selected components
      for (const group of componentGroups) {
        if (group.groupName) {
          // Add selected alternative from group
          const selectedId = selectedAlternatives[group.groupName];
          const selectedComponent = group.components.find(
            (c) =>
              (c.compatible_equipment_id && c.compatible_equipment_id === selectedId) ||
              (c.compatible_kit_id && c.compatible_kit_id === selectedId) ||
              (c.compatible_cable_id && c.compatible_cable_id === selectedId)
          );

          if (selectedComponent) {
            const availability = getAvailability(selectedComponent);
            if (availability && !availability.isAvailable) {
              showSnackbar('Wybrany komponent nie jest dostępny w terminie wydarzenia', 'warning');
              return;
            }
            const quantityToAdd = getSelectedQuantity(selectedComponent);
            if (quantityToAdd <= 0) continue;
            if (selectedComponent.compatible_equipment_id) {
              await addComponentReservation({
                event_id: eventId,
                equipment_id: selectedComponent.compatible_equipment_id,
                quantity: quantityToAdd,
                status: 'reserved',
                offer_id: offerId || null,
              });
            } else if (selectedComponent.compatible_kit_id) {
              await addComponentReservation({
                event_id: eventId,
                kit_id: selectedComponent.compatible_kit_id,
                quantity: quantityToAdd,
                status: 'reserved',
                offer_id: offerId || null,
              });
            } else if (selectedComponent.compatible_cable_id) {
              await addComponentReservation({
                event_id: eventId,
                cable_id: selectedComponent.compatible_cable_id,
                quantity: quantityToAdd,
                status: 'reserved',
                offer_id: offerId || null,
              });
            }
          }
        } else {
          // Add single required component
          const component = group.components[0];
          const availability = getAvailability(component);
          if (availability && !availability.isAvailable) {
            showSnackbar(
              `${component.compatible_equipment?.name || component.compatible_kit?.name || component.compatible_cable?.name || 'Komponent'} nie jest dostępny w terminie wydarzenia`,
              'warning',
            );
            return;
          }
          const quantityToAdd = getSelectedQuantity(component);
          if (quantityToAdd <= 0) continue;
          if (component.compatible_equipment_id) {
            await addComponentReservation({
              event_id: eventId,
              equipment_id: component.compatible_equipment_id,
              quantity: quantityToAdd,
              status: 'reserved',
              offer_id: offerId || null,
            });
          } else if (component.compatible_kit_id) {
            await addComponentReservation({
              event_id: eventId,
              kit_id: component.compatible_kit_id,
              quantity: quantityToAdd,
              status: 'reserved',
              offer_id: offerId || null,
            });
          } else if (component.compatible_cable_id) {
            await addComponentReservation({
              event_id: eventId,
              cable_id: component.compatible_cable_id,
              quantity: quantityToAdd,
              status: 'reserved',
              offer_id: offerId || null,
            });
          }
        }
      }

      showSnackbar('Zaktualizowano komponenty wydarzenia', 'success');
      setShowModal(false);
      setComponentGroups([]);
      setSelectedAlternatives({});
      setComponentQuantities({});
      await onComponentsAdded?.();
      onReviewFinished?.('reviewed');
    } catch (err: any) {
      console.error('Error adding components:', err);
      showSnackbar(err.message || 'Błąd podczas dodawania komponentów', 'error');
    } finally {
      setAdding(false);
    }
  };

  if (loading || componentGroups.length === 0) {
    return null;
  }

  const totalMissing = componentGroups.reduce((sum, group) => sum + (group.groupName ? 1 : group.components.length), 0);

  const renderQuantitySelector = (component: RequiredComponent, disabled = false) => {
    const maximum = getMaximumQuantityToAdd(component);
    if (maximum <= 0) return null;
    const selected = getSelectedQuantity(component);
    const unit = component.compatible_cable?.stock_unit === 'meter' ? 'm' : 'szt.';

    return (
      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-xs text-[#e5e4e2]/60">Dodaj:</span>
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
          <button
            type="button"
            onClick={() => setSelectedQuantity(component, selected - 1)}
            disabled={disabled || selected <= 1}
            aria-label="Zmniejsz ilość"
            className="p-2 text-[#e5e4e2]/70 hover:bg-[#e5e4e2]/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <input
            type="number"
            min={1}
            max={maximum}
            value={selected}
            disabled={disabled}
            onChange={(event) => setSelectedQuantity(component, Number(event.target.value))}
            aria-label="Ilość dodawanego komponentu"
            className="w-14 border-x border-[#d3bb73]/15 bg-transparent px-1 py-1.5 text-center text-sm text-[#e5e4e2] outline-none disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => setSelectedQuantity(component, selected + 1)}
            disabled={disabled || selected >= maximum}
            aria-label="Zwiększ ilość"
            className="p-2 text-[#e5e4e2]/70 hover:bg-[#e5e4e2]/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="text-xs text-[#e5e4e2]/50">
          z maks. {maximum} {unit}
        </span>
      </div>
    );
  };

  return (
    <>
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-400" />
          <div className="flex-1">
            <div className="text-sm font-medium text-yellow-400">
              Ten sprzęt ma dodatkowe komponenty
            </div>
            <div className="mt-1 text-xs text-yellow-400/80">
              {totalMissing} {totalMissing === 1 ? 'komponent wymaga' : 'komponentów wymaga'} weryfikacji
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="mt-2 text-xs font-medium text-yellow-400 underline hover:text-yellow-300"
            >
              Zobacz komponenty i dodaj
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <div>
                <h2 className="text-xl font-semibold text-[#e5e4e2]">Komponenty zestawu</h2>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  Sprawdź elementy wymagane i rekomendowane oraz ich dostępność
                </p>
              </div>
              <button
                onClick={() => {
                  setShowModal(false);
                  onReviewFinished?.('skipped');
                }}
                className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-6">
              <div className="mb-6 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-400" />
                  <div className="text-sm text-yellow-400">
                    Elementy wymagane są niezbędne do działania. Rekomendowane warto dodać,
                    jeśli będą potrzebne w tej realizacji.
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {componentGroups.map((group, groupIdx) => {
                  if (group.groupName) {
                    // Alternative group - user must select ONE
                    return (
                      <div
                        key={group.groupName}
                        className="rounded-lg border-2 border-blue-500/30 bg-blue-500/5 p-4"
                      >
                        <div className="mb-3">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-blue-400" />
                            <h4 className="font-medium text-[#e5e4e2]">
                              {group.groupName}
                            </h4>
                            <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                              {group.isRequired ? 'Wybierz JEDEN' : 'Rekomendowane'}
                            </span>
                            <button
                              type="button"
                              onClick={() => void dismissComponentGroup(group)}
                              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#e5e4e2]/15 px-2.5 py-1 text-xs text-[#e5e4e2]/65 hover:border-red-400/30 hover:text-red-300"
                            >
                              <MinusCircle className="h-3.5 w-3.5" />
                              {group.isRequired ? 'Pomiń wymaganie' : 'Nie używamy'}
                            </button>
                          </div>
                          <p className="ml-7 mt-1 text-xs text-[#e5e4e2]/60">
                            {group.isRequired
                              ? 'Wybierz jeden z poniższych komponentów albo świadomie pomiń wymaganie dla tego wydarzenia'
                              : 'Możesz wybrać jeden z rekomendowanych wariantów'}
                          </p>
                        </div>

                        <div className="ml-7 space-y-2">
                          {group.components.map((component) => {
                            const item = component.compatible_equipment || component.compatible_kit || component.compatible_cable;
                            const isKit = !!component.compatible_kit;
                            const isCable = !!component.compatible_cable;
                            const itemId = component.compatible_equipment_id || component.compatible_kit_id || component.compatible_cable_id;

                            if (!item || !itemId) return null;

                            const isSelected = selectedAlternatives[group.groupName!] === itemId;
                            const availability = getAvailability(component);

                            return (
                              <label
                                key={component.id}
                                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
                                  isSelected
                                    ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                                    : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`group_${group.groupName}`}
                                  checked={isSelected}
                                  onChange={() =>
                                    setSelectedAlternatives((prev) => ({
                                      ...prev,
                                      [group.groupName!]: itemId,
                                    }))
                                  }
                                  className="mt-0.5 h-4 w-4 text-[#d3bb73] focus:ring-[#d3bb73]"
                                />
                                {renderThumbnail(item)}
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                                    <span className="rounded bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/70">
                                      {component.compatibility_type === 'required' ? 'Do dodania' : 'Sugerowane'}:{' '}
                                      {getMissingQuantity(component)} / {component.compatibility_type === 'required' ? 'wymagane' : 'docelowo'}{' '}
                                      {getRequiredQuantity(component)}{' '}
                                      {component.compatible_cable?.stock_unit === 'meter' ? 'm' : 'szt.'}
                                    </span>
                                    {availability && (
                                      <span
                                        className={`rounded px-2 py-0.5 text-xs ${
                                          availability.isAvailable
                                            ? 'bg-emerald-500/20 text-emerald-400'
                                            : 'bg-red-500/20 text-red-400'
                                        }`}
                                      >
                                        {availability.isAvailable
                                          ? availability.isPartial
                                            ? `Dostępna część: ${availability.available}`
                                            : `Dostępne: ${availability.available}`
                                          : 'Niedostępne'}
                                      </span>
                                    )}
                                    {isKit && (
                                      <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                        ZESTAW
                                      </span>
                                    )}
                                    {isCable && (
                                      <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                                        PRZEWÓD
                                      </span>
                                    )}
                                  </div>
                                  {!isKit && !isCable && component.compatible_equipment && (
                                    <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                      {component.compatible_equipment.brand}{' '}
                                      {component.compatible_equipment.model}
                                    </div>
                                  )}
                                  {isKit && component.compatible_kit?.description && (
                                    <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                      {component.compatible_kit.description}
                                    </div>
                                  )}
                                  {isCable && component.compatible_cable && (
                                    <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                      {component.compatible_cable.length_meters && `${component.compatible_cable.length_meters}m`}
                                      {component.compatible_cable.description && ` - ${component.compatible_cable.description}`}
                                    </div>
                                  )}
                                  {renderQuantitySelector(component, !isSelected)}
                                  {renderConflictDetails(component)}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  } else {
                    // Single required component - automatically added, no user selection needed
                    const component = group.components[0];
                    const item = component.compatible_equipment || component.compatible_kit || component.compatible_cable;
                    const isKit = !!component.compatible_kit;
                    const isCable = !!component.compatible_cable;
                    const availability = getAvailability(component);

                    if (!item) return null;

                    return (
                      <div
                        key={component.id}
                        className="rounded-lg border border-green-500/20 bg-green-500/5 p-4"
                      >
                        <div className="flex items-start gap-3">
                          {renderThumbnail(item)}
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                              <span className="rounded bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/70">
                                {component.compatibility_type === 'required' ? 'Do dodania' : 'Sugerowane'}:{' '}
                                {getMissingQuantity(component)} / {component.compatibility_type === 'required' ? 'wymagane' : 'docelowo'}{' '}
                                {getRequiredQuantity(component)}{' '}
                                {component.compatible_cable?.stock_unit === 'meter' ? 'm' : 'szt.'}
                              </span>
                              {availability && (
                                <span
                                  className={`rounded px-2 py-0.5 text-xs ${
                                    availability.isAvailable
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : 'bg-red-500/20 text-red-400'
                                  }`}
                                >
                                  {availability.isAvailable
                                    ? availability.isPartial
                                      ? `Dostępna część: ${availability.available}`
                                      : `Dostępne: ${availability.available}`
                                    : 'Niedostępne'}
                                </span>
                              )}
                              {isKit && (
                                <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                  ZESTAW
                                </span>
                              )}
                              {isCable && (
                                <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                                  PRZEWÓD
                                </span>
                              )}
                              <span
                                className={`rounded px-2 py-0.5 text-xs ${
                                  group.isRequired
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'bg-blue-500/20 text-blue-400'
                                }`}
                              >
                                {group.isRequired ? 'WYMAGANY' : 'REKOMENDOWANY'}
                              </span>
                            </div>
                            {!isKit && !isCable && component.compatible_equipment && (
                              <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                {component.compatible_equipment.brand}{' '}
                                {component.compatible_equipment.model}
                              </div>
                            )}
                            {isKit && component.compatible_kit?.description && (
                              <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                {component.compatible_kit.description}
                              </div>
                            )}
                            {isCable && component.compatible_cable && (
                              <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                {component.compatible_cable.length_meters && `${component.compatible_cable.length_meters}m`}
                                {component.compatible_cable.description && ` - ${component.compatible_cable.description}`}
                              </div>
                            )}
                            <div className="mt-2 text-xs text-green-400/80">
                              {group.isRequired
                                ? 'Ten komponent jest niezbędny i zostanie dodany po zatwierdzeniu.'
                                : 'Ten komponent warto dodać, jeśli będzie potrzebny w tej realizacji.'}
                            </div>
                            {renderQuantitySelector(component)}
                            <button
                              type="button"
                              onClick={() => void dismissComponentGroup(group)}
                              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#e5e4e2]/15 px-3 py-1.5 text-xs text-[#e5e4e2]/65 hover:border-red-400/30 hover:text-red-300"
                            >
                              <MinusCircle className="h-3.5 w-3.5" />
                              {group.isRequired
                                ? 'Pomiń wymaganie w tym wydarzeniu'
                                : 'Nie używamy w tym rozwiązaniu'}
                            </button>
                            {renderConflictDetails(component)}
                          </div>
                        </div>
                      </div>
                    );
                  }
                })}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#d3bb73]/10 p-6">
              <button
                onClick={() => {
                  setShowModal(false);
                  onReviewFinished?.('skipped');
                }}
                className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                Anuluj
              </button>
              <button
                onClick={handleAddComponents}
                disabled={adding}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] transition-colors hover:bg-[#c4ac64] disabled:opacity-50"
              >
                {adding ? (
                  'Dodawanie...'
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Dodaj wybrane komponenty
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
