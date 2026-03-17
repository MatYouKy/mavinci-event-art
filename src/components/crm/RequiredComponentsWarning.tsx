'use client';

import { useState, useEffect } from 'react';
import { Package, AlertTriangle, X, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface RequiredComponent {
  id: string;
  compatible_equipment_id: string | null;
  compatible_kit_id: string | null;
  compatibility_type: string;
  compatibility_group: string | null;
  compatible_equipment?: {
    id: string;
    name: string;
    model?: string;
    brand?: string;
  };
  compatible_kit?: {
    id: string;
    name: string;
    description?: string;
  };
}

interface ComponentGroup {
  groupName: string | null;
  components: RequiredComponent[];
  isGroupSatisfied: boolean;
}

interface RequiredComponentsWarningProps {
  equipmentId: string;
  eventId: string;
  offerId?: string;
  onComponentsAdded?: () => void;
}

export function RequiredComponentsWarning({
  equipmentId,
  eventId,
  offerId,
  onComponentsAdded,
}: RequiredComponentsWarningProps) {
  const [componentGroups, setComponentGroups] = useState<ComponentGroup[]>([]);
  const [selectedAlternatives, setSelectedAlternatives] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    checkRequiredComponents();
  }, [equipmentId]);

  const checkRequiredComponents = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('equipment_compatible_items')
        .select(`
          id,
          compatible_equipment_id,
          compatible_kit_id,
          compatibility_type,
          compatibility_group,
          compatible_equipment:equipment_items!compatible_equipment_id(id, name, model, brand),
          compatible_kit:equipment_kits!compatible_kit_id(id, name, description)
        `)
        .eq('equipment_id', equipmentId)
        .eq('compatibility_type', 'required');

      if (error) throw error;

      const mapped = (data || []).map((item: any) => ({
        ...item,
        compatible_equipment: Array.isArray(item.compatible_equipment)
          ? item.compatible_equipment[0]
          : item.compatible_equipment,
        compatible_kit: Array.isArray(item.compatible_kit)
          ? item.compatible_kit[0]
          : item.compatible_kit,
      })) as RequiredComponent[];

      if (mapped.length > 0) {
        const allEquipmentIds = mapped
          .filter((c) => c.compatible_equipment_id)
          .map((c) => c.compatible_equipment_id!);
        const allKitIds = mapped.filter((c) => c.compatible_kit_id).map((c) => c.compatible_kit_id!);

        const { data: existingEquipment } =
          allEquipmentIds.length > 0
            ? await supabase
                .from('event_equipment')
                .select('equipment_id, kit_id')
                .eq('event_id', eventId)
                .in('equipment_id', allEquipmentIds)
            : { data: [] };

        const { data: existingKits } =
          allKitIds.length > 0
            ? await supabase
                .from('event_equipment')
                .select('equipment_id, kit_id')
                .eq('event_id', eventId)
                .in('kit_id', allKitIds)
            : { data: [] };

        const existingEquipmentIds = new Set(
          (existingEquipment || []).map((e) => e.equipment_id).filter(Boolean)
        );
        const existingKitIds = new Set((existingKits || []).map((e) => e.kit_id).filter(Boolean));

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
            const isGroupSatisfied = components.some((comp) => {
              if (comp.compatible_equipment_id) {
                return existingEquipmentIds.has(comp.compatible_equipment_id);
              }
              if (comp.compatible_kit_id) {
                return existingKitIds.has(comp.compatible_kit_id);
              }
              return false;
            });

            if (!isGroupSatisfied) {
              unsatisfiedGroups.push({
                groupName: components[0].compatibility_group,
                components,
                isGroupSatisfied: false,
              });
            }
          } else {
            // For single components: must be added
            const comp = components[0];
            const isAdded = comp.compatible_equipment_id
              ? existingEquipmentIds.has(comp.compatible_equipment_id)
              : comp.compatible_kit_id
                ? existingKitIds.has(comp.compatible_kit_id)
                : false;

            if (!isAdded) {
              unsatisfiedGroups.push({
                groupName: null,
                components: [comp],
                isGroupSatisfied: false,
              });
            }
          }
        });

        setComponentGroups(unsatisfiedGroups);
      } else {
        setComponentGroups([]);
      }
    } catch (err: any) {
      console.error('Error checking required components:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddComponents = async () => {
    try {
      setAdding(true);

      // Validate that all groups have a selection
      for (const group of componentGroups) {
        if (group.groupName) {
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
              (c.compatible_kit_id && c.compatible_kit_id === selectedId)
          );

          if (selectedComponent) {
            if (selectedComponent.compatible_equipment_id) {
              await supabase.from('event_equipment').insert({
                event_id: eventId,
                equipment_id: selectedComponent.compatible_equipment_id,
                quantity: 1,
                status: 'reserved',
                offer_id: offerId || null,
              });
            } else if (selectedComponent.compatible_kit_id) {
              await supabase.from('event_equipment').insert({
                event_id: eventId,
                kit_id: selectedComponent.compatible_kit_id,
                quantity: 1,
                status: 'reserved',
                offer_id: offerId || null,
              });
            }
          }
        } else {
          // Add single required component
          const component = group.components[0];
          if (component.compatible_equipment_id) {
            await supabase.from('event_equipment').insert({
              event_id: eventId,
              equipment_id: component.compatible_equipment_id,
              quantity: 1,
              status: 'reserved',
              offer_id: offerId || null,
            });
          } else if (component.compatible_kit_id) {
            await supabase.from('event_equipment').insert({
              event_id: eventId,
              kit_id: component.compatible_kit_id,
              quantity: 1,
              status: 'reserved',
              offer_id: offerId || null,
            });
          }
        }
      }

      showSnackbar('Dodano wymagane komponenty', 'success');
      setShowModal(false);
      setComponentGroups([]);
      setSelectedAlternatives({});
      onComponentsAdded?.();
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

  return (
    <>
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-400" />
          <div className="flex-1">
            <div className="text-sm font-medium text-yellow-400">
              Ten sprzęt wymaga dodatkowych komponentów
            </div>
            <div className="mt-1 text-xs text-yellow-400/80">
              {totalMissing} wymaganych {totalMissing === 1 ? 'komponent' : 'komponentów'} nie zostało dodanych
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
                <h2 className="text-xl font-semibold text-[#e5e4e2]">Wymagane komponenty</h2>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  Ten sprzęt wymaga następujących komponentów do prawidłowego działania
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
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
                    Wybrany sprzęt nie będzie działać bez poniższych komponentów. Zalecamy ich
                    dodanie.
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
                              Wybierz JEDEN
                            </span>
                          </div>
                          <p className="ml-7 mt-1 text-xs text-[#e5e4e2]/60">
                            Musisz wybrać jeden z poniższych komponentów alternatywnych
                          </p>
                        </div>

                        <div className="ml-7 space-y-2">
                          {group.components.map((component) => {
                            const item = component.compatible_equipment || component.compatible_kit;
                            const isKit = !!component.compatible_kit;
                            const itemId = component.compatible_equipment_id || component.compatible_kit_id;

                            if (!item || !itemId) return null;

                            const isSelected = selectedAlternatives[group.groupName!] === itemId;

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
                                <div className="flex-shrink-0 rounded-full bg-blue-500/20 p-2">
                                  <Package className="h-4 w-4 text-blue-400" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                                    {isKit && (
                                      <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                        ZESTAW
                                      </span>
                                    )}
                                  </div>
                                  {!isKit && component.compatible_equipment && (
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
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  } else {
                    // Single required component
                    const component = group.components[0];
                    const item = component.compatible_equipment || component.compatible_kit;
                    const isKit = !!component.compatible_kit;

                    if (!item) return null;

                    return (
                      <div
                        key={component.id}
                        className="rounded-lg border border-red-500/20 bg-red-500/5 p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 rounded-full bg-red-500/20 p-2">
                            <Package className="h-5 w-5 text-red-400" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                              {isKit && (
                                <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                  ZESTAW
                                </span>
                              )}
                              <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                                WYMAGANY
                              </span>
                            </div>
                            {!isKit && component.compatible_equipment && (
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
                onClick={() => setShowModal(false)}
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
