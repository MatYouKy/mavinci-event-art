import React, { useState } from 'react';
import { ChevronDown, Package, Plus } from 'lucide-react';
import { Equipment } from '@/app/crm/equipment/types/equipment.types';
import { supabase } from '@/lib/supabase';
import { IEvent } from '../../page';
import { AddEquipmentModal } from '../Modals/AddEquipmentModal';
interface EventEquipmentTabProps {
  equipment: Equipment[];
  event: IEvent;
}

export const EventEquipmentTab = ({ equipment, event }: EventEquipmentTabProps) => {
  const [availableEquipment, setAvailableEquipment] = useState<any[]>([]);
  const [availableKits, setAvailableKits] = useState<any[]>([]);
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [editingQuantity, setEditingQuantity] = useState<string | null>(null);

  const fetchAvailableEquipment = async () => {
    try {
      let availability = null;

      // Jeśli wydarzenie ma daty, sprawdź dostępność w zakresie dat
      if (event.event_date && event.event_end_date) {
        const { data: availData, error: availError } = await supabase.rpc(
          'check_equipment_availability_for_event',
          {
            p_event_id: event.id,
            p_start_date: event.event_date,
            p_end_date: event.event_end_date,
          },
        );

        if (availError) {
          console.error('Error checking availability:', availError);
          return;
        }

        availability = availData;
      } else {
        // Brak dat - pokaż całą dostępność (wszystkie jednostki)
        const { data: items } = await supabase.from('equipment_items').select('id, name');

        const { data: kits } = await supabase.from('equipment_kits').select('id, name');

        // Utwórz syntetyczną listę dostępności pokazującą całą ilość
        const itemAvail = await Promise.all(
          (items || []).map(async (item: any) => {
            const { count } = await supabase
              .from('equipment_units')
              .select('*', { count: 'exact', head: true })
              .eq('equipment_id', item.id)
              .in('status', ['available', 'reserved', 'in_use']);

            return {
              item_id: item.id,
              item_type: 'item',
              item_name: item.name,
              total_quantity: count || 0,
              reserved_quantity: 0,
              available_quantity: count || 0,
            };
          }),
        );

        const kitAvail = (kits || []).map((kit: any) => ({
          item_id: kit.id,
          item_type: 'kit',
          item_name: kit.name,
          total_quantity: 1,
          reserved_quantity: 0,
          available_quantity: 1,
        }));

        availability = [...itemAvail, ...kitAvail];
      }

      console.log('Availability data:', availability);

      // Stwórz mapę dostępności
      const availabilityMap = new Map(
        (availability || []).map((item: any) => [`${item.item_type}-${item.item_id}`, item]),
      );

      console.log('Availability map:', availabilityMap);

      // Pobierz wszystkie items
      const { data: items, error: itemsError } = await supabase
        .from('equipment_items')
        .select(
          `
          *,
          category:warehouse_categories(name)
        `,
        )
        .order('name');

      if (!itemsError && items) {
        // Filtruj sprzęt który jest już dodany do wydarzenia
        const alreadyAddedIds = equipment
          .filter((eq) => eq.equipment_id)
          .map((eq) => eq.equipment_id);

        const availableItems = items
          .filter((item) => !alreadyAddedIds.includes(item.id))
          .map((item) => {
            const avail = availabilityMap.get(`item-${item.id}`);
            return {
              ...item,
              available_count: avail?.available_quantity || 0,
              total_quantity: avail?.total_quantity || 0,
              reserved_quantity: avail?.reserved_quantity || 0,
            };
          })
          .filter((item) => item.available_count > 0);

        setAvailableEquipment(availableItems);
      }

      // Pobierz zestawy
      const { data: kits, error: kitsError } = await supabase
        .from('equipment_kits')
        .select(
          `
          *,
          items:equipment_kit_items(
            equipment_id,
            quantity,
            equipment:equipment_items(
              id,
              name,
              category:warehouse_categories(name)
            )
          )
        `,
        )
        .order('name');

      if (!kitsError && kits) {
        const alreadyAddedKitIds = equipment.filter((eq) => eq.kit_id).map((eq) => eq.kit_id);

        const availableKitsWithAvail = kits
          .filter((kit) => !alreadyAddedKitIds.includes(kit.id))
          .map((kit) => {
            const avail = availabilityMap.get(`kit-${kit.id}`);
            return {
              ...kit,
              available_count: avail?.available_quantity || 0,
            };
          })
          .filter((kit) => kit.available_count > 0);

        setAvailableKits(availableKitsWithAvail);
      }
    } catch (error) {
      console.error('Error fetching available equipment:', error);
    }
  };

  const handleUpdateQuantity = async (
    eventEquipmentId: string,
    equipmentId: string,
    newQuantity: number,
  ) => {
    try {
      const avail = equipmentAvailability[equipmentId];
      if (avail && newQuantity > avail.available + avail.reserved) {
        alert(`Dostępna ilość: ${avail.available + avail.reserved} szt.`);
        return;
      }

      const { error } = await supabase
        .from('event_equipment')
        .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq('id', eventEquipmentId);

      if (error) {
        console.error('Error updating quantity:', error);
        alert('Błąd podczas aktualizacji ilości');
        return;
      }

      setEditingQuantity(null);
      await fetchEventDetails();
      await fetchEquipmentAvailability();
      await logChange('equipment_updated', `Zaktualizowano ilość sprzętu na ${newQuantity}`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleRemoveEquipment = async (equipmentId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten sprzęt z eventu?')) return;

    try {
      const { error } = await supabase.from('event_equipment').delete().eq('id', equipmentId);

      if (error) {
        console.error('Error removing equipment:', error);
        alert('Błąd podczas usuwania sprzętu');
        return;
      }

      fetchEventDetails();
      await logChange('equipment_removed', `Usunięto sprzęt z eventu (ID: ${equipmentId})`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleAddEquipment = async (
    selectedItems: Array<{ id: string; quantity: number; notes: string; type: 'item' | 'kit' }>,
  ) => {
    try {
      const itemsToInsert: any[] = [];

      for (const selected of selectedItems) {
        if (selected.type === 'kit') {
          itemsToInsert.push({
            event_id: eventId,
            kit_id: selected.id,
            equipment_id: null,
            quantity: selected.quantity,
            notes: selected.notes,
          });
        } else {
          itemsToInsert.push({
            event_id: eventId,
            kit_id: null,
            equipment_id: selected.id,
            quantity: selected.quantity,
            notes: selected.notes,
          });
        }
      }

      const { error } = await supabase.from('event_equipment').insert(itemsToInsert);

      if (error) {
        console.error('Error adding equipment:', error);
        alert('Błąd podczas dodawania sprzętu');
        return;
      }

      setShowAddEquipmentModal(false);
      fetchEventDetails();
      await logChange('equipment_added', `Dodano ${itemsToInsert.length} pozycji sprzętu`);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };


  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Sprzęt</h2>
        <button
          onClick={() => {
            fetchAvailableEquipment();
            setShowAddEquipmentModal(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj sprzęt
        </button>
      </div>

      {equipment.length === 0 ? (
        <div className="py-12 text-center">
          <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Ręcznie dodany sprzęt */}
          {equipment.filter((item: any) => !item.auto_added).length > 0 && (
            <div className="space-y-2">
              {equipment
                .filter((item: any) => !item.auto_added)
                .map((item: any) => {
                  const isExpanded = expandedKits.has(item.id);
                  const isKit = !!item.kit;

                  return (
                    <div key={item.id}>
                      <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20">
                        {isKit && (
                          <button
                            onClick={() => {
                              const newExpanded = new Set(expandedKits);
                              if (isExpanded) {
                                newExpanded.delete(item.id);
                              } else {
                                newExpanded.add(item.id);
                              }
                              setExpandedKits(newExpanded);
                            }}
                            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${
                                isExpanded ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                        )}

                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          {isKit ? (
                            <span className="text-base">🎁</span>
                          ) : item.equipment?.thumbnail_url ? (
                            <img
                              src={item.equipment.thumbnail_url}
                              alt={item.equipment.name}
                              className="h-10 w-10 rounded border border-[#d3bb73]/20 object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                              <Package className="h-5 w-5 text-[#e5e4e2]/30" />
                            </div>
                          )}
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium text-[#e5e4e2]">
                              {item.kit ? item.kit.name : item.equipment?.name || 'Nieznany'}
                            </span>
                            {!isKit && item.equipment && (
                              <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                                {item.equipment.brand && <span>{item.equipment.brand}</span>}
                                {item.equipment.model && (
                                  <>
                                    {item.equipment.brand && <span>•</span>}
                                    <span>{item.equipment.model}</span>
                                  </>
                                )}
                                {item.equipment.cable_specs && (
                                  <>
                                    {(item.equipment.brand || item.equipment.model) && (
                                      <span>•</span>
                                    )}
                                    {item.equipment.cable_specs.connector_in &&
                                    item.equipment.cable_specs.connector_out ? (
                                      <span>
                                        {item.equipment.cable_specs.connector_in} →{' '}
                                        {item.equipment.cable_specs.connector_out}
                                      </span>
                                    ) : (
                                      item.equipment.cable_specs.type && (
                                        <span>{item.equipment.cable_specs.type}</span>
                                      )
                                    )}
                                    {item.equipment.cable_specs.length_meters && (
                                      <span>{item.equipment.cable_specs.length_meters}m</span>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                          {!isKit && item.equipment?.category && (
                            <span className="hidden md:inline">{item.equipment.category.name}</span>
                          )}
                          {!isKit &&
                            item.equipment_id &&
                            equipmentAvailability[item.equipment_id] && (
                              <div className="hidden flex-col items-end text-xs lg:flex">
                                <span className="text-[#d3bb73]">
                                  {equipmentAvailability[item.equipment_id].available +
                                    equipmentAvailability[item.equipment_id].reserved}{' '}
                                  dostępne
                                </span>
                              </div>
                            )}
                          {editingQuantity === item.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="1"
                                defaultValue={item.quantity}
                                className="w-16 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2]"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const newQuantity = parseInt(
                                      (e.target as HTMLInputElement).value,
                                    );
                                    if (newQuantity > 0) {
                                      handleUpdateQuantity(item.id, item.equipment_id, newQuantity);
                                    }
                                  } else if (e.key === 'Escape') {
                                    setEditingQuantity(null);
                                  }
                                }}
                                onBlur={(e) => {
                                  const newQuantity = parseInt(e.target.value);
                                  if (newQuantity > 0 && newQuantity !== item.quantity) {
                                    handleUpdateQuantity(item.id, item.equipment_id, newQuantity);
                                  } else {
                                    setEditingQuantity(null);
                                  }
                                }}
                                autoFocus
                              />
                              <span className="text-[#e5e4e2]/60">szt.</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => !isKit && setEditingQuantity(item.id)}
                              className={`font-medium text-[#e5e4e2] ${!isKit ? 'cursor-pointer hover:text-[#d3bb73]' : ''}`}
                              disabled={isKit}
                            >
                              {item.quantity} szt.
                            </button>
                          )}
                        </div>

                        <button
                          onClick={() => handleRemoveEquipment(item.id)}
                          className="text-red-400/60 transition-colors hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {isKit && isExpanded && item.kit?.items && (
                        <div className="ml-9 mt-1 space-y-1">
                          {item.kit.items.map((kitItem: any, idx: number) => (
                            <div
                              key={idx}
                              className="flex items-center gap-3 rounded border border-[#d3bb73]/5 bg-[#0f1119]/50 px-4 py-2 text-sm"
                            >
                              {kitItem.equipment.thumbnail_url ? (
                                <img
                                  src={kitItem.equipment.thumbnail_url}
                                  alt={kitItem.equipment.name}
                                  className="h-8 w-8 rounded border border-[#d3bb73]/10 object-cover"
                                />
                              ) : (
                                <div className="flex h-8 w-8 items-center justify-center rounded border border-[#d3bb73]/10 bg-[#1c1f33]">
                                  <Package className="h-4 w-4 text-[#e5e4e2]/30" />
                                </div>
                              )}
                              <div className="flex min-w-0 flex-1 flex-col">
                                <span className="text-[#e5e4e2]/80">{kitItem.equipment.name}</span>
                                <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/40">
                                  {kitItem.equipment.brand && (
                                    <span>{kitItem.equipment.brand}</span>
                                  )}
                                  {kitItem.equipment.model && (
                                    <>
                                      {kitItem.equipment.brand && <span>•</span>}
                                      <span>{kitItem.equipment.model}</span>
                                    </>
                                  )}
                                  {kitItem.equipment.cable_specs && (
                                    <>
                                      {(kitItem.equipment.brand || kitItem.equipment.model) && (
                                        <span>•</span>
                                      )}
                                      {kitItem.equipment.cable_specs.connector_in &&
                                      kitItem.equipment.cable_specs.connector_out ? (
                                        <span>
                                          {kitItem.equipment.cable_specs.connector_in} →{' '}
                                          {kitItem.equipment.cable_specs.connector_out}
                                        </span>
                                      ) : (
                                        kitItem.equipment.cable_specs.type && (
                                          <span>{kitItem.equipment.cable_specs.type}</span>
                                        )
                                      )}
                                      {kitItem.equipment.cable_specs.length_meters && (
                                        <span>{kitItem.equipment.cable_specs.length_meters}m</span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                              <span className="hidden text-xs text-[#e5e4e2]/50 md:inline">
                                {kitItem.equipment.category?.name}
                              </span>
                              <span className="font-medium text-[#e5e4e2]/60">
                                {kitItem.quantity * item.quantity} szt.
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* Separator między ręcznie dodanym a automatycznym */}
          {equipment.filter((item) => !item.auto_added).length > 0 &&
            equipment.filter((item) => item.auto_added).length > 0 && (
              <div className="my-6 flex items-center gap-4">
                <div className="h-px flex-1 bg-[#d3bb73]/10"></div>
                <span className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                  Z produktów oferty
                </span>
                <div className="h-px flex-1 bg-[#d3bb73]/10"></div>
              </div>
            )}

          {/* Automatycznie dodany sprzęt z oferty */}
          {equipment.filter((item) => item.auto_added).length > 0 && (
            <div className="space-y-2">
              {equipment
                .filter((item) => item.auto_added)
                .map((item) => {
                  const isExpanded = expandedKits.has(item.id);
                  const isKit = !!item.kit;

                  return (
                    <div key={item.id}>
                      <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20">
                        {isKit && (
                          <button
                            onClick={() => {
                              const newExpanded = new Set(expandedKits);
                              if (isExpanded) {
                                newExpanded.delete(item.id);
                              } else {
                                newExpanded.add(item.id);
                              }
                              setExpandedKits(newExpanded);
                            }}
                            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${
                                isExpanded ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                        )}

                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          {isKit ? (
                            <span className="text-base">🎁</span>
                          ) : item.equipment?.thumbnail_url ? (
                            <img
                              src={item.equipment.thumbnail_url}
                              alt={item.equipment.name}
                              className="h-10 w-10 rounded border border-[#d3bb73]/20 object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                              <Package className="h-5 w-5 text-[#e5e4e2]/30" />
                            </div>
                          )}
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium text-[#e5e4e2]">
                              {item.kit ? item.kit.name : item.equipment?.name || 'Nieznany'}
                            </span>
                            {!isKit && item.equipment && (
                              <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                                {item.equipment.brand && <span>{item.equipment.brand}</span>}
                                {item.equipment.model && (
                                  <>
                                    {item.equipment.brand && <span>•</span>}
                                    <span>{item.equipment.model}</span>
                                  </>
                                )}
                                {item.equipment.cable_specs && (
                                  <>
                                    {(item.equipment.brand || item.equipment.model) && (
                                      <span>•</span>
                                    )}
                                    {item.equipment.cable_specs.connector_in &&
                                    item.equipment.cable_specs.connector_out ? (
                                      <span>
                                        {item.equipment.cable_specs.connector_in} →{' '}
                                        {item.equipment.cable_specs.connector_out}
                                      </span>
                                    ) : (
                                      item.equipment.cable_specs.type && (
                                        <span>{item.equipment.cable_specs.type}</span>
                                      )
                                    )}
                                    {item.equipment.cable_specs.length_meters && (
                                      <span>{item.equipment.cable_specs.length_meters}m</span>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                          {!isKit && item.equipment?.category && (
                            <span className="hidden md:inline">{item.equipment.category.name}</span>
                          )}
                          {!isKit &&
                            item.equipment_id &&
                            equipmentAvailability[item.equipment_id] && (
                              <div className="hidden flex-col items-end text-xs lg:flex">
                                <span className="text-[#d3bb73]">
                                  {equipmentAvailability[item.equipment_id].available +
                                    equipmentAvailability[item.equipment_id].reserved}{' '}
                                  dostępne
                                </span>
                              </div>
                            )}
                          {editingQuantity === item.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="1"
                                defaultValue={item.quantity}
                                className="w-16 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2]"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const newQuantity = parseInt(
                                      (e.target as HTMLInputElement).value,
                                    );
                                    if (newQuantity > 0) {
                                      handleUpdateQuantity(item.id, item.equipment_id, newQuantity);
                                    }
                                  } else if (e.key === 'Escape') {
                                    setEditingQuantity(null);
                                  }
                                }}
                                onBlur={(e) => {
                                  const newQuantity = parseInt(e.target.value);
                                  if (newQuantity > 0 && newQuantity !== item.quantity) {
                                    handleUpdateQuantity(item.id, item.equipment_id, newQuantity);
                                  } else {
                                    setEditingQuantity(null);
                                  }
                                }}
                                autoFocus
                              />
                              <span className="text-[#e5e4e2]/60">szt.</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => !isKit && setEditingQuantity(item.id)}
                              className={`font-medium text-[#e5e4e2] ${!isKit ? 'cursor-pointer hover:text-[#d3bb73]' : ''}`}
                              disabled={isKit}
                            >
                              {item.quantity} szt.
                            </button>
                          )}
                        </div>

                        <button
                          onClick={() => handleRemoveEquipment(item.id)}
                          className="text-red-400/60 transition-colors hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {isKit && isExpanded && item.kit?.items && (
                        <div className="ml-9 mt-1 space-y-1">
                          {item.kit.items.map((kitItem: any, idx: number) => (
                            <div
                              key={idx}
                              className="flex items-center gap-3 rounded border border-[#d3bb73]/5 bg-[#0f1119]/50 px-4 py-2 text-sm"
                            >
                              {kitItem.equipment.thumbnail_url ? (
                                <img
                                  src={kitItem.equipment.thumbnail_url}
                                  alt={kitItem.equipment.name}
                                  className="h-8 w-8 rounded border border-[#d3bb73]/10 object-cover"
                                />
                              ) : (
                                <div className="flex h-8 w-8 items-center justify-center rounded border border-[#d3bb73]/10 bg-[#1c1f33]">
                                  <Package className="h-4 w-4 text-[#e5e4e2]/30" />
                                </div>
                              )}
                              <div className="flex min-w-0 flex-1 flex-col">
                                <span className="text-[#e5e4e2]/80">{kitItem.equipment.name}</span>
                                <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/40">
                                  {kitItem.equipment.brand && (
                                    <span>{kitItem.equipment.brand}</span>
                                  )}
                                  {kitItem.equipment.model && (
                                    <>
                                      {kitItem.equipment.brand && <span>•</span>}
                                      <span>{kitItem.equipment.model}</span>
                                    </>
                                  )}
                                  {kitItem.equipment.cable_specs && (
                                    <>
                                      {(kitItem.equipment.brand || kitItem.equipment.model) && (
                                        <span>•</span>
                                      )}
                                      {kitItem.equipment.cable_specs.connector_in &&
                                      kitItem.equipment.cable_specs.connector_out ? (
                                        <span>
                                          {kitItem.equipment.cable_specs.connector_in} →{' '}
                                          {kitItem.equipment.cable_specs.connector_out}
                                        </span>
                                      ) : (
                                        kitItem.equipment.cable_specs.type && (
                                          <span>{kitItem.equipment.cable_specs.type}</span>
                                        )
                                      )}
                                      {kitItem.equipment.cable_specs.length_meters && (
                                        <span>{kitItem.equipment.cable_specs.length_meters}m</span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                              <span className="hidden text-xs text-[#e5e4e2]/50 md:inline">
                                {kitItem.equipment.category?.name}
                              </span>
                              <span className="font-medium text-[#e5e4e2]/60">
                                {kitItem.quantity * item.quantity} szt.
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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
        />
      )}
    </div>
  );
};
