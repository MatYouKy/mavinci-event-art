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
  is_optional: boolean;
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
  const [requiredComponents, setRequiredComponents] = useState<RequiredComponent[]>([]);
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
          is_optional,
          compatible_equipment:equipment_items!compatible_equipment_id(id, name, model, brand),
          compatible_kit:equipment_kits!compatible_kit_id(id, name, description)
        `)
        .eq('equipment_id', equipmentId)
        .eq('compatibility_type', 'required')
        .eq('is_optional', false);

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
        const { data: existingEquipment } = await supabase
          .from('event_equipment')
          .select('equipment_id, kit_id')
          .eq('event_id', eventId)
          .in(
            'equipment_id',
            mapped
              .filter((c) => c.compatible_equipment_id)
              .map((c) => c.compatible_equipment_id!)
          );

        const { data: existingKits } = await supabase
          .from('event_equipment')
          .select('equipment_id, kit_id')
          .eq('event_id', eventId)
          .in(
            'kit_id',
            mapped.filter((c) => c.compatible_kit_id).map((c) => c.compatible_kit_id!)
          );

        const existingEquipmentIds = new Set(
          (existingEquipment || []).map((e) => e.equipment_id).filter(Boolean)
        );
        const existingKitIds = new Set((existingKits || []).map((e) => e.kit_id).filter(Boolean));

        const missing = mapped.filter((comp) => {
          if (comp.compatible_equipment_id) {
            return !existingEquipmentIds.has(comp.compatible_equipment_id);
          }
          if (comp.compatible_kit_id) {
            return !existingKitIds.has(comp.compatible_kit_id);
          }
          return false;
        });

        setRequiredComponents(missing);
      } else {
        setRequiredComponents([]);
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

      for (const component of requiredComponents) {
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

      showSnackbar('Dodano wymagane komponenty', 'success');
      setShowModal(false);
      setRequiredComponents([]);
      onComponentsAdded?.();
    } catch (err: any) {
      console.error('Error adding components:', err);
      showSnackbar(err.message || 'Błąd podczas dodawania komponentów', 'error');
    } finally {
      setAdding(false);
    }
  };

  if (loading || requiredComponents.length === 0) {
    return null;
  }

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
              {requiredComponents.length} wymaganych komponentów nie zostało dodanych
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

              <div className="space-y-3">
                {requiredComponents.map((component) => {
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
                    Dodaj wszystkie komponenty
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
