'use client';

import { supabase } from '@/lib/supabase/browser';
import { buildSubstitutionsForInsert, calcTotal, getRentalEquipmentFromSelectedAlt } from '../utils';
import { EquipmentConflictRow, SelectedAltMap } from '../types';
import { IOfferItem } from '@/app/(crm)/crm/offers/types';

export async function submitOfferWizard(params: {
  eventId: string;
  employeeId: string;

  clientType: 'individual' | 'business';
  organizationId?: string;
  contactId?: string;

  offerData: { offer_number: string; valid_until: string; notes: string };
  offerItems: IOfferItem[];

  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];
  equipmentSubstitutions?: Record<string, any>;
  hasEquipmentShortage?: boolean;
}) {
  const totalAmount = calcTotal(params.offerItems);

  const offerDataToInsert: any = {
    event_id: params.eventId,
    client_type: params.clientType,
    organization_id: params.clientType === 'business' ? params.organizationId || null : null,
    contact_id: params.clientType === 'individual' ? params.contactId || null : null,
    valid_until: params.offerData.valid_until || null,
    notes: params.offerData.notes || null,
    status: 'draft',
    total_amount: totalAmount,
    created_by: params.employeeId,
    offer_number: params.offerData.offer_number?.trim()
      ? params.offerData.offer_number.trim()
      : null,
  };

  const { data: offerResult, error: offerError } = await supabase
    .from('offers')
    .insert([offerDataToInsert])
    .select()
    .single();

  if (offerError) throw offerError;

  const itemsToInsert = params.offerItems.map((item, index) => ({
    offer_id: offerResult.id,
    product_id: item.product_id?.trim() ? item.product_id : null,
    name: item.name,
    description: item.description || null,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
    unit_cost: 0,
    discount_percent: item.discount_percent || 0,
    discount_amount: 0,
    transport_cost: 0,
    logistics_cost: 0,
    display_order: index + 1,
    notes: null,
  }));

  const { error: itemsError } = await supabase.from('offer_items').insert(itemsToInsert);
  if (itemsError) throw itemsError;

  // Merge committed substitutions with temporary selections
  const combinedSubstitutions: SelectedAltMap = {};

  // First, add committed substitutions from equipmentSubstitutions
  if (params.equipmentSubstitutions) {
    Object.entries(params.equipmentSubstitutions).forEach(([key, sub]) => {
      combinedSubstitutions[key] = {
        item_id: sub.to_item_id,
        qty: sub.qty,
      };
    });
  }

  // Then, add temporary selections from selectedAlt
  Object.entries(params.selectedAlt).forEach(([key, sel]) => {
    combinedSubstitutions[key] = sel;
  });

  const substitutionsPayload = buildSubstitutionsForInsert({
    offerId: offerResult.id,
    selectedAlt: combinedSubstitutions,
    conflicts: params.conflicts,
  });

  if (substitutionsPayload.length > 0) {
    const { error: subsError } = await supabase
      .from('offer_equipment_substitutions')
      .insert(substitutionsPayload);

    if (subsError) throw subsError;
  }

  // Zamień konfliktowy sprzęt na rental equipment
  const rentalEquipment = getRentalEquipmentFromSelectedAlt(combinedSubstitutions);

  if (rentalEquipment.length > 0) {
    for (const rental of rentalEquipment) {
      // Znajdź wszystkie produkty w tej ofercie
      const { data: offerItemsWithProducts } = await supabase
        .from('offer_items')
        .select('id, product_id')
        .eq('offer_id', offerResult.id)
        .not('product_id', 'is', null);

      if (offerItemsWithProducts) {
        for (const offerItem of offerItemsWithProducts) {
          // Znajdź oryginalny sprzęt który ma być zastąpiony
          const { data: existingEquipment } = await supabase
            .from('offer_product_equipment')
            .select('id')
            .eq('product_id', offerItem.product_id)
            .eq(
              rental.originalItemType === 'item' ? 'equipment_item_id' : 'equipment_kit_id',
              rental.originalItemId
            )
            .maybeSingle();

          if (existingEquipment) {
            // Dodaj rental equipment
            const { data: rentalRecord, error: rentalError } = await supabase
              .from('offer_product_equipment')
              .insert({
                product_id: offerItem.product_id,
                rental_equipment_id: rental.rentalEquipmentId,
                subcontractor_id: rental.subcontractorId,
                quantity: rental.quantity,
                is_rental: true,
                is_optional: false,
              })
              .select('id')
              .single();

            if (rentalError) {
              console.error('Error inserting rental equipment:', rentalError);
            } else if (rentalRecord) {
              // Oznacz oryginalny sprzęt jako zastąpiony
              await supabase
                .from('offer_product_equipment')
                .update({ replaced_by_rental_id: rentalRecord.id })
                .eq('id', existingEquipment.id);
            }
          } else {
            // Jeśli nie znaleziono oryginalnego (np. już nie istnieje), po prostu dodaj rental
            const { error: rentalError } = await supabase
              .from('offer_product_equipment')
              .insert({
                product_id: offerItem.product_id,
                rental_equipment_id: rental.rentalEquipmentId,
                subcontractor_id: rental.subcontractorId,
                quantity: rental.quantity,
                is_rental: true,
                is_optional: false,
              });

            if (rentalError) {
              console.error('Error inserting rental equipment:', rentalError);
            }
          }
        }
      }
    }
  }

  // Jeśli oferta ma braki sprzętowe, oznacz event
  if (params.hasEquipmentShortage) {
    const { error: eventError } = await supabase
      .from('events')
      .update({ has_equipment_shortage: true })
      .eq('id', params.eventId);

    if (eventError) {
      console.error('Error updating event equipment shortage flag:', eventError);
      // Nie rzucamy błędu - oferta została utworzona, to tylko flaga
    }
  }

  return offerResult as { id: string; offer_number: string };
}
